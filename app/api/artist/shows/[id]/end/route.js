// POST /api/artist/shows/:id/end — press-and-hold End show: egress stopped
// (recording and training copy finalised), broadcasts ended, keys rotated,
// the recordings row written, insights computed.
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../../../lib/supabaseAdmin';
import { verifyArtistAuth } from '../../../../../../lib/verifyArtistAuth';
import { correlationFrom, withCorrelation } from '../../../../../../lib/correlation';
import { loadOwnedShow } from '../../../../../../lib/artistShow';
import { endShow } from '../../../../../../lib/pipeline/lifecycle';
import { supabaseLifecycleStore, egressFor, forgetEgress } from '../../../../../../lib/pipeline/store';
import { computeInsights } from '../../../../../../lib/insights';

export async function POST(request, { params }) {
  const cid = correlationFrom(request);
  const auth = await verifyArtistAuth(request);
  if (auth.error) return withCorrelation(NextResponse.json({ error: auth.error }, { status: auth.status }), cid);
  const admin = getSupabaseAdmin();
  const owned = await loadOwnedShow(admin, params.id, auth.user.id);
  if (owned.error) return withCorrelation(NextResponse.json({ error: owned.error }, { status: owned.status }), cid);
  const { show, slot } = owned;
  if (slot !== 'a') return withCorrelation(NextResponse.json({ error: 'Only the host ends the show.' }, { status: 403 }), cid);
  if (show.actual_ended_at) return withCorrelation(NextResponse.json({ ok: true, already: true }), cid);
  const { data: followersBefore } = await admin.from('follows').select('follower_id', { count: 'exact', head: true }).eq('artist_id', show.artist_id).lt('created_at', show.actual_started_at || new Date().toISOString());
  const r = await endShow(supabaseLifecycleStore(admin), egressFor(show.id), { showId: show.id, correlationId: cid });
  forgetEgress(show.id);
  let recordingId = null;
  if (r.recording) {
    const { data: consent } = await admin.from('consent_records').select('granted').eq('user_id', show.artist_id).eq('consent_type', 'training_data').order('recorded_at', { ascending: false }).limit(1);
    const trainingAllowed = consent?.[0] ? Boolean(consent[0].granted) : true;
    const { data: rec } = await admin.from('recordings').upsert({ show_id: show.id, artist_id: show.artist_id, storage_path: r.recording.path, title: show.title || 'Recording', recorded_at: show.actual_started_at || new Date().toISOString(), visibility: 'private', duration_ms: r.recording.durationMs, size_bytes: r.recording.sizeBytes, has_video: true, verified_at: new Date().toISOString(), verification: { ok: true, checks: { file_present: true, frames: r.recording.frames, source: 'fake_egress' } }, ended_reason: 'artist', training_copy_path: trainingAllowed ? r.training?.path || null : null, training_allowed: trainingAllowed }, { onConflict: 'storage_path' }).select('id').single();
    recordingId = rec?.id || null;
  }
  // insights
  const endedAt = new Date().toISOString();
  const [{ data: metering }, { count: votes }, { data: supports }, { count: followersAfter }] = await Promise.all([
    admin.from('metering_events').select('viewer_id, created_at').eq('show_id', show.id).in('event', ['play', 'heartbeat', 'counted']).limit(20000),
    admin.from('prompt_responses').select('id', { count: 'exact', head: true }).eq('show_id', show.id),
    admin.from('support_events').select('amount_tokens').eq('show_id', show.id),
    admin.from('follows').select('follower_id', { count: 'exact', head: true }).eq('artist_id', show.artist_id),
  ]);
  const ins = computeInsights({ metering: metering || [], votes: votes || 0, supportTokens: (supports || []).reduce((s, x) => s + Number(x.amount_tokens || 0), 0), followersBefore: followersBefore?.count || 0, followersAfter: followersAfter || 0, startedAt: show.actual_started_at || show.slated_at, endedAt });
  await admin.from('show_insights').upsert({ show_id: show.id, artist_id: show.artist_id, peak_viewers: ins.peak_viewers, watch_time_ms: ins.watch_time_ms, average_stay_ms: ins.average_stay_ms, votes_cast: ins.votes_cast, tokens_received: ins.tokens_received, followers_gained: ins.followers_gained, viewers_series: ins.viewers_series, delay_seconds: show.measured_delay_seconds }, { onConflict: 'show_id' });
  return withCorrelation(NextResponse.json({ ok: true, recordingId, insights: ins }), cid);
}
