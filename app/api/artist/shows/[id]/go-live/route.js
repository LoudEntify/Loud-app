// POST /api/artist/shows/:id/go-live — the countdown reached zero (or the
// artist is in Kit Check at the slot): start the egress and the broadcast.
// Only inside the window (slot − 30 min to close): no unscheduled go-live.
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../../../lib/supabaseAdmin';
import { verifyArtistAuth } from '../../../../../../lib/verifyArtistAuth';
import { correlationFrom, withCorrelation } from '../../../../../../lib/correlation';
import { loadOwnedShow } from '../../../../../../lib/artistShow';
import { goLive } from '../../../../../../lib/pipeline/lifecycle';
import { supabaseLifecycleStore, egressFor } from '../../../../../../lib/pipeline/store';
import { windowOpensAt, windowClosesAt } from '../../../../../../lib/showWindow';

export async function POST(request, { params }) {
  const cid = correlationFrom(request);
  const auth = await verifyArtistAuth(request);
  if (auth.error) return withCorrelation(NextResponse.json({ error: auth.error }, { status: auth.status }), cid);
  const admin = getSupabaseAdmin();
  const owned = await loadOwnedShow(admin, params.id, auth.user.id);
  if (owned.error) return withCorrelation(NextResponse.json({ error: owned.error }, { status: owned.status }), cid);
  const { show } = owned;
  if (show.actual_ended_at || show.cancelled_at) return withCorrelation(NextResponse.json({ error: 'This show has ended.' }, { status: 409 }), cid);
  if (show.actual_started_at) return withCorrelation(NextResponse.json({ ok: true, already: true }), cid);
  const now = Date.now();
  const force = process.env.LOUDENTIFY_LOCAL_STACK === '1' && request.headers.get('x-loudentify-test') === 'force-live';
  if (!force && (now < windowOpensAt(show) || now > windowClosesAt(show))) return withCorrelation(NextResponse.json({ error: 'Your show can only start inside its booked window.' }, { status: 409 }), cid);
  const { data: consent } = await admin.from('consent_records').select('granted').eq('user_id', show.artist_id).eq('consent_type', 'training_data').order('recorded_at', { ascending: false }).limit(1);
  const trainingAllowed = consent?.[0] ? Boolean(consent[0].granted) : true;
  const r = await goLive(supabaseLifecycleStore(admin), egressFor(show.id), { showId: show.id, correlationId: cid, trainingAllowed });
  return withCorrelation(NextResponse.json(r), cid);
}
