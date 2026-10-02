// /api/viewer/comments — the show chat under YouTube delivery.
// GET ?show=  open, rate-limited, returns the last 60 (safe fields only:
//             author name, body, playback position; never viewer ids).
// POST        requires a session (any action opens sign-up for guests),
//             stamps the viewer's playback position, filters hidden words.
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin';
import { rateLimit, clientKey } from '../../../../lib/rateLimit';
import { correlationFrom, withCorrelation } from '../../../../lib/correlation';
import { requireSession } from '../../../../lib/viewerAuth';
import { rowEnv } from '../../../../lib/rowEnv';

const MAX_BODY = 500;
const PLATFORM_HIDDEN_WORDS = ['kys']; // the platform list; artists add their own in Settings (Phase 3)

export function hiddenWordHit(body, words = PLATFORM_HIDDEN_WORDS) {
  const lower = ` ${String(body).toLowerCase()} `;
  return words.find((w) => lower.includes(` ${w.toLowerCase()} `)) || null;
}

export async function GET(request) {
  const cid = correlationFrom(request);
  const gate = rateLimit(clientKey(request, 'viewer-comments-get'), { limit: 300, windowMs: 60000 });
  if (!gate.ok) return withCorrelation(NextResponse.json({ error: 'Rate limited' }, { status: 429 }), cid);
  const url = new URL(request.url);
  const showId = url.searchParams.get('show');
  const after = Number(url.searchParams.get('after') || 0);
  if (!showId) return withCorrelation(NextResponse.json({ error: 'show is required' }, { status: 400 }), cid);
  const admin = getSupabaseAdmin();
  let q = admin.from('show_comments').select('id, author_name, body, playback_position_ms, created_at, user_id').eq('show_id', showId).is('deleted_at', null).order('id', { ascending: false }).limit(60);
  if (after) q = q.gt('id', after);
  const { data, error } = await q;
  if (error) return withCorrelation(NextResponse.json({ error: 'Could not load the chat.' }, { status: 503 }), cid);
  const comments = (data || []).reverse().map((c) => ({ id: c.id, author: c.author_name || 'viewer', body: c.body, playbackPositionMs: c.playback_position_ms, at: c.created_at, isArtist: false }));
  return withCorrelation(NextResponse.json({ comments }), cid);
}

export async function POST(request) {
  const cid = correlationFrom(request);
  const session = await requireSession(request);
  if (session.error) return withCorrelation(NextResponse.json({ error: session.error }, { status: session.status }), cid);
  const gate = rateLimit(`comments:${session.user.id}`, { limit: 30, windowMs: 60000 });
  if (!gate.ok) return withCorrelation(NextResponse.json({ error: 'Slow down a little.' }, { status: 429 }), cid);
  let body;
  try { body = await request.json(); } catch { body = {}; }
  const text = String(body.body || '').trim().slice(0, MAX_BODY);
  if (!text || !body.showId) return withCorrelation(NextResponse.json({ error: 'Say something first.' }, { status: 400 }), cid);
  const hit = hiddenWordHit(text);
  if (hit) return withCorrelation(NextResponse.json({ error: "That word isn't allowed here." }, { status: 422 }), cid);
  const admin = getSupabaseAdmin();
  const { data: show } = await admin.from('shows').select('id, room_name, actual_started_at').eq('id', body.showId).maybeSingle();
  if (!show) return withCorrelation(NextResponse.json({ error: 'No such show.' }, { status: 404 }), cid);
  const pos = Number.isFinite(Number(body.playbackPositionMs)) ? Math.max(0, Math.trunc(Number(body.playbackPositionMs))) : null;
  const offset = show.actual_started_at ? Math.max(0, Date.now() - Date.parse(show.actual_started_at)) : null;
  const row = {
    show_id: show.id, room_name: show.room_name, body: text, author_name: session.profile?.display_name || 'viewer', user_id: session.user.id,
    viewer_id: typeof body.viewerId === 'string' ? body.viewerId.slice(0, 200) : null, offset_ms: offset, playback_position_ms: pos,
    client_ts: new Date().toISOString(), env: rowEnv(), correlation_id: cid,
  };
  const { data, error } = await admin.from('show_comments').insert(row).select('id, created_at').single();
  if (error) return withCorrelation(NextResponse.json({ error: 'Could not send that. Try again.' }, { status: 500 }), cid);
  return withCorrelation(NextResponse.json({ ok: true, comment: { id: data.id, author: row.author_name, body: text, playbackPositionMs: pos, at: data.created_at } }), cid);
}
