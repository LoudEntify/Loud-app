// lib/showPrompts.js
// ─────────────────────────────────────────────────────────────
// The questions the pilot asks its audience.
//
// PRD: Live Show / Audience, Versus · S&I: Database, Real-time media
//
// ── ⚠️ FOUR OF THESE ARE VERBATIM FROM THE JULY SURVEY ────────
// Q3, Q4, Q5 and Q6 below — question text AND every option label — are
// copied from the survey response export
// (`Potential viewers survey.csv`, 158 responses), columns 6, 4, 7 and 8
// respectively. They are NOT paraphrases and must never be retyped from
// memory.
//
// Their entire value is that the answers can be compared against July:
// the same question, asked of people who have now actually watched a
// show, is the only evidence in this pilot that measures a CHANGE of
// mind rather than an opinion.
//
// EDITING A CHARACTER OF ANY OF THEM INVALIDATES THAT COMPARISON, and
// does so SILENTLY: the rows still write, the tally still renders, and
// the number simply stops meaning what it says.
//
// This is not hypothetical. The first version of this file shipped two
// of these labels wrong — `No, never` where the survey says `Never`, and
// `Free votes only` where it says `I’d only ever use free votes` — and
// the test suite asserted those wrong strings byte-exact, which made the
// error look verified. Every verbatim string below was re-derived from
// the CSV on 15 Sept and is asserted in scripts/window-tests.mjs against
// the values actually present in the export.
//
// ⚠️ TWO DIFFERENT APOSTROPHES, AND BOTH ARE CORRECT AS WRITTEN:
//   Q4 `I don't mind either way`         STRAIGHT quote, U+0027
//   Q6 `I’d only ever use free votes`    CURLY quote,    U+2019
// They are inconsistent because the survey was inconsistent. Normalising
// either one is the same silent invalidation as any other edit.
//
// If a question needs rewording, ADD A NEW PROMPT and leave these four
// alone.
//
// ── DISPLAY ORDER IS A RECONSTRUCTION, NOT FROM THE CSV ───────
// The export records RESPONSES, so it gives the exact labels but not the
// order they were shown in. Option order affects answers, so the orders
// below are a reasoned reconstruction (positive → negative; ascending
// commitment) and are the one part of these four prompts the CSV cannot
// confirm. The original Google Form is being checked; if it still exists
// its order replaces these and the labels stay exactly as they are.
//
// ── WHY THESE ARE NOT SEEDED AS ROWS ──────────────────────────
// A row in `show_prompts` means a question actually PUSHED into a
// specific show. Seeding unpushed rows would stop `count(*)` meaning
// "what the audience was asked", which is the first thing anyone counts
// on the 21st. It is also what makes the catch-up in
// lib/promptCatchup.js correct: it offers late joiners only what was
// really asked.
//
// ── ORDER AND TIMING ──────────────────────────────────────────
// `suggestedAtMs` is GUIDANCE FOR THE OPERATOR. Nothing here fires
// automatically: a question landing in the middle of a song is an
// editorial mistake no timer can avoid. The only automatic timing in
// item 6 is the catch-up spacing for late joiners.

const MIN = 60 * 1000;

export const SHOW_PROMPTS = [
  {
    key: 'camera_movement',
    kind: 'choice',
    suggestedAtMs: 8 * MIN,
    body: 'The picture changed between cameras during the show. How did that feel?',
    options: [
      'Made it better to watch',
      "Didn't really notice it",
      'A bit distracting',
      "There wasn't enough camera movement",
    ],
    note: 'New for pilot 2. The multi-camera direction is the product; this asks whether it landed.',
  },
  {
    key: 'compare',
    kind: 'choice',
    suggestedAtMs: 15 * MIN,
    body: 'How does this compare to a normal phone live stream?',
    options: ['Better', 'About the same', 'Worse'],
    note: 'New for pilot 2.',
  },
  {
    // ⚠️ VERBATIM — July survey, CSV column 6. Do not edit.
    key: 'versus_interest',
    kind: 'choice',
    suggestedAtMs: 20 * MIN,
    body: 'Imagine two unsigned artists going head-to-head in a live show, where your votes help decide the winner. How interesting does that sound?',
    options: ['Very interesting', 'Somewhat interesting', 'Not really'],
    note: 'VERBATIM (CSV col 6). Only meaningful on a Versus show — on a solo show the audience is answering about something they have not seen, so do not push it.',
    verbatim: true,
    versusOnly: true,
  },
  {
    // ⚠️ VERBATIM — July survey, CSV column 4. Do not edit.
    // Note the STRAIGHT apostrophe in "don't" — the survey used one here
    // and a curly one in `first_purchase` below. Both are correct.
    key: 'originals_or_covers',
    kind: 'choice',
    suggestedAtMs: 22 * MIN,
    body: 'Would you rather watch a new artist perform their own songs, or covers of songs you know?',
    options: [
      'Their own original songs',
      'Covers of songs I already know',
      'A mix of both',
      "I don't mind either way",
    ],
    note: 'VERBATIM (CSV col 4) — editing invalidates the comparison with July.',
    verbatim: true,
  },
  {
    // ⚠️ VERBATIM — July survey, CSV column 7. Do not edit.
    // `Never`, NOT `No, never`. This was shipped wrong once.
    key: 'would_buy_tokens',
    kind: 'choice',
    suggestedAtMs: 30 * MIN,
    body: 'Watching would be free. Would you ever buy tokens to power-vote or tip an artist you loved?',
    options: ['Definitely', 'Only for an artist I really love', 'Never'],
    note: 'VERBATIM (CSV col 7) — editing invalidates the comparison with July.',
    verbatim: true,
  },
  {
    // ⚠️ VERBATIM — July survey, CSV column 8. Do not edit.
    // `I’d only ever use free votes` with a CURLY apostrophe (U+2019),
    // NOT `Free votes only`. This was shipped wrong once.
    key: 'first_purchase',
    kind: 'choice',
    suggestedAtMs: 38 * MIN,
    body: 'Which would you most likely try first?',
    options: ['I’d only ever use free votes', '£10 token pack', '£20 token pack'],
    note: 'VERBATIM (CSV col 8) — editing invalidates the comparison with July.',
    verbatim: true,
  },
  {
    key: 'watch_again',
    kind: 'choice',
    suggestedAtMs: 45 * MIN,
    body: 'Would you watch another show like this?',
    options: [
      "Yes, and I'd tell someone about it",
      'Yes, just me',
      'Maybe',
      'Probably not',
    ],
    note: 'New for pilot 2.',
  },
  {
    key: 'come_back',
    kind: 'text',
    // No fixed time: this goes out at the end, and the end is when the
    // artist decides it is, not when a clock says so.
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
 * to STORE, but a 400 arriving mid-show tells the operator nothing they
 * can act on. This names what is wrong, before it is pushed.
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
