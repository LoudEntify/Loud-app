// POST /api/artist/shows/:id/tick — the console's heartbeat while live.
// Pushes the current composed layout into the egress (the fake records
// it), runs the delivery check (retry, recreate), and returns what the
// console shows: delivery state, viewers, measured delay, pending stage
// request, open prompt.
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../../../lib/supabaseAdmin';
import { verifyArtistAuth } from '../../../../../../lib/verifyArtistAuth';
import { correlationFrom, withCorrelation } from '../../../../../../lib/correlation';
import { loadOwnedShow } from '../../../../../../lib/artistShow';
import { deliveryTick } from '../../../../../../lib/pipeline/lifecycle';
import { supabaseLifecycleStore, egressFor } from '../../../../../../lib/pipeline/store';
import { composeLayout } from '../../../../../../lib/pipeline/compositor';
import { viewerCount, openPrompt } from '../../../../../../lib/showPayload';

export async function POST(request, { params }) {
  const cid = correlationFrom(request);
  const auth = await verifyArtistAuth(request);
  if (auth.error) return withCorrelation(NextResponse.json({ error: auth.error }, { status: auth.status }), cid);
  const admin = getSupabaseAdmin();
  const owned = await loadOwnedShow(admin, params.id, auth.user.id);
  if (owned.error) return withCorrelation(NextResponse.json({ error: owned.error }, { status: owned.status }), cid);
  let body; try { body = await request.json(); } catch { body = {}; }
  const { show, slot } = owned;
  const egress = egressFor(show.id);
  let delivery = { state: show.delivery_state };
  if (show.actual_started_at && !show.actual_ended_at) {
    const layout = composeLayout({ mode: show.performance_mode, view: show.versus_view, healthy: body.healthy || { a: true, b: true } });
    try { if (egress.state === 'running') egress.pushFrame({ tMs: Date.now() - Date.parse(show.actual_started_at), layout }); } catch { /* the show must never stop because the fake egress could not write */ }
    delivery = await deliveryTick(supabaseLifecycleStore(admin), egress, { showId: show.id, correlationId: cid });
  }
  const [viewers, prompt, { data: pending }, { data: fresh }, { data: delays }] = await Promise.all([
    viewerCount(admin, show.id), openPrompt(admin, show),
    admin.from('stage_requests').select('*').eq('show_id', show.id).eq('state', 'pending').order('created_at', { ascending: false }).limit(1),
    admin.from('shows').select('versus_view, delivery_state, youtube_video_id, actual_started_at, actual_ended_at, measured_delay_seconds').eq('id', show.id).single(),
    admin.from('metering_events').select('playback_position_ms, created_at').eq('show_id', show.id).not('playback_position_ms', 'is', null).order('created_at', { ascending: false }).limit(20),
  ]);
  // measured delay: server offset minus the viewers' reported playback position
  let delaySeconds = fresh?.measured_delay_seconds ?? null;
  if (fresh?.actual_started_at && delays?.length) {
    const start = Date.parse(fresh.actual_started_at);
    const samples = delays.map((d) => (Date.parse(d.created_at) - start - Number(d.playback_position_ms)) / 1000).filter((x) => Number.isFinite(x) && x >= 0 && x < 120);
    if (samples.length) { samples.sort((a, b) => a - b); delaySeconds = Math.round(samples[Math.floor(samples.length / 2)] * 100) / 100; await admin.from('shows').update({ measured_delay_seconds: delaySeconds }).eq('id', show.id); }
  }
  return withCorrelation(NextResponse.json({ slot, delivery, viewers, prompt, pendingRequest: pending?.[0] || null, versusView: fresh?.versus_view, youtubeVideoId: fresh?.youtube_video_id, delaySeconds, live: Boolean(fresh?.actual_started_at && !fresh?.actual_ended_at) }), cid);
}
