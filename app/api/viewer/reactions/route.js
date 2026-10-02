// POST /api/viewer/reactions — free reactions, stamped with playback
// position and (in Versus) the artist they are for. Design on hold (PRD
// row 102); the data path exists so blended scoring can be built on it.
// Requires a session.
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin';
import { rateLimit } from '../../../../lib/rateLimit';
import { correlationFrom, withCorrelation } from '../../../../lib/correlation';
import { requireSession } from '../../../../lib/viewerAuth';

export async function POST(request) {
  const cid = correlationFrom(request);
  const session = await requireSession(request);
  if (session.error) return withCorrelation(NextResponse.json({ error: session.error }, { status: session.status }), cid);
  const gate = rateLimit(`react:${session.user.id}`, { limit: 120, windowMs: 60000 });
  if (!gate.ok) return withCorrelation(NextResponse.json({ error: 'Slow down a little.' }, { status: 429 }), cid);
  let body; try { body = await request.json(); } catch { body = {}; }
  const emoji = String(body.emoji || '').slice(0, 16);
  if (!emoji || !body.showId) return withCorrelation(NextResponse.json({ error: 'emoji and showId are required.' }, { status: 400 }), cid);
  const slot = body.artistSlot === 'a' || body.artistSlot === 'b' ? body.artistSlot : null;
  const pos = Number.isFinite(Number(body.playbackPositionMs)) ? Math.max(0, Math.trunc(Number(body.playbackPositionMs))) : null;
  const admin = getSupabaseAdmin();
  const { error } = await admin.from('reaction_events').insert({
    show_id: String(body.showId), user_id: session.user.id, emoji, tokens_spent: 0, playback_position_ms: pos, artist_slot: slot,
    viewer_id: typeof body.viewerId === 'string' ? body.viewerId.slice(0, 200) : null, correlation_id: cid,
  });
  if (error) return withCorrelation(NextResponse.json({ error: 'Could not send that.' }, { status: 500 }), cid);
  return withCorrelation(NextResponse.json({ ok: true }), cid);
}
