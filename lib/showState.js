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

export function effectiveState(show, now = Date.now()) {
  if (!show) return 'scheduled';
  if (show.state === 'ended') return 'ended';
  const slated = new Date(show.slated_at).getTime();
  if (show.state === 'soundcheck') return now >= slated ? 'live' : 'soundcheck';
  return 'scheduled';
}

export const SOUNDCHECK_WINDOW_MS = 30 * 60 * 1000;

export function canGoLive(show, now = Date.now()) {
  const slated = new Date(show.slated_at).getTime();
  return show.state === 'scheduled' && now >= slated - SOUNDCHECK_WINDOW_MS;
}
