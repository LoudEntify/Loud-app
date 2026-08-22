import { AccessToken } from 'livekit-server-sdk';
import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin';
import { verifyArtistAuth } from '../../../../lib/verifyArtistAuth';

// Stage 3 of MULTI_PERFORMER_SPEC.md. Deliberately does NOT call or
// modify app/api/token/route.js -- that route's behaviour is out of
// scope tonight (locked decision in the spec doc); this mints its own
// LiveKit AccessToken instead, gated entirely by a valid show_slots
// code rather than the client asserting a slot letter.
//
// Accounts & Identity Day 1: auth is now layered UNDER the code, not
// instead of it -- the code still answers "which slot", this answers
// "who is asking". `email` is no longer taken from the request body
// (free-typed, unverified, spoofable) -- it comes from the verified
// artist session instead, so `claimed_by_email` can no longer be
// spoofed by whatever string a client happens to send.
//
// Required env vars: same LIVEKIT_API_KEY/LIVEKIT_API_SECRET/LIVEKIT_URL
// as app/api/token/route.js, plus SUPABASE_SERVICE_ROLE_KEY (lib/
// supabaseAdmin.js) since show_slots has zero RLS policies -- only a
// service-role client can ever read a code or write a session token.

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

    const { show_id: showId, code, participantId } = await request.json();
    if (!showId || !code) {
      return NextResponse.json({ error: 'show_id and code are required' }, { status: 400 });
    }

    const admin = getSupabaseAdmin();

    const { data: show, error: showErr } = await admin
      .from('shows')
      .select('id, room_name')
      .eq('id', showId)
      .maybeSingle();
    if (showErr || !show) {
      return NextResponse.json({ error: 'Show not found' }, { status: 404 });
    }

    // Case-insensitive on purpose -- human-typed codes at a live event
    // shouldn't fail on a capitalization mismatch.
    const { data: slotRow, error: slotErr } = await admin
      .from('show_slots')
      .select('*')
      .eq('show_id', showId)
      .ilike('code', code.trim())
      .maybeSingle();
    if (slotErr || !slotRow) {
      return NextResponse.json({ error: 'Code not recognized' }, { status: 401 });
    }

    const normalizedEmail = auth.user.email.trim().toLowerCase();

    // Codes are ACCOUNT-BOUND (first-claim-wins). This used to warn and
    // let the claim through -- "joining anyway" -- which is where the
    // degraded sessions came from: the artist got a real performer token
    // and broadcast, but every downstream piece of state derived from
    // the account/slot pairing was inconsistent (missing peer
    // thumbnails, stale derivations). A half-valid session is worse than
    // a rejected one, because it looks like it worked.
    //
    // Rejected BEFORE any session or media setup: no LiveKit token is
    // minted, no session_token is rotated, no ownership or participant
    // row is written. Nothing below this line runs for a mismatch.
    //
    // NOTE: this overrides MULTI_PERFORMER_SPEC.md's earlier locked
    // decision to allow a warned re-claim by a different email. That
    // decision predates accounts existing at all; with real auth, an
    // account mismatch is an authorization failure, not a warning.
    if (slotRow.claimed_by_email && slotRow.claimed_by_email !== normalizedEmail) {
      console.warn('[claim-slot] rejected: code bound to another account', {
        showId,
        slot: slotRow.slot,
        requestedBy: normalizedEmail,
      });
      return NextResponse.json(
        { error: 'This code is registered to another account. Sign in with the account it was issued to.' },
        { status: 403 }
      );
    }
    const warning = null;

    // Fresh random identity per connection, never derived from name/email
    // -- two devices claiming the same code (e.g. a genuine rejoin after
    // a drop, or a warned-but-allowed reuse) must never collide on
    // identity, or LiveKit's same-identity takeover silently kicks
    // whichever device connected first. Prefix preserved so every
    // existing consumer (tracksForSlot, renderSlot, director, egress)
    // keeps working unchanged.
    const identity = `contestant-${slotRow.slot}-${randomUUID().slice(0, 8)}`;
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

    // Rotates the session token on every successful claim, first or
    // repeat -- see MULTI_PERFORMER_SPEC.md's locked decision on this.
    // Whatever token a previous claim of this slot held stops working
    // the instant this write lands.
    const { error: updateErr } = await admin
      .from('show_slots')
      .update({
        claimed_by_email: normalizedEmail,
        claimed_by_user_id: auth.user.id,
        claimed_at: new Date().toISOString(),
        session_token: sessionToken,
        session_token_issued_at: new Date().toISOString(),
      })
      .eq('show_id', showId)
      .eq('slot', slotRow.slot);
    if (updateErr) {
      console.error('[claim-slot] show_slots update failed:', updateErr);
      return NextResponse.json({ error: 'Could not claim slot' }, { status: 500 });
    }

    // Accounts & Identity Day 2: first-claim-wins ownership -- the first
    // artist to successfully claim any slot on a show becomes its owner.
    // `is('artist_id', null)` makes this a no-op once a show already has an
    // owner (or for shows claimed before this column existed, which stay
    // ownerless until their next claim). Not fatal -- ownership assignment
    // isn't required for the claim itself to succeed.
    const { error: showOwnerErr } = await admin
      .from('shows')
      .update({ artist_id: auth.user.id })
      .eq('id', showId)
      .is('artist_id', null);
    if (showOwnerErr) {
      console.error('[claim-slot] shows ownership update failed:', showOwnerErr);
    }

    if (participantId) {
      const { error: participantErr } = await admin
        .from('participants')
        .update({ role: 'performer', slot: slotRow.slot })
        .eq('id', participantId);
      if (participantErr) {
        // Not fatal to the claim itself -- the performer's connection
        // is already valid at this point; log and move on rather than
        // fail an otherwise-successful slot claim over a bookkeeping row.
        console.error('[claim-slot] participants update failed:', participantErr);
      }
    }

    return NextResponse.json({
      ok: true,
      livekitToken,
      url: livekitUrl,
      slot: slotRow.slot,
      sessionToken,
      warning,
    });
  } catch (err) {
    console.error('[claim-slot] request failed:', err);
    return NextResponse.json(
      { error: 'Claim failed', detail: String(err?.message || err) },
      { status: 500 }
    );
  }
}
