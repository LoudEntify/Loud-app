// PUT /api/artist/shows/:id/look { lut, strength } — the look on screen
// for this show (shows.look, a show-level fact like versus_view). Either
// artist of the show may change it; the change is audited and the next
// tick carries it to the egress (lut.js lookPlan, logged per frame).
// Auth: verifyArtistAuth (bearer → artist) + loadOwnedShow.
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../../../lib/supabaseAdmin';
import { verifyArtistAuth } from '../../../../../../lib/verifyArtistAuth';
import { correlationFrom, withCorrelation } from '../../../../../../lib/correlation';
import { loadOwnedShow } from '../../../../../../lib/artistShow';
import { recordAuditEvent } from '../../../../../../lib/audit';
import { normaliseDirection } from '../../../../../../lib/direction';

export async function PUT(request, { params }) {
  const cid = correlationFrom(request);
  const auth = await verifyArtistAuth(request);
  if (auth.error) return withCorrelation(NextResponse.json({ error: auth.error }, { status: auth.status }), cid);
  const admin = getSupabaseAdmin();
  const owned = await loadOwnedShow(admin, params.id, auth.user.id);
  if (owned.error) return withCorrelation(NextResponse.json({ error: owned.error }, { status: owned.status }), cid);
  const { show } = owned;
  if (show.actual_ended_at) return withCorrelation(NextResponse.json({ error: 'The show has ended.' }, { status: 409 }), cid);
  let body; try { body = await request.json(); } catch { body = {}; }
  const look = normaliseDirection({ look: body }).look;
  const { error } = await admin.from('shows').update({ look }).eq('id', show.id);
  if (error) return withCorrelation(NextResponse.json({ error: 'Could not save the look.' }, { status: 500 }), cid);
  await recordAuditEvent(admin, { actorType: 'artist', actorId: auth.user.id, action: 'show.look_changed', subjectType: 'show', subjectId: show.id, correlationId: cid, before: { look: show.look ?? null }, after: { look } });
  return withCorrelation(NextResponse.json({ ok: true, look }), cid);
}
