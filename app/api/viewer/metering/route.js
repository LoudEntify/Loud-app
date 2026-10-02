// POST /api/viewer/metering — player events for viewer-hour metering (PRD
// row 144). Open: guests are metered too, pseudonymously. Rate-limited per
// client; 'counted' is de-duplicated per (viewer, show). Never blocks
// playback: the client fires and forgets.
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin';
import { rateLimit, clientKey } from '../../../../lib/rateLimit';
import { correlationFrom, withCorrelation } from '../../../../lib/correlation';
import { METERING_EVENTS } from '../../../../lib/metering';
import { rowEnv } from '../../../../lib/rowEnv';

export async function POST(request) {
  const cid = correlationFrom(request);
  const gate = rateLimit(clientKey(request, 'metering'), { limit: 120, windowMs: 60000 });
  if (!gate.ok) return withCorrelation(NextResponse.json({ ok: false }, { status: 429 }), cid);
  let body; try { body = await request.json(); } catch { body = {}; }
  const events = Array.isArray(body.events) ? body.events.slice(0, 20) : [];
  const viewerId = typeof body.viewerId === 'string' ? body.viewerId.slice(0, 200) : null;
  if (!viewerId || !body.showId || !events.length) return withCorrelation(NextResponse.json({ ok: true, inserted: 0 }), cid);
  const admin = getSupabaseAdmin();
  let rows = events.filter((e) => METERING_EVENTS.includes(e?.event)).map((e) => ({
    show_id: String(body.showId), viewer_id: viewerId, user_id: body.userId || null, event: e.event,
    playback_position_ms: Number.isFinite(Number(e.playbackPositionMs)) ? Math.max(0, Math.trunc(Number(e.playbackPositionMs))) : null,
    client_ts: e.clientTs ? new Date(e.clientTs).toISOString() : new Date().toISOString(), source: typeof e.source === 'string' ? e.source.slice(0, 32) : null,
    correlation_id: cid, env: rowEnv(),
  }));
  if (rows.some((r) => r.event === 'counted')) {
    const { data } = await admin.from('metering_events').select('id').eq('show_id', String(body.showId)).eq('viewer_id', viewerId).eq('event', 'counted').limit(1);
    if (data?.length) rows = rows.filter((r) => r.event !== 'counted');
  }
  if (!rows.length) return withCorrelation(NextResponse.json({ ok: true, inserted: 0 }), cid);
  const { error } = await admin.from('metering_events').insert(rows);
  return withCorrelation(NextResponse.json({ ok: !error, inserted: error ? 0 : rows.length }), cid);
}
