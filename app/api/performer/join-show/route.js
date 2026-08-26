import { AccessToken } from 'livekit-server-sdk';
import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { WINDOW_OPENS_BEFORE_MS, showWindowClosesAt } from '../../../../lib/showWindow';
import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin';
import { verifyArtistAuth } from '../../../../lib/verifyArtistAuth';

// Replaces app/api/performer/claim-slot for scheduled shows.
//
// THE RULING THIS IMPLEMENTS
//   Solo:   the scheduling artist's ACCOUNT is the authorization. Logged
//           in + owns the show + inside the window = go live. No code
//           exists anywhere in the path.
//   Versus: slot B is claimed by accepting a single-use INVITE while
//           logged in, which binds the slot to that user id.
//
// What did NOT change is the machinery underneath: first-claim-wins,
// 403 on a mismatch, a rotating session token for resume, and a fresh
// random identity per connection. Only the thing that proves WHO you
// are moved -- from a typed string to an account.
//
// The window check is enforced HERE, server-side, not just in the
// dashboard's button state. A disabled button is a UI courtesy; this is
// the actual rule, and it is what keeps LiveKit from being billable
// outside a scheduled show.

// The window rule comes from lib/showWindow.js -- the SAME functions the
// browser uses. This route used to hold its own copy of a three-hour
// constant, so a change on one side silently disagreed with the other:
// an artist could be told their window was shut by a screen and let in
// by this route, or the reverse.

function windowState(show, now = Date.now()) {
  const slated = new Date(show.slated_at).getTime();
  if (Number.isNaN(slated)) return { open: false, reason: 'This show has no valid start time.' };
  if (show.state === 'ended') return { open: false, reason: 'This show has ended.' };
  const opens = slated - WINDOW_OPENS_BEFORE_MS;
  const closes = showWindowClosesAt(show);
  if (now < opens) {
    const mins = Math.ceil((opens - now) / 60000);
    return { open: false, reason: `Too early — your window opens in ${mins} minute${mins === 1 ? '' : 's'}.` };
  }
  if (now >= closes) return { open: false, reason: 'This show\'s window has closed.' };
  return { open: true };
}

export async function POST(request) {
  try {
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    const livekitUrl = process.env.LIVEKIT_URL;
    if (!apiKey || !apiSecret || !livekitUrl) {
      return NextResponse.json({ error: 'Server missing LiveKit environment variables' }, { status: 500 });
    }

    const auth = await verifyArtistAuth(request);
    if (auth.error) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { show_id: showId, invite_token: inviteToken, participantId } = await request.json();
    if (!showId) {
      return NextResponse.json({ error: 'show_id is required' }, { status: 400 });
    }

    const admin = getSupabaseAdmin();
    const { data: show, error: showErr } = await admin
      .from('shows')
      .select('*')
      .eq('id', showId)
      .maybeSingle();
    if (showErr || !show) {
      return NextResponse.json({ error: 'Show not found' }, { status: 404 });
    }

    const gate = windowState(show);
    if (!gate.open) {
      return NextResponse.json({ error: gate.reason }, { status: 403 });
    }

    // ── Which slot is this person entitled to? ────────────────
    let slot = null;
    let slotRow = null;

    if (show.artist_id && show.artist_id === auth.user.id) {
      // The owner always holds slot A, solo or versus. No invite, no code.
      slot = 'a';
      const { data } = await admin
        .from('show_slots')
        .select('*')
        .eq('show_id', showId)
        .eq('slot', 'a')
        .maybeSingle();
      slotRow = data || null;
    } else {
      // Already bound to a slot on this show? Let them straight back in.
      // This is ALSO resume-your-slot: after an invite is accepted the
      // token is consumed, so every subsequent join -- a refresh, a
      // reconnect, a second device -- arrives with no token and must be
      // recognised by ACCOUNT instead. Keyed to (account, scheduled
      // show), exactly as the ruling asks.
      const { data: mine } = await admin
        .from('show_slots')
        .select('*')
        .eq('show_id', showId)
        .eq('claimed_by_user_id', auth.user.id)
        .maybeSingle();
      if (mine) {
        slot = mine.slot;
        slotRow = mine;
      }
    }

    if (!slot && inviteToken) {
      const { data } = await admin
        .from('show_slots')
        .select('*')
        .eq('show_id', showId)
        .eq('invite_token', inviteToken)
        .maybeSingle();

      if (!data) {
        return NextResponse.json({ error: 'This invite is not valid for this show.' }, { status: 403 });
      }
      // First-claim-wins, unchanged in meaning: once a slot is bound to
      // someone, only that someone gets back in. A second person holding
      // the same link is refused rather than silently taking the slot.
      if (data.claimed_by_user_id && data.claimed_by_user_id !== auth.user.id) {
        return NextResponse.json(
          { error: 'This invite has already been accepted by another account.' },
          { status: 403 }
        );
      }
      slot = data.slot;
      slotRow = data;
    }

    if (!slot) {
      return NextResponse.json(
        { error: 'You are not on the line-up for this show.' },
        { status: 403 }
      );
    }

    // ── Mint the LiveKit token ────────────────────────────────
    // Identity prefix preserved exactly -- tracksForSlot, renderSlot, the
    // director and egress all key off `contestant-{slot}-`, and a fresh
    // uuid per connection is what stops two devices colliding on identity
    // and kicking each other out.
    const identity = `contestant-${slot}-${randomUUID().slice(0, 8)}`;
    const sessionToken = randomUUID();

    const at = new AccessToken(apiKey, apiSecret, { identity });
    at.addGrant({
      room: show.room_name,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });
    const livekitToken = await at.toJwt();

    // ── Bind the slot ─────────────────────────────────────────
    // Session token rotates on every join, same as the code flow: an
    // older device's token stops working the instant this lands. Keyed
    // to (account, scheduled show) now rather than to a typed code.
    const binding = {
      show_id: showId,
      slot,
      claimed_by_user_id: auth.user.id,
      claimed_by_email: (auth.user.email || '').trim().toLowerCase(),
      claimed_at: new Date().toISOString(),
      session_token: sessionToken,
      session_token_issued_at: new Date().toISOString(),
    };
    // Consume the invite on acceptance -- single use, by construction.
    if (slotRow?.invite_token) {
      binding.invite_token = null;
      binding.invite_accepted_at = new Date().toISOString();
    }

    const { error: upsertErr } = await admin
      .from('show_slots')
      .upsert(binding, { onConflict: 'show_id,slot' });
    if (upsertErr) {
      console.error('[join-show] slot binding failed:', upsertErr);
      return NextResponse.json({ error: 'Could not join this show' }, { status: 500 });
    }

    if (participantId) {
      const { error: pErr } = await admin
        .from('participants')
        .update({ role: 'performer', slot })
        .eq('id', participantId);
      if (pErr) console.error('[join-show] participants update failed:', pErr);
    }

    return NextResponse.json({
      ok: true,
      livekitToken,
      url: livekitUrl,
      slot,
      sessionToken,
      roomName: show.room_name,
      performanceMode: show.performance_mode || 'solo',
    });
  } catch (err) {
    console.error('[join-show] request failed:', err);
    return NextResponse.json(
      { error: 'Join failed', detail: String(err?.message || err) },
      { status: 500 }
    );
  }
}
