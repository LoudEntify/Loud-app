// lib/alignment.js
// ─────────────────────────────────────────────────────────────
// Delay alignment: lining votes, reactions and Support up with what the
// viewer SAW, not what the server's clock said.
//
// docs/ARCHITECTURE.md "YouTube delivery rules (v2)": "stamp them with the
// viewer's playback position and give a short grace window when voting
// closes." Testing table: "Votes, reactions and Support line up with
// playback position under 3 to 10 seconds of delay."
//
// Two timelines:
//   server offset   = now - show.actual_started_at           (offset_ms)
//   playback        = where the viewer's player is           (playback_position_ms)
//   delay           = server offset - playback (≥ 0 under YouTube)
//
// Pure functions; tests/alignment.test.mjs drives them with 3–10 s delays.
// ─────────────────────────────────────────────────────────────

export const DEFAULT_GRACE_SECONDS = 15;

/** Server offset of the show at a wall-clock instant, or null if not started. */
export function serverOffsetMs(show, nowMs) {
  const started = show?.actual_started_at ? Date.parse(show.actual_started_at) : NaN;
  if (!Number.isFinite(started)) return null;
  return Math.max(0, nowMs - started);
}

/** Measured delivery delay for one report. Null if either side is unknown. */
export function measuredDelayMs(show, nowMs, playbackPositionMs) {
  const offset = serverOffsetMs(show, nowMs);
  if (offset == null || playbackPositionMs == null) return null;
  return offset - playbackPositionMs;
}

/**
 * Should a vote be accepted?
 *
 * A prompt is open from pushed_at until closed_at. A vote arriving after
 * closed_at is still accepted when EITHER the viewer's playback position
 * shows they had not yet reached the moment the prompt closed (their
 * picture was behind), OR it arrives within the grace window. Both are
 * bounded by the grace window so nobody can vote after seeing the result.
 */
export function voteDecision({ prompt, show, nowMs, playbackPositionMs }) {
  if (!prompt) return { accept: false, reason: 'no_prompt' };
  if (!prompt.closed_at) return { accept: true, reason: 'open' };
  const closedAt = Date.parse(prompt.closed_at);
  const grace = (Number.isFinite(prompt.grace_seconds) ? prompt.grace_seconds : DEFAULT_GRACE_SECONDS) * 1000;
  if (nowMs <= closedAt) return { accept: true, reason: 'open' };
  const late = nowMs - closedAt;
  if (late > grace) return { accept: false, reason: 'closed' };
  // Within grace. If we can tell where the viewer was, require that their
  // picture was still before the close; otherwise accept on grace alone.
  const closeOffset = serverOffsetMs(show, closedAt);
  if (closeOffset != null && playbackPositionMs != null && playbackPositionMs > closeOffset + grace) {
    return { accept: false, reason: 'after_close_on_screen' };
  }
  return { accept: true, reason: 'grace' };
}

/**
 * Which round (prompt) a reaction or Support belongs to, by playback
 * position: the prompt whose [pushed offset, closed offset] window contains
 * the viewer's position. Falls back to wall-clock when positions are unknown.
 */
export function attributeToPrompt(prompts, { show, nowMs, playbackPositionMs }) {
  const list = (prompts || []).filter((p) => p.pushed_at);
  const byPosition = playbackPositionMs != null && show?.actual_started_at;
  for (const p of list) {
    const start = byPosition ? serverOffsetMs(show, Date.parse(p.pushed_at)) : Date.parse(p.pushed_at);
    const end = p.closed_at ? (byPosition ? serverOffsetMs(show, Date.parse(p.closed_at)) : Date.parse(p.closed_at)) : Infinity;
    const t = byPosition ? playbackPositionMs : nowMs;
    if (t >= start && t <= end) return p;
  }
  return null;
}
