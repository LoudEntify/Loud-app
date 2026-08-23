import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin';
import { verifyArtistAuth } from '../../../../lib/verifyArtistAuth';

// Versus invites. Replaces the performer code for slot B.
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

    const { show_id: showId, username } = await request.json();
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

    const inviteToken = randomUUID();
    const { error: upErr } = await admin.from('show_slots').upsert(
      {
        show_id: showId,
        slot: 'b',
        invite_token: inviteToken,
        invited_username: username ? String(username).trim().toLowerCase() : null,
        invite_accepted_at: null,
      },
      { onConflict: 'show_id,slot' }
    );
    if (upErr) {
      console.error('[invite] upsert failed:', upErr);
      return NextResponse.json({ error: 'Could not create that invite' }, { status: 500 });
    }

    return NextResponse.json({ ok: true, inviteToken, showId });
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
