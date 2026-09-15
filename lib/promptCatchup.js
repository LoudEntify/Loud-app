// lib/promptCatchup.js
// ─────────────────────────────────────────────────────────────
// What a late joiner should be shown, and when.
//
// PRD: Live Show / Audience · S&I: Real-time media, Database
//
// ── THE PROBLEM ───────────────────────────────────────────────
// A prompt reaches the room over the data channel, which only reaches
// people who are IN the room at that moment. On the night the audience
// arrives throughout, so someone who joins at minute 30 has permanently
// missed everything asked before then — and on a show where most people
// arrive late, most of the audience answers nothing. The questions are
// the pilot's evidence base, so that is not a cosmetic gap.
//
// ── THE FOUR RULES, AND WHY EACH ONE EXISTS ───────────────────
//
//   WAIT 5 MINUTES FIRST. A question asked of someone who has watched
//   for ten seconds is not measuring the show, it is measuring their
//   first impression of a loading screen. It also keeps the first thing
//   a new arrival sees from being a form.
//
//   ONE AT A TIME, 2 MINUTES APART. Anything faster reads as a
//   questionnaire rather than a live show, and a stack of cards over a
//   performance is the fastest way to make someone close the tab.
//   Narrowed from 3 minutes on 15 Sept after the device test: at 3, a
//   late joiner's three catch-ups spanned 11 minutes of a ~50 minute
//   show, which is a long time to still be answering questions about
//   the part they missed. At 2 it is 9.
//
//   AT MOST THE 3 MOST RECENT. A viewer joining at minute 45 of a show
//   with eight prompts behind them would otherwise face a queue longer
//   than the rest of the show. The three most recent are also the most answerable: they
//   are about the part of the show this person actually saw.
//
//   NEVER RE-SHOW AN ANSWERED PROMPT. Both because it is irritating and
//   because prompt_responses is last-one-wins — re-showing invites a
//   viewer to overwrite a considered answer with a distracted one.
//
//   ANSWERED, AND ONLY ANSWERED. Seeing a card go past is not answering
//   it. Excluding live-seen prompts emptied the queue for anyone who was
//   in the room when they were pushed, which is most of the audience.
//
// ── LIVE PROMPTS ALWAYS WIN ───────────────────────────────────
// If the operator pushes something now, that is what is on screen. A
// catch-up card must never sit in front of the question the artist is
// talking about. The caller enforces this by simply not asking for a
// catch-up while a live prompt is open; `nextCatchupPrompt` returns what
// SHOULD be shown next and makes no decision about what already is.
//
// ── PURE, BECAUSE THIS IS TIMING LOGIC ────────────────────────
// Item 1 cost two days in timing logic nobody could run in isolation.
// This is a function of (pushed, answered, joinedAt, lastShownAt, now)
// with no clock of its own and no React in it, so the whole schedule is
// exercisable in a millisecond.
// ─────────────────────────────────────────────────────────────

/** How long a viewer must have been watching before catch-up begins. */
export const CATCHUP_AFTER_JOIN_MS = 5 * 60 * 1000;

/** Minimum gap between two catch-up cards. */
export const CATCHUP_SPACING_MS = 2 * 60 * 1000;

/** Never offer more than this many missed prompts, most recent first. */
export const CATCHUP_MAX_OUTSTANDING = 3;

/**
 * The prompts this viewer missed and could still answer, most recent
 * first, capped.
 *
 * `pushed` is every prompt the show has asked (from the list endpoint —
 * each needs `id` and `pushed_at`). `answeredIds` is what this device
 * has already answered. `seenIds` is what the CATCH-UP has already
 * offered, so the queue advances instead of re-offering the same card
 * every tick.
 *
 * ⚠️ `seenIds` MUST NOT include prompts that merely appeared live. That
 * is what a device test on 911da9e found: a viewer present for four
 * pushes had all four excluded, reported `outstanding 0` after answering
 * one, and was never offered the other three. A card going past is not
 * an answer, and an unanswered question is precisely what this exists to
 * recover.
 */
export function outstandingPrompts({ pushed, answeredIds, seenIds }) {
  const answered = answeredIds instanceof Set ? answeredIds : new Set(answeredIds || []);
  const seen = seenIds instanceof Set ? seenIds : new Set(seenIds || []);
  return (pushed || [])
    .filter((p) => p?.id && !answered.has(p.id) && !seen.has(p.id))
    // Most recent first. `pushed_at` rather than array order: the list
    // endpoint's ordering is not something this should depend on.
    .slice()
    .sort((a, b) => new Date(b.pushed_at || 0) - new Date(a.pushed_at || 0))
    .slice(0, CATCHUP_MAX_OUTSTANDING);
}

/**
 * The next catch-up prompt to show, or null.
 *
 * Returns null — meaning "not yet", not "never" — when the viewer has
 * not watched long enough, when the spacing has not elapsed, or when
 * there is nothing outstanding.
 *
 * `lastShownAt` is when the previous catch-up card was put up (null if
 * none yet this session). It is deliberately NOT "when they answered
 * it": someone who ignores a card should still get the next one on the
 * same rhythm, otherwise ignoring one catch-up silently ends catch-up.
 */
export function nextCatchupPrompt({
  pushed,
  answeredIds,
  seenIds,
  joinedAt,
  lastShownAt,
  now,
  shownCount = 0,
  showEnded = false,
  afterJoinMs = CATCHUP_AFTER_JOIN_MS,
  spacingMs = CATCHUP_SPACING_MS,
  maxShown = CATCHUP_MAX_OUTSTANDING,
}) {
  if (!Number.isFinite(joinedAt) || !Number.isFinite(now)) return null;
  // ── THE SHOW IS OVER ──────────────────────────────────────
  // Nothing is asked after the end. A question appearing over the ended
  // card is worse than a question nobody answered: the audience has
  // stopped watching a performance and started reading an interface, and
  // a prompt arriving then is the single most visible way to look
  // broken in front of fifty people. The outstanding queue is DROPPED,
  // not deferred -- there is no later.
  if (showEnded) return null;
  // ── THE CAP IS PER SESSION, NOT PER MOMENT ────────────────
  // Found by test: capping only the OUTSTANDING list meant a viewer with
  // five missed prompts was shown three, and then -- because those three
  // were now 'seen' and dropped out of the list -- the remaining two
  // became outstanding and were shown as well. They got all five, just
  // more slowly, which is precisely the burying this cap exists to
  // prevent.
  //
  // THE CONSEQUENCE, stated rather than hidden: after three catch-ups
  // this viewer receives only LIVE prompts. If they then miss one
  // through a brief disconnect, it is not offered. That is the right
  // trade -- a late joiner answering the three most recent questions is
  // the goal, and someone who has already been handed three cards has
  // been asked enough.
  if (shownCount >= maxShown) return null;
  if (now - joinedAt < afterJoinMs) return null;
  if (Number.isFinite(lastShownAt) && now - lastShownAt < spacingMs) return null;
  const out = outstandingPrompts({ pushed, answeredIds, seenIds });
  return out[0] || null;
}

/**
 * Seconds until the next catch-up becomes due, for the debug overlay.
 *
 * Exists because the alternative way to check this logic on a device is
 * to wait five minutes and then three more, which is how item 1 turned
 * eleven tests into two days. Returns null when nothing is outstanding.
 */
export function msUntilNextCatchup({
  pushed, answeredIds, seenIds, joinedAt, lastShownAt, now, shownCount = 0,
  showEnded = false,
  afterJoinMs = CATCHUP_AFTER_JOIN_MS, spacingMs = CATCHUP_SPACING_MS,
  maxShown = CATCHUP_MAX_OUTSTANDING,
}) {
  if (showEnded) return null;
  if (shownCount >= maxShown) return null;
  if (outstandingPrompts({ pushed, answeredIds, seenIds }).length === 0) return null;
  const joinGate = joinedAt + afterJoinMs;
  const spacingGate = Number.isFinite(lastShownAt) ? lastShownAt + spacingMs : -Infinity;
  return Math.max(0, Math.max(joinGate, spacingGate) - now);
}
