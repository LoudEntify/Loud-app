import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { rateLimit, clientKey } from '../../../lib/rateLimit';
import { rowEnv } from '../../../lib/rowEnv';

// ── ITEM 4: WHO WATCHED, AND FOR HOW LONG ─────────────────────
//
// The pilot's evidence base. Two writes:
//
//   join   upsert one row per CONNECTION, keyed on
//          (show_id, livekit_identity) -- the conflict target
//          pilot2_02 creates, deliberately non-partial so PostgREST can
//          infer it.
//   leave  close that row with left_at + left_source = 'beacon'.
//
// ── AUTH MODEL: DELIBERATELY OPEN, RATE-LIMITED ───────────────
//
// Same posture and the same reasoning as /api/health-events, which this
// sits beside:
//
//   1. THE PEOPLE THIS IS ABOUT HAVE NO ACCOUNT. Counting the audience
//      is the entire point, and most of the pilot audience is not signed
//      in -- that is exactly why viewer_id carries the work. Requiring a
//      session here would discard the majority of the measurement and
//      leave a number that looks real and describes only signed-in
//      users.
//   2. THE BLAST RADIUS IS A TABLE NOBODY READS. viewer_sessions has RLS
//      on with zero policies; only the service role sees it, and no
//      product surface renders it. The realistic abuse is inflating a
//      count, not disclosure.
//   3. IT CANNOT BE USED TO READ ANYTHING. There is no GET. A caller can
//      add a row or close one they can name; they cannot enumerate.
//
// What that does mean: the unique-viewer count is a count of what
// clients reported, not a measurement anyone could not have forged. For
// a pilot measuring genuine audience behaviour that is the right trade;
// it should not be quoted as an adversarial number.
//
// The leave write is scoped to (show_id, livekit_identity) and only ever
// sets left_at/left_source, so the worst a forged leave does is close a
// session early -- visible on the 21st as a short watch time, not as
// missing data.

const RATE_LIMIT = { limit: 120, windowMs: 60000 };
const MAX_STRING = 200;

function bounded(value, max = MAX_STRING) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (!s) return null;
  return s.slice(0, max);
}

export async function POST(request) {
  try {
    const gate = rateLimit(clientKey(request, 'viewer-session'), RATE_LIMIT);
    if (!gate.ok) {
      return NextResponse.json(
        { ok: false, error: 'Rate limited' },
        { status: 429, headers: { 'Retry-After': String(gate.retryAfterSec) } }
      );
    }

    const body = await request.json().catch(() => ({}));
    const action = body.action === 'leave' ? 'leave' : 'join';
    const showId = bounded(body.showId);
    const livekitIdentity = bounded(body.livekitIdentity);

    // show_id is a uuid FK -- a viewer session only ever happens inside a
    // real scheduled show. Without one there is nothing to attach to and
    // the row would fail the FK anyway; refusing here makes that legible
    // instead of a 500.
    if (!showId) return NextResponse.json({ ok: false, error: 'showId is required' }, { status: 400 });

    const admin = getSupabaseAdmin();

    if (action === 'leave') {
      if (!livekitIdentity) {
        return NextResponse.json({ ok: false, error: 'livekitIdentity is required to leave' }, { status: 400 });
      }
      // ── FIRST LEAVE WINS ──────────────────────────────────────
      // `.is('left_at', null)` so a beacon cannot overwrite an earlier,
      // more authoritative close. Today that only guards a duplicate
      // beacon; it matters more when item 9's participant_left webhook
      // lands in the 22-26 window, because that source is authoritative
      // and must not be clobbered by a late beacon from the same device.
      //
      // Note the ranking that implies: a beacon may not overwrite a
      // webhook, and neither may be overwritten by the sweep. The sweep
      // (in /api/room/close) applies the same guard.
      const { error } = await admin
        .from('viewer_sessions')
        .update({ left_at: new Date().toISOString(), left_source: 'beacon' })
        .eq('show_id', showId)
        .eq('livekit_identity', livekitIdentity)
        .is('left_at', null);
      if (error) {
        console.warn('[viewer-session] leave failed:', error);
        return NextResponse.json({ ok: false, error: 'Leave failed' }, { status: 500 });
      }
      return NextResponse.json({ ok: true });
    }

    const viewerId = bounded(body.viewerId);
    if (!viewerId) return NextResponse.json({ ok: false, error: 'viewerId is required' }, { status: 400 });

    // ── WHY THIS IS AN UPSERT AND NOT AN INSERT ───────────────
    // One row per CONNECTION. A client that re-sends its join -- a
    // reconnect, a re-render, a retry -- must update the row it already
    // has rather than create a second session for the same person, which
    // would double the unique-viewer count for anyone with a flaky
    // connection.
    //
    // onConflict names the PLAIN unique index from pilot2_02. It must
    // stay exactly 'show_id,livekit_identity': a partial index cannot be
    // an ON CONFLICT target and supabase-js cannot emit an index
    // predicate, which is the 42P10 that cost a morning on 12 Sep.
    const row = {
      show_id: showId,
      room_name: bounded(body.roomName),
      viewer_id: viewerId,
      livekit_identity: livekitIdentity,
      user_id: bounded(body.userId),
      display_name: bounded(body.displayName, 120),
      email: bounded(body.email, 254),
      age_confirmed_at: body.ageConfirmedAt ? new Date(body.ageConfirmedAt).toISOString() : null,
      user_agent: bounded(request.headers.get('user-agent'), 400),
      env: rowEnv(),
    };

    const { error } = await admin
      .from('viewer_sessions')
      .upsert(row, { onConflict: 'show_id,livekit_identity' });

    if (error) {
      // The real Postgres message goes back. A generic failure here is
      // what let the reactions write be broken for weeks: the route
      // warned to a log nobody read and the client ignored the response
      // by design, so an empty table and correct code looked identical.
      console.warn('[viewer-session] join failed:', error);
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.warn('[viewer-session] request failed:', err);
    return NextResponse.json({ ok: false, error: String(err?.message || err) }, { status: 500 });
  }
}
