// POST /api/artist/shows/:id/versus { action: 'conversation' | 'perform' }
// Conversation switches at once; Perform while the other artist is on
// stage creates a stage request the performing artist must answer. The
// current view is a show-level fact; every change is audited.
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../../../lib/supabaseAdmin';
import { verifyArtistAuth } from '../../../../../../lib/verifyArtistAuth';
import { correlationFrom, withCorrelation } from '../../../../../../lib/correlation';
import { loadOwnedShow } from '../../../../../../lib/artistShow';
import { decideAction } from '../../../../../../lib/pipeline/stageRequests';
import { recordAuditEvent } from '../../../../../../lib/audit';

export async function POST(request, { params }) {
  const cid = correlationFrom(request);
  const auth = await verifyArtistAuth(request);
  if (auth.error) return withCorrelation(NextResponse.json({ error: auth.error }, { status: auth.status }), cid);
  const admin = getSupabaseAdmin();
  const owned = await loadOwnedShow(admin, params.id, auth.user.id);
  if (owned.error) return withCorrelation(NextResponse.json({ error: owned.error }, { status: owned.status }), cid);
  const { show, slot } = owned;
  if (show.performance_mode !== 'versus') return withCorrelation(NextResponse.json({ error: 'Not a Versus show.' }, { status: 409 }), cid);
  let body; try { body = await request.json(); } catch { body = {}; }
  const { data: pendingRows } = await admin.from('stage_requests').select('*').eq('show_id', show.id).eq('state', 'pending').order('created_at', { ascending: false }).limit(1);
  const decision = decideAction({ currentView: show.versus_view, slot, action: body.action, pending: pendingRows?.[0] || null });
  if (decision.kind === 'set_view') {
    await admin.from('shows').update({ versus_view: decision.view }).eq('id', show.id);
    if (pendingRows?.[0]) await admin.from('stage_requests').update({ state: 'cancelled', resolved_at: new Date().toISOString() }).eq('id', pendingRows[0].id);
    await recordAuditEvent(admin, { actorType: 'artist', actorId: auth.user.id, action: 'show.versus_view_changed', subjectType: 'show', subjectId: show.id, correlationId: cid, before: { view: show.versus_view }, after: { view: decision.view } });
    return withCorrelation(NextResponse.json({ ok: true, view: decision.view }), cid);
  }
  if (decision.kind === 'request') {
    const { data: req } = await admin.from('stage_requests').insert({ show_id: show.id, from_slot: decision.from, to_slot: decision.to, correlation_id: cid }).select('*').single();
    await recordAuditEvent(admin, { actorType: 'artist', actorId: auth.user.id, action: 'show.stage_requested', subjectType: 'show', subjectId: show.id, correlationId: cid, after: { from: decision.from, to: decision.to, request_id: req?.id } });
    return withCorrelation(NextResponse.json({ ok: true, request: req }), cid);
  }
  return withCorrelation(NextResponse.json({ ok: true, noop: decision.reason, view: show.versus_view }), cid);
}
