import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { verifyArtistAuth } from '../../../lib/verifyArtistAuth';
import { verifyShowOwner } from '../../../lib/verifyShowOwner';
import { rateLimit, clientKey } from '../../../lib/rateLimit';
import { rowEnv } from '../../../lib/rowEnv';
import { validatePrompt } from '../../../lib/showPrompts';

// ── ITEM 6: PUSH A QUESTION, READ THE ANSWERS ─────────────────
//
// POST  push a prompt into a show. ARTIST ONLY.
// GET   read the results of one prompt. ARTIST ONLY.
//
// ── AUTH MODEL: artist bearer + ownership of this room ────────
// Both, not either, and this is the opposite posture to
// /api/viewer-session next door — deliberately. Pushing a question puts
// text on every screen in a live broadcast, and reading the results
// exposes what the audience answered. Neither is something an
// unauthenticated caller may do, and the asymmetry with the response
// route below is the whole point: answering is anonymous and open,
// asking and reading are not.
//
// ── WHY RESULTS ARE READ THROUGH A ROUTE, NOT RLS ─────────────
// prompt_responses has RLS on with ZERO policies (pilot2_07) because it
// is per-person opinion attached to a per-person identifier — the most
// sensitive table in this set. The operator sees AGGREGATES through this
// service-role route and never a direct read, so "show me the results"
// can never become "show me who said what" by widening a policy.

const RATE_LIMIT = { limit: 60, windowMs: 60000 };

export async function POST(request) {
  try {
    const gate = rateLimit(clientKey(request, 'show-prompts'), RATE_LIMIT);
    if (!gate.ok) {
      return NextResponse.json({ error: 'Rate limited' }, { status: 429, headers: { 'Retry-After': String(gate.retryAfterSec) } });
    }

    const body = await request.json().catch(() => ({}));
    const room = body.room;
    if (!room) return NextResponse.json({ error: 'room is required' }, { status: 400 });

    const auth = await verifyArtistAuth(request);
    if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const admin = getSupabaseAdmin();
    const owner = await verifyShowOwner(admin, room, auth.user);
    if (owner.error) return NextResponse.json({ error: owner.error }, { status: owner.status });

    const prompt = {
      kind: body.kind,
      body: String(body.body || '').trim(),
      options: Array.isArray(body.options) ? body.options.map((o) => String(o)) : [],
    };
    // Checked here as well as by the CHECK constraint. The constraint is
    // what makes a broken question impossible to STORE; this is what
    // makes the failure legible to an operator mid-show instead of a
    // 400 they cannot act on.
    const invalid = validatePrompt(prompt);
    if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });

    const { data, error } = await admin
      .from('show_prompts')
      .insert({
        show_id: owner.show.id,
        room_name: room,
        kind: prompt.kind,
        body: prompt.body,
        options: prompt.options,
        // 'saved' is truthful for all four prepared prompts. Compose is
        // cut this week; when it lands it writes 'composed' into this
        // same column and "did spontaneous questions get better answers"
        // becomes answerable without a migration.
        source: body.source === 'composed' ? 'composed' : 'saved',
        // Pushed at the moment of insert: this route only ever exists to
        // ask, so there is no state in which a row here has not been
        // asked. (A composed-but-unpushed draft would set this null.)
        pushed_at: new Date().toISOString(),
        // Milliseconds from showOriginMs, computed CLIENT-side because
        // that is where the show row with actual_started_at lives. Item
        // 3 is what makes this measured from the real start rather than
        // the slated one.
        offset_ms: Number.isFinite(Number(body.offsetMs)) ? Math.max(0, Math.round(Number(body.offsetMs))) : null,
        created_by: auth.user.id,
        env: rowEnv(),
      })
      .select('id, kind, body, options, pushed_at')
      .single();

    if (error) {
      console.warn('[show-prompts] insert failed:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, prompt: data });
  } catch (err) {
    console.warn('[show-prompts] request failed:', err);
    return NextResponse.json({ error: String(err?.message || err) }, { status: 500 });
  }
}

// Results for one prompt, AGGREGATED. Never the individual rows.
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const promptId = searchParams.get('promptId');
    const room = searchParams.get('room');
    if (!promptId || !room) {
      return NextResponse.json({ error: 'promptId and room are required' }, { status: 400 });
    }

    const auth = await verifyArtistAuth(request);
    if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const admin = getSupabaseAdmin();
    const owner = await verifyShowOwner(admin, room, auth.user);
    if (owner.error) return NextResponse.json({ error: owner.error }, { status: owner.status });

    const { data: prompt } = await admin
      .from('show_prompts')
      .select('id, show_id, kind, body, options')
      .eq('id', promptId)
      .maybeSingle();
    // Scoped to THIS show as well as this id. Without it, an artist could
    // read the results of another artist's prompt by guessing an id --
    // which is exactly the shape of the cue-sheets IDOR found in the
    // 2026-08-28 round, where the route did authenticate and then trusted
    // an identifier from the caller.
    if (!prompt || prompt.show_id !== owner.show.id) {
      return NextResponse.json({ error: 'No such prompt in this show.' }, { status: 404 });
    }

    const { data: rows, error } = await admin
      .from('prompt_responses')
      .select('choice_index, choice_label, text_body')
      .eq('prompt_id', promptId)
      .eq('env', rowEnv());
    if (error) {
      console.warn('[show-prompts] results read failed:', error);
      return NextResponse.json({ error: 'Could not read results.' }, { status: 500 });
    }

    if (prompt.kind === 'text') {
      // Text answers are returned as text -- there is nothing to
      // aggregate -- but they are still only reachable by the artist
      // whose show it is, and they carry no viewer_id.
      return NextResponse.json({
        ok: true, kind: 'text', total: rows.length,
        answers: rows.map((r) => r.text_body).filter(Boolean),
      });
    }

    const counts = (prompt.options || []).map((label, i) => ({
      index: i,
      label,
      count: rows.filter((r) => r.choice_index === i).length,
    }));
    return NextResponse.json({ ok: true, kind: 'choice', total: rows.length, counts });
  } catch (err) {
    console.warn('[show-prompts] results request failed:', err);
    return NextResponse.json({ error: String(err?.message || err) }, { status: 500 });
  }
}
