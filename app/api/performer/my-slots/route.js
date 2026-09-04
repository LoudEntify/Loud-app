import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin';
import { verifyArtistAuth } from '../../../../lib/verifyArtistAuth';

// The shows an artist is in but did not create.
//
// PRD: Director Experience / Live Show (Versus)
// S&I: Database, Auth
//
// ── THE HOLE THIS FILLS ───────────────────────────────────────
// Every "my shows" query in the app is `shows.artist_id = me` — the
// OWNER column. components/ScheduleShow.jsx and
// components/ProfileSurface.jsx both do it.
//
// That was correct while a show had one artist. Versus broke it without
// anything appearing to break: an artist who accepts an invite is in the
// show, has a slot, will publish a camera and perform — and the show is
// invisible to them everywhere. Not in their diary, not on their
// profile. It exists for them in exactly one place: a notification,
// which is dismissible, easily missed, and gone once read.
//
// So an artist could accept a booking and then have no way to see it.
//
// ── WHY THIS IS A ROUTE AND NOT A QUERY ───────────────────────
// show_slots is deliberately ZERO-POLICY and service-role only
// (docs/ownership_migration.sql: "no client-side access to this table
// exists anywhere"). A client cannot read it, and opening it up would
// expose every invite token in the table to anybody who can read a row.
// The token is the credential; the table is not browsable for the same
// reason a password table is not.
//
// So the join happens here, behind the service role, and the response
// carries the SHOW and the slot's status — never the token.
//
// ── WHAT IT RETURNS ───────────────────────────────────────────
//   pending  — invited, not yet claimed. Carries inviteToken because the
//              accept flow needs somewhere to send them, and it is THEIR
//              invite: the token is already in their notification.
//   claimed  — accepted. This is the half that makes an accepted show
//              appear in their own upcoming list.
export async function GET(request) {
  const auth = await verifyArtistAuth(request);
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const admin = getSupabaseAdmin();

    // Both directions in one query: slots this artist was INVITED to and
    // slots they have CLAIMED. A single round trip, and the two states
    // are distinguished by claimed_by_user_id rather than by which query
    // returned the row — one code path deciding status, so the two
    // cannot disagree.
    const { data: slots, error } = await admin
      .from('show_slots')
      .select('show_id, slot, invite_token, invited_user_id, claimed_by_user_id, invite_accepted_at')
      .or(`invited_user_id.eq.${auth.user.id},claimed_by_user_id.eq.${auth.user.id}`);

    if (error) {
      console.error('[my-slots] slot query failed:', error);
      return NextResponse.json({ error: 'Could not load your shows' }, { status: 500 });
    }
    if (!slots?.length) return NextResponse.json({ slots: [] });

    const { data: shows } = await admin
      .from('shows')
      .select('id, title, slated_at, duration_minutes, performance_mode, state, artist_id, room_name')
      .in('id', slots.map((s) => s.show_id));

    const byId = new Map((shows || []).map((s) => [s.id, s]));

    // The host's name, so a banner can say who is asking rather than
    // showing a uuid.
    const hostIds = [...new Set((shows || []).map((s) => s.artist_id).filter(Boolean))];
    const { data: hosts } = hostIds.length
      ? await admin.from('profiles').select('id, display_name, username').in('id', hostIds)
      : { data: [] };
    const hostById = new Map((hosts || []).map((h) => [h.id, h]));

    const out = slots
      .map((s) => {
        const show = byId.get(s.show_id);
        // A slot whose show has been deleted is not an error and not
        // worth surfacing — it is a row waiting to be tidied.
        if (!show) return null;
        // Never their own show: this endpoint answers "shows I did not
        // create", and including them would double every entry in the
        // caller's diary.
        if (show.artist_id === auth.user.id) return null;
        const host = hostById.get(show.artist_id);
        const claimed = s.claimed_by_user_id === auth.user.id;
        return {
          status: claimed ? 'claimed' : 'pending',
          slot: s.slot,
          // Only for a pending invite, and only ever to the person it
          // was issued to. A claimed slot has no use for it and a token
          // in a response is a token in a log.
          inviteToken: claimed ? null : s.invite_token,
          show: {
            id: show.id,
            title: show.title,
            slatedAt: show.slated_at,
            durationMinutes: show.duration_minutes,
            performanceMode: show.performance_mode,
            state: show.state,
            roomName: show.room_name,
          },
          host: host ? { displayName: host.display_name, username: host.username } : null,
        };
      })
      .filter(Boolean)
      .filter((r) => r.show.state !== 'ended');

    return NextResponse.json({ slots: out });
  } catch (err) {
    console.error('[my-slots] request failed:', err);
    return NextResponse.json({ error: 'Could not load your shows' }, { status: 500 });
  }
}
