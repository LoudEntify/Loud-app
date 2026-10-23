// GET/PUT /api/artist/direction — the artist's direction settings
// (lib/direction.js; design/DirectionSettings.dc.html). GET returns the
// normalised settings (defaults when no row). PUT replaces them; every
// change is audited with before/after. Writes are service-role only, so
// the table needs no client write policy.
// Auth: verifyArtistAuth (bearer → artist).
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin';
import { verifyArtistAuth } from '../../../../lib/verifyArtistAuth';
import { correlationFrom, withCorrelation } from '../../../../lib/correlation';
import { recordAuditEvent } from '../../../../lib/audit';
import { directionFromRow, directionToRow, normaliseDirection } from '../../../../lib/direction';

async function load(admin, artistId) {
  const { data } = await admin.from('direction_settings').select('settings, updated_at').eq('artist_id', artistId).maybeSingle();
  return { settings: directionFromRow(data), updatedAt: data?.updated_at || null, exists: Boolean(data) };
}

export async function GET(request) {
  const cid = correlationFrom(request);
  const auth = await verifyArtistAuth(request);
  if (auth.error) return withCorrelation(NextResponse.json({ error: auth.error }, { status: auth.status }), cid);
  const r = await load(getSupabaseAdmin(), auth.user.id);
  return withCorrelation(NextResponse.json({ settings: r.settings, updatedAt: r.updatedAt, saved: r.exists }), cid);
}

export async function PUT(request) {
  const cid = correlationFrom(request);
  const auth = await verifyArtistAuth(request);
  if (auth.error) return withCorrelation(NextResponse.json({ error: auth.error }, { status: auth.status }), cid);
  let body; try { body = await request.json(); } catch { body = null; }
  if (!body || typeof body !== 'object') return withCorrelation(NextResponse.json({ error: 'Send the settings object.' }, { status: 400 }), cid);
  const admin = getSupabaseAdmin();
  const before = await load(admin, auth.user.id);
  const next = normaliseDirection(body.settings ?? body);
  const row = directionToRow(auth.user.id, next);
  const { error } = await admin.from('direction_settings').upsert(row, { onConflict: 'artist_id' });
  if (error) return withCorrelation(NextResponse.json({ error: 'Could not save. Try again.' }, { status: 500 }), cid);
  await recordAuditEvent(admin, { actorType: 'artist', actorId: auth.user.id, action: 'direction.settings_changed', subjectType: 'artist', subjectId: auth.user.id, correlationId: cid, before: before.settings, after: next });
  return withCorrelation(NextResponse.json({ ok: true, settings: next, updatedAt: row.updated_at }), cid);
}
