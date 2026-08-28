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

import { showWindowClosesAt, WINDOW_OPENS_BEFORE_MS as WINDOW_BEFORE } from './showWindow';

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
