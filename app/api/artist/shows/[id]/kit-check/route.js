// POST /api/artist/shows/:id/kit-check { items: [{item, status, detail}] } — PRD 118.
// Results per item are kept (and the journey step "kitcheck.item" is the
// instrumentation docs/USER_JOURNEY.md asks for). :id may be 'none' for a
// rehearsal with no show booked.
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../../../lib/supabaseAdmin';
import { verifyArtistAuth } from '../../../../../../lib/verifyArtistAuth';
import { correlationFrom, withCorrelation } from '../../../../../../lib/correlation';
import { rowEnv } from '../../../../../../lib/rowEnv';

const ITEMS = new Set(['mic_signal', 'camera_frames', 'connection', 'charging', 'dnd', 'headphones', 'framing']);
export async function POST(request, { params }) {
  const cid = correlationFrom(request);
  const auth = await verifyArtistAuth(request);
  if (auth.error) return withCorrelation(NextResponse.json({ error: auth.error }, { status: auth.status }), cid);
  let body; try { body = await request.json(); } catch { body = {}; }
  const admin = getSupabaseAdmin();
  const showId = params.id === 'none' ? null : params.id;
  if (showId) {
    const { data: s } = await admin.from('shows').select('artist_id, artist_b_id').eq('id', showId).maybeSingle();
    if (!s || (s.artist_id !== auth.user.id && s.artist_b_id !== auth.user.id)) return withCorrelation(NextResponse.json({ error: 'Not your show.' }, { status: 403 }), cid);
  }
  const rows = (Array.isArray(body.items) ? body.items : []).filter((i) => ITEMS.has(i?.item) && ['ready', 'checking', 'fix', 'skipped'].includes(i?.status)).map((i) => ({ show_id: showId, artist_id: auth.user.id, item: i.item, status: i.status, detail: String(i.detail || '').slice(0, 200) || null, correlation_id: cid }));
  if (rows.length) await admin.from('kit_check_results').insert(rows);
  await admin.from('journey_events').insert(rows.map((r) => ({ viewer_id: `artist:${auth.user.id}`, event: 'kitcheck.item', props: { item: r.item, status: r.status }, show_id: showId, correlation_id: cid, env: rowEnv() })));
  return withCorrelation(NextResponse.json({ ok: true, saved: rows.length }), cid);
}
