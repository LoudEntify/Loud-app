import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { rateLimit, clientKey } from '../../../lib/rateLimit';
import { rowEnv } from '../../../lib/rowEnv';
import { verifySession } from '../../../lib/verifyArtistAuth';
import { boundedLatency, hashInteractionToken, voterKey, votingWindow } from '../../../lib/interactions.mjs';

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
      .select('id, show_id, room_name, kind, body, options, pushed_at, opens_at, closes_at, closed_at, latency_allowance_ms')
      .eq('id', promptId)
      .maybeSingle();
    if (!prompt) return NextResponse.json({ error: 'That question is not available.' }, { status: 404 });
    let interactionSession = null;
    let authoritativeVoterKey = null;
    if (prompt.kind === 'choice') {
      const token = request.headers.get('x-interaction-token');
      if (!token) return NextResponse.json({ error: 'Start an interaction session before voting.' }, { status: 401 });
      const { data: interaction } = await admin.from('interaction_sessions')
        .select('id,show_id,user_id,expires_at,revoked_at')
        .eq('token_hash', hashInteractionToken(token))
        .maybeSingle();
      if (!interaction || interaction.show_id !== prompt.show_id || interaction.revoked_at || new Date(interaction.expires_at).getTime() <= Date.now()) {
        return NextResponse.json({ error: 'Your interaction session expired. Reconnect and try again.' }, { status: 401 });
      }
      let authenticatedUserId = interaction.user_id;
      if ((request.headers.get('authorization') || '').startsWith('Bearer ')) {
        const auth = await verifySession(request);
        if (!auth.error) authenticatedUserId = auth.user.id;
      }
      interactionSession = interaction;
      authoritativeVoterKey = voterKey({ userId: authenticatedUserId, sessionId: interaction.id });
      const window = votingWindow(prompt);
      if (!window.open) {
        await admin.from('interaction_audit_events').insert({ show_id: prompt.show_id, prompt_id: prompt.id, interaction_session_id: interaction.id, event_type: 'VOTE_REJECTED', detail: { reason: window.reason } });
        return NextResponse.json({ error: 'That vote has closed.', reason: window.reason }, { status: 410 });
      }
    } else if (prompt.closed_at) return NextResponse.json({ error: 'That question has closed.' }, { status: 410 });

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
      received_at: new Date().toISOString(),
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
      // Choice identity is server-authoritative. Leaving the legacy,
      // client-controlled viewer_id on this row would let its older
      // unique index conflict with a legitimate reconnected session.
      row.viewer_id = null;
      row.interaction_session_id = interactionSession.id;
      row.voter_key = authoritativeVoterKey;
      row.estimated_latency_ms = boundedLatency(body.estimatedLatencyMs);
      row.playback_position_ms = Number.isFinite(Number(body.playbackPositionMs)) ? Math.max(0, Math.round(Number(body.playbackPositionMs))) : null;
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
      .upsert(row, { onConflict: prompt.kind === 'choice' ? 'prompt_id,voter_key' : 'prompt_id,viewer_id' });

    if (error) {
      console.warn('[prompt-responses] upsert failed:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (prompt.kind === 'choice') {
      await admin.from('interaction_sessions').update({ last_seen_at: new Date().toISOString() }).eq('id', interactionSession.id);
      await admin.from('interaction_audit_events').insert({ show_id: prompt.show_id, prompt_id: prompt.id, interaction_session_id: interactionSession.id, event_type: 'VOTE_ACCEPTED', detail: { last_write_wins: true, estimated_latency_ms: row.estimated_latency_ms } });
    }
    return NextResponse.json({ ok: true, acceptedAt: row.received_at });
  } catch (err) {
    console.warn('[prompt-responses] request failed:', err);
    return NextResponse.json({ error: String(err?.message || err) }, { status: 500 });
  }
}
