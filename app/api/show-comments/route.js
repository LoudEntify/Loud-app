import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { rateLimit, clientKey } from '../../../lib/rateLimit';
import { rowEnv } from '../../../lib/rowEnv';

// ── ITEM 5: COMMENT PERSISTENCE ───────────────────────────────
//
// Batched writes from lib/comments.js land here. Same shape as
// app/api/reactions/route.js, which this is modelled on.
//
// ── AUTH MODEL: DELIBERATELY OPEN, RATE-LIMITED ───────────────
// Same posture as /api/reactions, /api/viewer-session and
// /api/health-events, and the same reasoning: the audience has no
// account. Requiring one would mean the stored chat log contains only
// signed-in users, which is both a worse record and a misleading one.
//
// There is NO GET. A caller can add their own comments and can never
// read anybody's. show_comments has RLS on with zero policies, so only
// the service role sees it and no product surface renders it — the live
// chat everyone reads comes over the LiveKit data channel and never
// through this table.
//
// The honest cost: a determined caller can write comments that nobody in
// the room saw. Rate-limited, capped per batch, and bounded in length,
// but not prevented. For a pilot of 30–50 people reading a chat that is
// delivered peer-to-peer, the stored log is a record of what was said,
// not evidence that only those things were said.
//
// ⚠️ RETENTION AND DELETION ARE NOT DECIDED.
// The entry form tells every viewer "Ask us any time and we'll delete
// them." pilot2_03 carries deleted_at / deleted_by so that is
// answerable, but nothing writes them — honouring a request today means
// running SQL by hand. Proportionate for this pilot, not for a launch,
// and recorded in both places rather than assumed.

const RATE_LIMIT = { limit: 120, windowMs: 60000 };
const MAX_BATCH = 100;
const MAX_BODY = 1000;

function bounded(value, max) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s ? s.slice(0, max) : null;
}

export async function POST(request) {
  try {
    const gate = rateLimit(clientKey(request, 'show-comments'), RATE_LIMIT);
    if (!gate.ok) {
      return NextResponse.json(
        { ok: false, error: 'Rate limited' },
        { status: 429, headers: { 'Retry-After': String(gate.retryAfterSec) } }
      );
    }

    const { comments } = await request.json();
    if (!Array.isArray(comments) || comments.length === 0) {
      return NextResponse.json({ ok: true, inserted: 0 });
    }

    const rows = comments
      .slice(0, MAX_BATCH)
      // A row with no show or no body is not a comment. Filtered rather
      // than rejected so one malformed entry cannot lose a whole batch of
      // otherwise-good messages.
      .filter((c) => c && c.show_id && String(c.body || '').trim())
      .map((c) => ({
        show_id: String(c.show_id),
        room_name: bounded(c.room_name, 200),
        body: String(c.body).trim().slice(0, MAX_BODY),
        author_name: bounded(c.author_name, 120),
        viewer_id: bounded(c.viewer_id, 200),
        livekit_identity: bounded(c.livekit_identity, 200),
        offset_ms: Number.isFinite(Number(c.offset_ms)) ? Math.max(0, Math.round(Number(c.offset_ms))) : null,
        client_ts: c.client_ts ? new Date(c.client_ts).toISOString() : new Date().toISOString(),
        env: rowEnv(),
      }));

    if (rows.length === 0) return NextResponse.json({ ok: true, inserted: 0 });

    const admin = getSupabaseAdmin();
    const { error } = await admin.from('show_comments').insert(rows);
    if (error) {
      // Warn, not error: an unmigrated database means chat still works
      // perfectly — it simply is not being recorded — and this route's
      // caller ignores the response either way. Same decision as
      // /api/reactions, which is also why that route's silence went
      // unnoticed for weeks and why verify-write-paths exists.
      console.warn('[show-comments] insert failed:', error.message);
      return NextResponse.json({ ok: false, error: 'Insert failed' }, { status: 500 });
    }

    return NextResponse.json({ ok: true, inserted: rows.length });
  } catch (err) {
    console.warn('[show-comments] request failed:', err);
    return NextResponse.json({ ok: false, error: String(err?.message || err) }, { status: 500 });
  }
}
