// lib/showState.js
// ─────────────────────────────────────────────────────────────
// Show lifecycle state machine (SHOW_LIFECYCLE_SPEC.md).
//
// Stored states: 'scheduled' | 'soundcheck' | 'ended'. 'live' is DERIVED,
// never stored -- a 'soundcheck' row whose slated_at has passed IS live.
// This avoids any background job/cron flipping rows.
//
// PRD: Live Show / Director Experience | S&I: Database, Real-time media
// ─────────────────────────────────────────────────────────────

import { showWindowClosesAt, WINDOW_OPENS_BEFORE_MS as WINDOW_BEFORE } from './showWindow.js'; // .js so this module also loads in plain Node (scripts/window-tests.mjs)

export function effectiveState(show, now = Date.now()) {
  if (!show) return 'scheduled';
  if (show.state === 'ended') return 'ended';

  // ── THE SWEEP (Product Ruling 1), and it is free ─────────────
  // Once the show window has closed, the show is over — whether or not
  // anyone pressed End Show. Deriving that here rather than in a
  // background job means every client reaches it independently, on load
  // and on every clock tick, with no cron and nothing to fall behind:
  // exactly the same pattern 'live' already uses.
  //
  // A show nobody ended used to stay 'live' forever, which is what let
  // it sit in Live Now indefinitely advertising an empty room.
  const closes = showWindowClosesAt(show);
  if (closes !== null && now >= closes) return 'ended';

  const slated = new Date(show.slated_at).getTime();
  if (show.state === 'soundcheck') return now >= slated ? 'live' : 'soundcheck';
  return 'scheduled';
}

// Re-exported from the one definition rather than declared again -- two
// numbers for "how early can I start" is a bug generator, and this file
// and lib/showWindow.js used to each hold one.
export const SOUNDCHECK_WINDOW_MS = WINDOW_BEFORE;

/**
 * Can the artist arm this show right now?
 *
 * Two bounds, and the UPPER one is new (Product Ruling 1). Before it,
 * canGoLive had no end at all: an artist could open a show slated last
 * Tuesday and press GO LIVE, putting a three-day-old show into Live Now.
 *
 * The lower bound is unchanged at T−30 rather than the slated time
 * itself. That is a deliberate reading of the ruling: GO LIVE is what
 * starts SOUNDCHECK ('scheduled' -> 'soundcheck'), and arming only from
 * slated_at would delete soundcheck entirely — the artist would have no
 * way to be set up and warm when their audience arrives. See DECISIONS.md.
 */
export function canGoLive(show, now = Date.now()) {
  if (!show || show.state !== 'scheduled') return false;
  const slated = new Date(show.slated_at).getTime();
  const closes = showWindowClosesAt(show);
  if (now < slated - SOUNDCHECK_WINDOW_MS) return false;
  return closes === null || now < closes;
}

// ── THE OFFSET ORIGIN (item 3) ────────────────────────────────
//
// "How far into the show did this happen?" Every offset in the product
// is measured from here: reactions today, comments and prompt responses
// once items 5 and 6 land.
//
// ⚠️ THIS IS NOT A SCHEDULING FUNCTION, and the distinction is the whole
// reason it exists as its own helper rather than as an inline
// `actual_started_at ?? slated_at` at each call site.
//
//   SCHEDULING asks "should the door be open yet?" and must answer from
//   slated_at ALONE. lib/showWindow.js, canGoLive above and
//   lib/scheduling.js all decide when a show opens, arms and expires, and
//   none of them may wait for a show to actually start — a show that
//   never starts still has to expire, and a door that only opens once
//   the artist goes live is a door nobody can arrive at early.
//
//   OFFSETS ask "how long after the performance began?" and must answer
//   from actual_started_at when there is one. An artist who goes live
//   eight minutes late makes every slated-at offset eight minutes wrong,
//   and "42 seconds in" stops lining up with a shot change.
//
// Mixing them is silent in both directions: a scheduling site that
// adopted this would leave shows unexpirable, and an offset site that
// skipped it would record times that look plausible and are not. So:
// ONLY offset writers call this.
//
// STATED LIMIT: this fixes offsets from pilot 2 onward. Pilot 1's
// reaction_events.offset_ms values are uncorrectable — no actual start
// time was ever recorded, so there is nothing to correct them against.
export function showOriginMs(show) {
  if (!show) return null;
  const actual = show.actual_started_at ? new Date(show.actual_started_at).getTime() : NaN;
  if (Number.isFinite(actual)) return actual;
  const slated = show.slated_at ? new Date(show.slated_at).getTime() : NaN;
  return Number.isFinite(slated) ? slated : null;
}

// Which of the two origins showOriginMs actually used.
//
// Recorded alongside the offset itself wherever that is cheap, because an
// offset measured from slated_at and one measured from actual_started_at
// are different quantities wearing the same name. On the 21st, a mix of
// both in one column with no way to tell them apart is the failure this
// prevents — the same discipline as shows.ended_by labelling an inferred
// end rather than flattening it into a fact.
export function showOriginSource(show) {
  if (!show) return null;
  return Number.isFinite(show.actual_started_at ? new Date(show.actual_started_at).getTime() : NaN)
    ? 'actual'
    : 'slated';
}
