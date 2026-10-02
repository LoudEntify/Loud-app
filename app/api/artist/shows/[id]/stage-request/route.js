// POST /api/artist/shows/:id/stage-request { requestId, answer: 'handover' | 'not_yet' }
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../../../lib/supabaseAdmin';
import { verifyArtistAuth } from '../../../../../../lib/verifyArtistAuth';
import { correlationFrom, withCorrelation } from '../../../../../../lib/correlation';
import { loadOwnedShow } from '../../../../../../lib/artistShow';
import { resolveRequest } from '../../../../../../lib/pipeline/stageRequests';
import { recordAuditEvent } from '../../../../../../lib/audit';

export async function POST(request, { params }) {
  const cid = correlationFrom(request);
  const auth = await verifyArtistAuth(request);
  if (auth.error) return withCorrelation(NextResponse.json({ error: auth.error }, { status: auth.status }), cid);
  const admin = getSupabaseAdmin();
  const owned = await loadOwnedShow(admin, params.id, auth.user.id);
  if (owned.error) return withCorrelation(NextResponse.json({ error: owned.error }, { status: owned.status }), cid);
  const { show, slot } = owned;
  let body; try { body = await request.json(); } catch { body = {}; }
  const { data: req } = await admin.from('stage_requests').select('*').eq('id', body.requestId || '').eq('show_id', show.id).maybeSingle();
  const r = resolveRequest({ request: req, by: slot, answer: body.answer === 'handover' ? 'handover' : 'not_yet' });
  if (r.error) return withCorrelation(NextResponse.json({ error: r.error === 'not_yours_to_answer' ? 'Only the artist on stage can answer.' : 'No request waiting.' }, { status: r.error === 'not_yours_to_answer' ? 403 : 404 }), cid);
  await admin.from('stage_requests').update({ state: r.state, resolved_at: new Date().toISOString() }).eq('id', req.id);
  if (r.view) await admin.from('shows').update({ versus_view: r.view }).eq('id', show.id);
  await recordAuditEvent(admin, { actorType: 'artist', actorId: auth.user.id, action: `show.stage_request_${r.state}`, subjectType: 'show', subjectId: show.id, correlationId: cid, before: { view: show.versus_view }, after: { view: r.view || show.versus_view, request_id: req.id } });
  return withCorrelation(NextResponse.json({ ok: true, state: r.state, view: r.view || show.versus_view }), cid);
}
