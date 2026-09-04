import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin';
import { verifyArtistAuth } from '../../../../lib/verifyArtistAuth';

// Versus invites. Replaces the performer code for slot B.
//
// ── ROUND 3: THE INVITE IS DELIVERED, NOT COPIED ──────────────
// It used to hand back a token, and the artist's only way to deliver it
// was to copy a link into WhatsApp. That took the invitation off the
// platform, made the other artist accept somewhere else, and left no
// record of who invited whom — Versus ended up feeling like a
// workaround rather than a feature.
//
// POST now takes an `invited_user_id` and, when it gets one, writes the
// notification itself. The token model is UNCHANGED: it is still a
// single-use token on the show_slots row, still what grants the slot,
// still what /join/[token] resolves. What changed is that a human no
// longer has to carry it.
//
// The link survives as the OFF-PLATFORM case — you cannot notify
// somebody who does not have an account — and that is the exception
// rather than the default. A response still returns inviteToken for it.
//
// ── WHY THE NOTIFICATION IS WRITTEN HERE ──────────────────────
// Because it cannot be written anywhere else. notifications' RLS allows
// insert for the OWNER of the row only, deliberately: a client-insertable
// cross-user notification is a spam primitive. Inviting is one user
// causing a row for another, so it needs the service role, which is what
// this route already holds.
//
// POST — the show's owner mints (or re-mints) a single-use invite.
// GET  — the accept screen resolves a token into something human:
//        who invited you, to what, and when. Deliberately readable
//        WITHOUT being logged in, so a link previews before you sign up
//        -- it exposes only what the sender already chose to share, and
//        never the token's power (accepting still requires an account).

export async function POST(request) {
  try {
    const auth = await verifyArtistAuth(request);
    if (auth.error) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { show_id: showId, username, invited_user_id: invitedUserId } = await request.json();
    if (!showId) return NextResponse.json({ error: 'show_id is required' }, { status: 400 });

    const admin = getSupabaseAdmin();
    const { data: show } = await admin.from('shows').select('*').eq('id', showId).maybeSingle();
    if (!show) return NextResponse.json({ error: 'Show not found' }, { status: 404 });

    // Only the owner invites, and only for a versus show -- a solo show
    // has no second slot to give away.
    if (show.artist_id !== auth.user.id) {
      return NextResponse.json({ error: 'Only the artist who scheduled this show can invite.' }, { status: 403 });
    }
    if ((show.performance_mode || 'solo') !== 'versus') {
      return NextResponse.json({ error: 'Solo shows have no second slot.' }, { status: 400 });
    }

    // Re-minting revokes the previous link by replacing the token. That
    // is the intended way to "cancel" an invite you sent to the wrong
    // person -- there is no separate revoke endpoint to forget about.
    const { data: existing } = await admin
      .from('show_slots')
      .select('*')
      .eq('show_id', showId)
      .eq('slot', 'b')
      .maybeSingle();

    if (existing?.claimed_by_user_id) {
      return NextResponse.json(
        { error: 'Slot B is already taken. Re-inviting would not remove them.' },
        { status: 409 }
      );
    }

    // Resolved before anything is written: an invite naming an account
    // that does not exist, is not an artist, or has closed should fail
    // as a bad request rather than mint a token nobody can use.
    let invitee = null;
    if (invitedUserId) {
      const { data } = await admin
        .from('profiles')
        .select('id, username, display_name, role, deactivated_at')
        .eq('id', invitedUserId)
        .maybeSingle();
      if (!data || data.role !== 'artist' || data.deactivated_at) {
        return NextResponse.json({ error: 'That artist cannot be invited.' }, { status: 400 });
      }
      if (data.id === auth.user.id) {
        return NextResponse.json({ error: 'You cannot invite yourself.' }, { status: 400 });
      }
      invitee = data;
    }

    const inviteToken = randomUUID();
    const { error: upErr } = await admin.from('show_slots').upsert(
      {
        show_id: showId,
        slot: 'b',
        invite_token: inviteToken,
        // Both columns, and they mean different things. invited_user_id
        // is the FACT when an account was selected; invited_username is
        // what was typed when there is no account to point at. Null
        // invited_user_id is how a link invite stays distinguishable
        // from a selected one afterwards.
        invited_user_id: invitee?.id ?? null,
        invited_username: invitee?.username
          ?? (username ? String(username).trim().toLowerCase() : null),
        invite_accepted_at: null,
      },
      { onConflict: 'show_id,slot' }
    );
    if (upErr) {
      console.error('[invite] upsert failed:', upErr);
      return NextResponse.json({ error: 'Could not create that invite' }, { status: 500 });
    }

    let notified = false;
    if (invitee) {
      const { data: host } = await admin
        .from('profiles')
        .select('display_name, username')
        .eq('id', auth.user.id)
        .maybeSingle();
      const hostName = host?.display_name || host?.username || 'An artist';

      const { error: noteErr } = await admin.from('notifications').upsert(
        {
          user_id: invitee.id,
          kind: 'versus_invite',
          body: `${hostName} invited you to a Versus show`,
          href: `/join/${inviteToken}`,
          // One pending invite per show per person. Re-minting replaces
          // the notification rather than stacking a second one with a
          // dead token in it — the dedupe index is partial on
          // dedupe_key, so this is the conflict target it was built for.
          dedupe_key: `versus_invite:${showId}`,
          read_at: null,
        },
        { onConflict: 'user_id,dedupe_key' }
      );
      if (noteErr) {
        // NOT fatal. The slot row is written and the token is valid, so
        // the invite exists; what failed is the delivery. Reported to the
        // caller so the UI can offer the link as a fallback rather than
        // claiming success it cannot see.
        console.error('[invite] notification failed:', noteErr);
      } else {
        notified = true;
      }
    }

    return NextResponse.json({
      ok: true,
      inviteToken,
      showId,
      notified,
      invited: invitee ? { id: invitee.id, username: invitee.username, displayName: invitee.display_name } : null,
    });
  } catch (err) {
    console.error('[invite] request failed:', err);
    return NextResponse.json({ error: 'Request failed' }, { status: 500 });
  }
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get('token');
  if (!token) return NextResponse.json({ error: 'token is required' }, { status: 400 });

  try {
    const admin = getSupabaseAdmin();
    const { data: slotRow } = await admin
      .from('show_slots')
      .select('show_id, slot, invite_token, claimed_by_user_id')
      .eq('invite_token', token)
      .maybeSingle();

    if (!slotRow) {
      // Covers "never existed", "already accepted" and "re-minted" with
      // one message on purpose -- distinguishing them would let someone
      // probe which tokens ever existed.
      return NextResponse.json({ error: 'This invite is no longer valid.' }, { status: 404 });
    }

    const { data: show } = await admin
      .from('shows')
      .select('id, title, slated_at, performance_mode, artist_id, state')
      .eq('id', slotRow.show_id)
      .maybeSingle();
    if (!show) return NextResponse.json({ error: 'This invite is no longer valid.' }, { status: 404 });

    let hostName = null;
    if (show.artist_id) {
      const { data: host } = await admin
        .from('profiles')
        .select('display_name, username')
        .eq('id', show.artist_id)
        .maybeSingle();
      hostName = host?.display_name || host?.username || null;
    }

    return NextResponse.json({
      showId: show.id,
      slot: slotRow.slot,
      title: show.title,
      slatedAt: show.slated_at,
      performanceMode: show.performance_mode,
      hostName,
      alreadyClaimed: !!slotRow.claimed_by_user_id,
    });
  } catch (err) {
    console.error('[invite] lookup failed:', err);
    return NextResponse.json({ error: 'Request failed' }, { status: 500 });
  }
}
