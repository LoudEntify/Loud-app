// POST /api/events — journey events (PRD row 165), pseudonymous, batched,
// open and rate-limited. The client already strips names, emails and
// message bodies (lib/telemetry.js); this route drops anything oversized.
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { rateLimit, clientKey } from '../../../lib/rateLimit';
import { correlationFrom, withCorrelation } from '../../../lib/correlation';
import { rowEnv } from '../../../lib/rowEnv';

const FORBIDDEN = new Set(['email', 'name', 'display_name', 'full_name', 'body', 'message', 'password', 'token']);
const UUID = /^[0-9a-f-]{36}$/i;

export async function POST(request) {
  const cid = correlationFrom(request);
  const gate = rateLimit(clientKey(request, 'events'), { limit: 120, windowMs: 60000 });
  if (!gate.ok) return withCorrelation(NextResponse.json({ ok: false }, { status: 429 }), cid);
  let body; try { body = await request.json(); } catch { body = {}; }
  const viewerId = typeof body.viewerId === 'string' ? body.viewerId.slice(0, 200) : null;
  const events = Array.isArray(body.events) ? body.events.slice(0, 50) : [];
  if (!viewerId || !events.length) return withCorrelation(NextResponse.json({ ok: true, inserted: 0 }), cid);
  const rows = events.filter((e) => typeof e?.event === 'string' && e.event.length <= 64).map((e) => {
    const props = {};
    for (const [k, v] of Object.entries(e.props || {})) {
      if (FORBIDDEN.has(k.toLowerCase())) continue;
      if (typeof v === 'string' && v.length > 120) continue;
      if (['string', 'number', 'boolean'].includes(typeof v) || v === null) props[k] = v;
    }
    return { viewer_id: viewerId, event: e.event, props, show_id: UUID.test(e.showId || '') ? e.showId : null, correlation_id: UUID.test(e.correlationId || '') ? e.correlationId : cid, env: rowEnv() };
  });
  if (!rows.length) return withCorrelation(NextResponse.json({ ok: true, inserted: 0 }), cid);
  const { error } = await getSupabaseAdmin().from('journey_events').insert(rows);
  return withCorrelation(NextResponse.json({ ok: !error, inserted: error ? 0 : rows.length }), cid);
}
