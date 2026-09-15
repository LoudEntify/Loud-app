import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin';
import { rateLimit, clientKey } from '../../../../lib/rateLimit';
import { rowEnv } from '../../../../lib/rowEnv';

// ── ITEM 6: WHAT HAS THIS SHOW ASKED? ─────────────────────────
//
// A late joiner was not in the room when the prompt was broadcast, so
// the data channel can never reach them with it. This is the only way
// they can find out what they missed.
//
// ── AUTH MODEL: DELIBERATELY OPEN, RATE-LIMITED ───────────────
// Same posture as /api/prompt-responses, which this pairs with: the
// audience has no account, and a late joiner who had to sign in to see
// the questions would simply not answer them.
//
// ⚠️ THE SPLIT FROM ../route.js IS THE WHOLE POINT OF THIS FILE
// EXISTING AS A SEPARATE ROUTE. The sibling GET returns RESULTS and is
// artist-only; a viewer must never see the running tally, because a
// visible tally changes the answers, and must never see who answered
// what, because prompt_responses is per-person opinion attached to a
// per-person identifier.
//
// So this returns the QUESTION ONLY — id, kind, body, options,
// pushed_at — and touches prompt_responses not at all. Widening the
// artist route with a "viewer mode" flag would have put those two
// behaviours one boolean apart in one function, which is exactly how a
// results leak gets written by someone who did not read the whole file.
//
// Scoped to pushed prompts in the current environment: an unpushed
// draft has not been asked, and a preview row must not appear in a
// production show (or the reverse) now that production and preview share
// one database.

const RATE_LIMIT = { limit: 120, windowMs: 60000 };

// The cap exists so this cannot become a bulk export of every question
// ever asked. A show asks eight; anything near this is not a show.
const MAX_PROMPTS = 50;

export async function GET(request) {
  try {
    const gate = rateLimit(clientKey(request, 'prompt-list'), RATE_LIMIT);
    if (!gate.ok) {
      return NextResponse.json({ error: 'Rate limited' }, { status: 429, headers: { 'Retry-After': String(gate.retryAfterSec) } });
    }

    const { searchParams } = new URL(request.url);
    const room = searchParams.get('room');
    if (!room) return NextResponse.json({ error: 'room is required' }, { status: 400 });

    const admin = getSupabaseAdmin();

    // Resolved from the room name rather than taking a show id from the
    // caller. A caller who could name any show id could read the
    // questions of a show they are not in; a room name is what they
    // already have by being on the page.
    const { data: show } = await admin
      .from('shows')
      .select('id')
      .eq('room_name', room)
      .maybeSingle();
    if (!show) return NextResponse.json({ ok: true, prompts: [] });

    const { data, error } = await admin
      .from('show_prompts')
      .select('id, kind, body, options, pushed_at')
      .eq('show_id', show.id)
      .eq('env', rowEnv())
      .not('pushed_at', 'is', null)
      .is('closed_at', null)
      .order('pushed_at', { ascending: true })
      .limit(MAX_PROMPTS);

    if (error) {
      console.warn('[show-prompts/list] read failed:', error);
      return NextResponse.json({ error: 'Could not read questions.' }, { status: 500 });
    }

    return NextResponse.json({ ok: true, prompts: data || [] });
  } catch (err) {
    console.warn('[show-prompts/list] request failed:', err);
    return NextResponse.json({ error: String(err?.message || err) }, { status: 500 });
  }
}
