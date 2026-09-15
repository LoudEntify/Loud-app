// lib/showPrompts.js
// ─────────────────────────────────────────────────────────────
// The four questions the pilot asks its audience.
//
// PRD: Live Show / Audience, Versus · S&I: Database, Real-time media
//
// ── SCOPE, AND WHAT WAS CUT ───────────────────────────────────
// Item 6 was cut on 14 Sept to these four prepared prompts. Free-form
// compose (typing a question live) and pin persistence are deferred to
// 22–26 Sept. Nothing about the schema changes: pilot2_06 already
// records `source` as 'saved' | 'composed', so a composed prompt added
// later sits in the same table and is read by the same queries. What is
// cut is a UI, not a data model.
//
// ── ⚠️ TWO OF THESE ARE VERBATIM FROM THE JULY SURVEY ─────────
// Q2 and Q3 below, question text AND answer labels, are copied exactly
// from the July survey. Their entire value is that the answers can be
// compared against it: the same question, asked of people who have now
// actually watched a show, is the one piece of evidence in this pilot
// that measures a CHANGE of mind rather than an opinion.
//
// EDITING A CHARACTER OF EITHER — including punctuation, capitalisation
// or the order of the options — INVALIDATES THAT COMPARISON, and does so
// silently: the rows still write, the chart still renders, and the
// number simply stops meaning what it says. If a question needs
// rewording, add a FIFTH prompt and leave these two alone.
//
// ── WHY THESE ARE NOT SEEDED AS ROWS ──────────────────────────
// A row in `show_prompts` means a question that was actually PUSHED into
// a specific show. Seeding four unpushed rows per show would stop
// `count(*)` meaning "what the audience was asked", which is the first
// thing anyone will count on the 21st.
//
// ── ORDER IS LOAD-BEARING ─────────────────────────────────────
// The comparison question needs them to have watched enough to judge.
// The two survey questions need to be late enough that the answers
// reflect the experience rather than the idea of it. `suggestedAtMs` is
// a prompt to the operator, not a schedule — nothing fires these
// automatically, because a question landing during a quiet moment is an
// editorial decision.

const MIN = 60 * 1000;

export const SHOW_PROMPTS = [
  {
    key: 'compare',
    kind: 'choice',
    suggestedAtMs: 10 * MIN,
    body: 'How does this compare to a normal phone live stream?',
    options: ['Better', 'About the same', 'Worse'],
    note: 'New for pilot 2.',
  },
  {
    // ⚠️ VERBATIM — July survey. Do not edit. See the header.
    key: 'would_buy_tokens',
    kind: 'choice',
    suggestedAtMs: 25 * MIN,
    body: 'Watching would be free. Would you ever buy tokens to power-vote or tip an artist you loved?',
    options: ['Definitely', 'Only for an artist I really love', 'No, never'],
    note: 'VERBATIM from the July survey — editing invalidates the comparison.',
    verbatim: true,
  },
  {
    // ⚠️ VERBATIM — July survey. Do not edit. See the header.
    key: 'first_purchase',
    kind: 'choice',
    suggestedAtMs: 40 * MIN,
    body: 'Which would you most likely try first?',
    options: ['Free votes only', '£10 token pack', '£20 token pack'],
    note: 'VERBATIM from the July survey — editing invalidates the comparison.',
    verbatim: true,
  },
  {
    key: 'come_back',
    kind: 'text',
    // No fixed time: this one goes out at the end, and the end is when
    // the artist decides it is, not when a clock says so.
    suggestedAtMs: null,
    body: 'What would make you come back for another show?',
    options: [],
    note: 'New for pilot 2. Open text, and only at the end.',
  },
];

/**
 * The same validation the database enforces (show_prompts_options_check),
 * applied before anything is sent.
 *
 * Deliberately duplicated rather than trusted to the CHECK constraint:
 * the constraint is the backstop that makes a broken question impossible
 * to store, but a 400 arriving mid-show tells the operator nothing they
 * can act on. This says which prompt is wrong, before it is pushed.
 */
export function validatePrompt(prompt) {
  if (!prompt) return 'No prompt.';
  const body = String(prompt.body || '').trim();
  if (body.length < 1 || body.length > 280) return 'A question must be 1–280 characters.';
  if (prompt.kind === 'text') {
    return (prompt.options?.length ?? 0) === 0 ? null : 'A text prompt cannot have options.';
  }
  if (prompt.kind !== 'choice') return `Unknown prompt kind: ${prompt.kind}`;
  const n = prompt.options?.length ?? 0;
  if (n < 2 || n > 4) return 'A choice prompt needs 2 to 4 options.';
  if (prompt.options.some((o) => !String(o || '').trim())) return 'An option cannot be blank.';
  return null;
}

/** Look one up by the key the operator's panel fires. */
export function promptByKey(key) {
  return SHOW_PROMPTS.find((p) => p.key === key) || null;
}
