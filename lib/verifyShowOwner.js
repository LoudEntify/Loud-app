// lib/verifyShowOwner.js
// ─────────────────────────────────────────────────────────────
// "Does this artist own the show running in this room?"
//
// Shared by app/api/egress/start and app/api/egress/stop, which are the
// two routes that act on a room by NAME. One helper rather than the same
// twelve lines twice, because the failure mode of the twice version is
// the two drifting apart — and these two must agree: an artist who can
// start a recording must be able to stop it, or a show ends with a
// recorder that never switches off.
//
// ── WHY room_name AND NOT show_id ─────────────────────────────
// Because that is what LiveKit knows. Egress operates on rooms; the
// caller has a room; inventing a second identifier here would mean the
// client passing both and the two being able to disagree.
//
// ── THE GRANDFATHER CLAUSE, AND THAT IT IS A REAL GAP ─────────
// `shows.artist_id` is NULLABLE. It was added by
// docs/ownership_migration.sql, which set it where an owner could be
// matched and left it null where one could not — and the RLS policy
// written in that same migration reads
//
//     using (artist_id is null or artist_id = auth.uid())
//
// This helper deliberately mirrors that rule rather than inventing a
// stricter one, because a stricter rule here would mean an artist could
// no longer stop the recording of an older show — the recorder would run
// to the end of its own timeout, uploading, after the show finished.
//
// STATED PLAINLY, because it is a hole and it should not be buried: on a
// show whose `artist_id` is null, ANY verified artist account passes this
// check. The exposure is bounded — it is not anonymous any more, which
// was the actual finding — but it is not nothing.
//
// It closes completely the moment those rows are backfilled. The query
// to find them, and the one to fix them, are in
// docs/MORNING_MIGRATIONS.md under "Backfill show ownership". Every show
// created by components/ScheduleShow.jsx always sets artist_id, so this
// only ever applies to pilot-era rows.
// ─────────────────────────────────────────────────────────────

import 'server-only';

/**
 * @returns {{ show }} on success, or { error, status } for the route to
 *          return directly — the same shape lib/verifyArtistAuth.js
 *          uses, so a route handles both the same way.
 */
export async function verifyShowOwner(admin, room, user) {
  const { data: show, error } = await admin
    .from('shows')
    .select('id, artist_id, room_name, state')
    .eq('room_name', room)
    .maybeSingle();

  if (error) {
    // A read failure is NOT a permission failure, and must not be
    // reported as one. Telling an artist mid-show that a recording is
    // "not theirs" when the database merely hiccuped would send them
    // looking in exactly the wrong place.
    console.error('[verifyShowOwner] show lookup failed:', error);
    return { error: 'Could not verify who owns this show. Try again.', status: 503 };
  }

  if (!show) {
    return { error: 'No show is running in this room.', status: 404 };
  }

  if (show.artist_id && show.artist_id !== user.id) {
    return { error: 'This is not your show.', status: 403 };
  }

  if (!show.artist_id) {
    // Loud on purpose. This is the grandfather clause actually being
    // used, which is the signal that a backfill is outstanding — and it
    // should be visible in logs rather than inferred from its absence.
    console.warn('[verifyShowOwner] show has no artist_id — grandfathered', {
      room,
      showId: show.id,
      grantedTo: user.id,
    });
  }

  return { show };
}
