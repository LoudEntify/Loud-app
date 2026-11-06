// GET/PUT /api/artist/audio — the artist's vocal chain settings
// (lib/audio/chain.js; design/AudioSettings.dc.html). GET returns the
// normalised settings (the preset when no row). PUT replaces them; every
// change is audited with before/after. Writes are service-role only, so
// the table needs no client write policy.
//
// The same seven numbers drive the browser's Web Audio graph and the
// phone's native DSP (LoudVocalChain.kt), so this route is where a
// preset tuned at home becomes the preset that goes to a venue — and the
// reason both platforms read one definition rather than keeping their
// own copy.
//
// Auth: verifyArtistAuth (bearer → artist).
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin';
import { verifyArtistAuth } from '../../../../lib/verifyArtistAuth';
import { correlationFrom, withCorrelation } from '../../../../lib/correlation';
import { recordAuditEvent } from '../../../../lib/audit';
import { chainFromRow, chainToRow, normaliseChain } from '../../../../lib/audio/chain';

async function load(admin, artistId) {
  const { data } = await admin.from('audio_settings').select('settings, updated_at').eq('artist_id', artistId).maybeSingle();
  return { settings: chainFromRow(data), updatedAt: data?.updated_at || null, exists: Boolean(data) };
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
  const next = normaliseChain(body.settings ?? body);
  const row = chainToRow(auth.user.id, next);
  const { error } = await admin.from('audio_settings').upsert(row, { onConflict: 'artist_id' });
  if (error) return withCorrelation(NextResponse.json({ error: 'Could not save. Try again.' }, { status: 500 }), cid);
  await recordAuditEvent(admin, { actorType: 'artist', actorId: auth.user.id, action: 'audio.settings_changed', subjectType: 'artist', subjectId: auth.user.id, correlationId: cid, before: before.settings, after: next });
  return withCorrelation(NextResponse.json({ ok: true, settings: next, updatedAt: row.updated_at }), cid);
}
