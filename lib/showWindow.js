// lib/showWindow.js
// ─────────────────────────────────────────────────────────────
// The show-window rule, as pure functions over a `show` row and a clock.
//
// DELIBERATELY NOT a client module and with NO imports, because BOTH
// sides need it: the browser (Discover, Kit Check, the live page, the
// schedule list) and the server (app/api/performer/join-show, which
// gates the token). Those two disagreeing about when a show is over is
// the kind of bug where an artist is told their window is shut by a
// screen and let in by a route, or the reverse.
//
// It used to be exactly that: lib/scheduling.js had one three-hour
// constant and join-show had its own copy of the same three hours. Two
// copies of a number that was itself a placeholder for the duration
// nobody had asked for.
// ─────────────────────────────────────────────────────────────

// How early the BROADCAST window opens, for setup and soundcheck. The
// show window itself opens at the slated time; these two differ only at
// the start and close together.
export const WINDOW_OPENS_BEFORE_MS = 30 * 60 * 1000;

// ── PRODUCT RULING 1: EVERY SHOW HAS A DURATION ───────────────
//
// A show used to have a start and no end, so everything downstream
// invented one — a flat three-hour window, an unbounded "Live Now", a
// GO LIVE that would arm on a show slated last Tuesday, and an Upcoming
// list that could never tell "hasn't happened yet" from "never
// happened". All four were guessing at the same missing fact.
//
// THE ONE DEFINITION, applied everywhere:
//
//     show window = slated_at  →  slated_at + duration + 15 min grace
//
// The grace exists because a show that runs three minutes long is a show
// running slightly long, not a show that has broken a rule. Fifteen
// minutes is enough for an encore and short enough that an abandoned
// room does not sit open for an afternoon.
export const DEFAULT_DURATION_MINUTES = 60;
export const DURATION_OPTIONS_MINUTES = [30, 60, 90, 120, 180];
export const MIN_DURATION_MINUTES = 15;
export const MAX_DURATION_MINUTES = 180;
export const WINDOW_GRACE_MS = 15 * 60 * 1000;

/**
 * This show's duration in ms.
 *
 * Falls back to the default when `duration_minutes` is absent, which is
 * the PRE-MIGRATION state: the column arrives with
 * docs/overnight2_12_shows_duration.sql, and until it does every show
 * behaves as a 60-minute show rather than the rules switching off. The
 * clamp is not paranoia — the DB constraint is NOT VALID, so a
 * hand-edited legacy row could hold anything.
 */
export function showDurationMs(show) {
  const raw = Number(show?.duration_minutes);
  const minutes = Number.isFinite(raw) && raw > 0
    ? Math.min(Math.max(raw, MIN_DURATION_MINUTES), MAX_DURATION_MINUTES)
    : DEFAULT_DURATION_MINUTES;
  return minutes * 60 * 1000;
}

/** The show itself starts at its slated time. Named for symmetry. */
export function showWindowOpensAt(show) {
  if (!show?.slated_at) return null;
  return new Date(show.slated_at).getTime();
}

/**
 * When the show window shuts. THE authority for: is this still live, can
 * it still be armed, does it belong in Live Now, is it expired.
 *
 * `ends_at` still wins when set — it is the explicit override for a show
 * with an unusual end, and duration is the default path.
 */
export function showWindowClosesAt(show) {
  if (!show?.slated_at) return null;
  if (show.ends_at) return new Date(show.ends_at).getTime();
  return new Date(show.slated_at).getTime() + showDurationMs(show) + WINDOW_GRACE_MS;
}

/** Is the show itself in progress right now (ignoring soundcheck)? */
export function isShowWindowOpen(show, now = Date.now()) {
  const opens = showWindowOpensAt(show);
  const closes = showWindowClosesAt(show);
  if (opens === null) return false;
  return now >= opens && now < closes;
}

/**
 * Scheduled, never run, and its window has now closed.
 *
 * This is what Upcoming needs to stop showing something as pending
 * forever. Deliberately excludes 'ended' (that show happened and
 * finished) — an expired show is one nobody ever started.
 */
export function isExpired(show, now = Date.now()) {
  if (!show || show.state === 'ended') return false;
  const closes = showWindowClosesAt(show);
  return closes !== null && now >= closes;
}

/** How much of the show is left, in ms. Negative once past the end. */
export function msRemainingInShow(show, now = Date.now()) {
  if (!show?.slated_at) return null;
  return (new Date(show.slated_at).getTime() + showDurationMs(show)) - now;
}


export function windowOpensAt(show) {
  if (!show?.slated_at) return null;
  return new Date(show.slated_at).getTime() - WINDOW_OPENS_BEFORE_MS;
}

/**
 * When the BROADCAST window shuts — when LiveKit may no longer be
 * touched for this show.
 *
 * Tied to the show's own window rather than a flat three hours. That
 * flat number was the placeholder standing in for a duration nobody had
 * asked for: a 30-minute set held its connection window open for two and
 * a half hours after it finished.
 */
export function windowClosesAt(show) {
  return showWindowClosesAt(show);
}

/**
 * Is this show's broadcast window open right now? This is the ONLY
 * question that should gate a LiveKit connection.
 */
export function isWindowOpen(show, now = Date.now()) {
  if (!show || show.state === 'ended') return false;
  const opens = windowOpensAt(show);
  const closes = windowClosesAt(show);
  if (opens === null) return false;
  return now >= opens && now < closes;
}
