import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { rateLimit, clientKey } from '../../../lib/rateLimit';
import { rowEnv } from '../../../lib/rowEnv';

// ── ITEM 6: WHAT THE AUDIENCE ANSWERED ────────────────────────
//
// ── AUTH MODEL: DELIBERATELY OPEN, RATE-LIMITED ───────────────
// Same posture as /api/viewer-session and /api/health-events, and for
// the same reason: the audience has no account, and requiring one would
// mean the questionnaire measures signed-in users rather than the room.
//
// The asymmetry with /api/show-prompts next door is the design. ASKING a
// question puts text on every screen in a live broadcast and READING the
// results exposes what people said — both artist-only. ANSWERING is
// anonymous and open. There is no GET here at all: a caller can add
// their own answer and can never read anyone's.
//
// THE HONEST COST: a determined caller can stuff a vote. Mitigated, not
// solved, by the unique index below — one answer per viewer_id per
// prompt — which stops the ordinary version of this (one person tapping
// four times) without pretending to stop a scripted one. For a pilot
// measuring how a room of thirty to fifty people react, that is the
// right trade; the number should not be quoted as adversarial.
//
// ── THE QUESTION IS STORED ON THE ANSWER ──────────────────────
// prompt_body and choice_label are written here, frozen at the moment of
// answering, duplicating what show_prompts already holds. That
// duplication is the feature: a response reachable only through a join
// is one edit away from meaning something else, and a spontaneous
// question is useless later if the answer cannot recall what was asked.
// They are taken from the STORED PROMPT, never from the client — a
// client that sent its own label could rewrite history for its own row.

const RATE_LIMIT = { limit: 60, windowMs: 60000 };

export async function POST(request) {
  try {
    const gate = rateLimit(clientKey(request, 'prompt-responses'), RATE_LIMIT);
    if (!gate.ok) {
      return NextResponse.json({ error: 'Rate limited' }, { status: 429, headers: { 'Retry-After': String(gate.retryAfterSec) } });
    }

    const body = await request.json().catch(() => ({}));
    const promptId = body.promptId ? String(body.promptId) : null;
    const viewerId = body.viewerId ? String(body.viewerId).slice(0, 200) : null;
    if (!promptId) return NextResponse.json({ error: 'promptId is required' }, { status: 400 });

    const admin = getSupabaseAdmin();

    // Read the prompt FIRST. Everything descriptive on the response row
    // comes from here rather than from the request, so a client cannot
    // choose what question it is answering or what its answer was called.
    const { data: prompt } = await admin
      .from('show_prompts')
      .select('id, show_id, room_name, kind, body, options, closed_at')
      .eq('id', promptId)
      .maybeSingle();
    if (!prompt) return NextResponse.json({ error: 'That question is not available.' }, { status: 404 });
    if (prompt.closed_at) return NextResponse.json({ error: 'That question has closed.' }, { status: 410 });

    const row = {
      prompt_id: prompt.id,
      show_id: prompt.show_id,
      room_name: prompt.room_name,
      prompt_body: prompt.body,
      viewer_id: viewerId,
      livekit_identity: body.livekitIdentity ? String(body.livekitIdentity).slice(0, 200) : null,
      offset_ms: Number.isFinite(Number(body.offsetMs)) ? Math.max(0, Math.round(Number(body.offsetMs))) : null,
      env: rowEnv(),
      updated_at: new Date().toISOString(),
    };

    if (prompt.kind === 'choice') {
      const idx = Number(body.choiceIndex);
      const options = prompt.options || [];
      if (!Number.isInteger(idx) || idx < 0 || idx >= options.length) {
        return NextResponse.json({ error: 'That is not one of the answers.' }, { status: 400 });
      }
      row.choice_index = idx;
      // The label as it was shown, from the stored options. The index
      // alone is meaningless if the options are ever reordered.
      row.choice_label = String(options[idx]);
      row.text_body = null;
    } else {
      const text = String(body.textBody || '').trim();
      if (text.length < 1 || text.length > 1000) {
        return NextResponse.json({ error: 'An answer must be 1–1000 characters.' }, { status: 400 });
      }
      row.text_body = text;
      row.choice_index = null;
      row.choice_label = null;
    }

    // ── ONE ANSWER PER VIEWER, LAST ONE WINS ──────────────────
    // onConflict names the PLAIN unique index from pilot2_07. It must
    // stay exactly 'prompt_id,viewer_id' — the partial version of that
    // index could not be inferred as an ON CONFLICT target and failed
    // every write with 42P10, which is the bug fixed on 12 Sept.
    //
    // A viewer who taps 'Better' and changes their mind to 'Worse' has
    // one opinion, not two. Without this, one enthusiastic tapper
    // outvotes three people who tapped once — which is exactly what
    // would make this unusable as Versus voting.
    //
    // A response with NO viewer_id (storage unavailable on that device)
    // is still worth keeping and does not collide, because NULLs are
    // distinct in a unique index. It also cannot be de-duplicated, so
    // those rows are the honest limit of this mechanism.
    const { error } = await admin
      .from('prompt_responses')
      .upsert(row, { onConflict: 'prompt_id,viewer_id' });

    if (error) {
      console.warn('[prompt-responses] upsert failed:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.warn('[prompt-responses] request failed:', err);
    return NextResponse.json({ error: String(err?.message || err) }, { status: 500 });
  }
}
