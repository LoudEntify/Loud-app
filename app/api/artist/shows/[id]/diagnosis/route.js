// GET /api/artist/shows/[id]/diagnosis — why was the broadcast black?
//
// Answers from what the RECORDER logged, not from what anyone was
// watching. components/EgressPage.jsx — the headless browser LiveKit
// loads to compose the picture — logs `egress_track_pool_changed` with
// the number of tracks it is subscribed to. That number settles which
// half of the system to suspect, and lib/broadcastDiagnosis.js turns it
// into a sentence.
//
// WHY A ROUTE AND NOT A QUESTION. The black-frame broadcast has been
// unresolved since 2 November, and across six days I asked Korey five
// times whether his console showed a picture while YouTube showed black.
// He cannot watch his own phone and a YouTube page at the same moment
// while performing: asking him to be the instrument was asking for the
// one thing the situation makes impossible. docs/CLAUDE.md §1 says to
// instrument before fixing. This is that, late.
//
// AUTH MODEL: artist-only (`verifyArtistAuth`), and additionally scoped
// — an artist may read the diagnosis only for THEIR OWN shows, checked
// against `shows.artist_id`. health_events.show_id holds the ROOM NAME
// (app/api/health-events/route.js says so explicitly), and a room name
// is a guessable string, so without the ownership check this route hands
// a third party's show diagnostics to anyone who can guess an id.
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../../../lib/supabaseAdmin';
import { verifyArtistAuth } from '../../../../../../lib/verifyArtistAuth';
import { correlationFrom, withCorrelation } from '../../../../../../lib/correlation';
import { diagnoseBroadcast } from '../../../../../../lib/broadcastDiagnosis';

/** Enough to cover a long show's worth of pool changes without reading a whole table. */
const MAX_ROWS = 2000;

export async function GET(request, { params }) {
  const cid = correlationFrom(request);
  const auth = await verifyArtistAuth(request);
  if (auth.error) return withCorrelation(NextResponse.json({ error: auth.error }, { status: auth.status }), cid);

  const { id } = await params;
  if (!id) return withCorrelation(NextResponse.json({ error: 'Which show?' }, { status: 400 }), cid);

  const admin = getSupabaseAdmin();

  // OWNERSHIP, before anything is read.
  const { data: show } = await admin
    .from('shows')
    .select('id, artist_id, slated_at, actual_started_at')
    .eq('id', id)
    .maybeSingle();
  if (!show || show.artist_id !== auth.user.id) {
    return withCorrelation(NextResponse.json({ error: 'No show of yours with that id.' }, { status: 404 }), cid);
  }

  // The room name is the show id for a show room, which is what
  // initHealthLog is passed on both the performer and the egress side.
  const { data: rows, error } = await admin
    .from('health_events')
    .select('role, event_type, detail, created_at')
    .eq('show_id', id)
    .order('created_at', { ascending: true })
    .limit(MAX_ROWS);

  if (error) {
    return withCorrelation(NextResponse.json({ error: 'Could not read the logs for this show.' }, { status: 500 }), cid);
  }

  const diagnosis = diagnoseBroadcast(rows || []);
  return withCorrelation(NextResponse.json({
    show: { id: show.id, slatedAt: show.slated_at, startedAt: show.actual_started_at },
    diagnosis,
    // The count is here so an empty result can be told apart from a
    // result that says nothing: no rows at all and rows that mention no
    // recorder are different findings.
    rowsRead: (rows || []).length,
  }), cid);
}
