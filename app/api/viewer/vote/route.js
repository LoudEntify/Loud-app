// POST /api/viewer/vote — one vote per account, changeable until voting
// closes, with the grace window and playback-position alignment from
// lib/alignment.js. PRD row 101. Requires a session.
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin';
import { rateLimit } from '../../../../lib/rateLimit';
import { correlationFrom, withCorrelation } from '../../../../lib/correlation';
import { requireSession } from '../../../../lib/viewerAuth';
import { voteDecision } from '../../../../lib/alignment';
import { rowEnv } from '../../../../lib/rowEnv';

export async function POST(request) {
  const cid = correlationFrom(request);
  const session = await requireSession(request);
  if (session.error) return withCorrelation(NextResponse.json({ error: session.error }, { status: session.status }), cid);
  const gate = rateLimit(`vote:${session.user.id}`, { limit: 30, windowMs: 60000 });
  if (!gate.ok) return withCorrelation(NextResponse.json({ error: 'Slow down a little.' }, { status: 429 }), cid);
  let body; try { body = await request.json(); } catch { body = {}; }
  const { promptId, choiceIndex, textBody, playbackPositionMs, viewerId } = body;
  if (!promptId) return withCorrelation(NextResponse.json({ error: 'promptId is required.' }, { status: 400 }), cid);
  const admin = getSupabaseAdmin();
  const { data: prompt } = await admin.from('show_prompts').select('id, show_id, room_name, kind, body, options, pushed_at, closed_at, grace_seconds').eq('id', promptId).maybeSingle();
  if (!prompt || !prompt.pushed_at) return withCorrelation(NextResponse.json({ error: 'That prompt is not open.' }, { status: 404 }), cid);
  const { data: show } = await admin.from('shows').select('id, actual_started_at').eq('id', prompt.show_id).maybeSingle();
  const pos = Number.isFinite(Number(playbackPositionMs)) ? Math.max(0, Math.trunc(Number(playbackPositionMs))) : null;
  const decision = voteDecision({ prompt, show, nowMs: Date.now(), playbackPositionMs: pos });
  if (!decision.accept) return withCorrelation(NextResponse.json({ error: 'Voting has closed.', reason: decision.reason }, { status: 410 }), cid);
  let choice = null, label = null, text = null;
  if (prompt.kind === 'choice') {
    const options = Array.isArray(prompt.options) ? prompt.options : [];
    const idx = Number(choiceIndex);
    if (!Number.isInteger(idx) || idx < 0 || idx >= options.length) return withCorrelation(NextResponse.json({ error: 'Pick one of the options.' }, { status: 400 }), cid);
    choice = idx; label = typeof options[idx] === 'string' ? options[idx] : options[idx]?.label || String(idx);
  } else {
    text = String(textBody || '').trim().slice(0, 1000);
    if (!text) return withCorrelation(NextResponse.json({ error: 'Write an answer.' }, { status: 400 }), cid);
  }
  const row = {
    prompt_id: prompt.id, show_id: prompt.show_id, room_name: prompt.room_name, prompt_body: prompt.body, user_id: session.user.id,
    viewer_id: typeof viewerId === 'string' && viewerId ? viewerId.slice(0, 200) : `user:${session.user.id}`,
    choice_index: choice, choice_label: label, text_body: text, playback_position_ms: pos,
    offset_ms: show?.actual_started_at ? Math.max(0, Date.now() - Date.parse(show.actual_started_at)) : null, env: rowEnv(), updated_at: new Date().toISOString(),
  };
  // Changeable until closed: update the account's existing vote, else insert.
  const { data: existing } = await admin.from('prompt_responses').select('id').eq('prompt_id', prompt.id).eq('user_id', session.user.id).maybeSingle();
  const res = existing
    ? await admin.from('prompt_responses').update(row).eq('id', existing.id).select('id').single()
    : await admin.from('prompt_responses').insert(row).select('id').single();
  if (res.error) return withCorrelation(NextResponse.json({ error: 'Could not record your vote. Try again.' }, { status: 500 }), cid);
  return withCorrelation(NextResponse.json({ ok: true, voteId: res.data.id, choiceIndex: choice, textBody: text, reason: decision.reason, changed: Boolean(existing) }), cid);
}
