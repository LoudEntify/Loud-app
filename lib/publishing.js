// lib/publishing.js
// ─────────────────────────────────────────────────────────────
// What it means to be publishing into a show, as states and sentences.
//
// ── WHY THIS IS SHARED ────────────────────────────────────────
// Two artist positions join the same room through the same route
// (/api/performer/join-show) and have to say the same things about it.
// The phone already does it, in native/src/ownCamera.js, with its own
// OWN_CAMERA_* constants and its own wording for a failed join. The web
// console is about to need the same thing, and writing the second copy
// is how the two come to describe one situation differently — which for
// a performer waiting to go on is worse than either wording alone.
//
// ── THE ONE RULE WORTH STATING ────────────────────────────────
// A warning is not a failure. The camera telling an artist that the
// phone is on its side, or that it could not hold a frame rate, must
// not read as "you are not live" — because the camera IS running, and
// an artist who thinks they are off air behaves very differently from
// one who knows they are on. native/src/ownCamera.js has that comment
// already; this module makes it a function rather than a comment.
//
// Imports nothing, names no platform.
// ─────────────────────────────────────────────────────────────

export const IDLE = 'idle';
export const STARTING = 'starting';
export const LIVE = 'live';
export const FAILED = 'failed';

export const PHASES = Object.freeze([IDLE, STARTING, LIVE, FAILED]);

/** Is the artist's own camera and microphone in the show right now? */
export const isPublishing = (phase) => phase === LIVE;

/** Should the screen offer a retry? Only a failure, and never while one is in flight. */
export const canRetry = (phase) => phase === FAILED;

/**
 * The phase a reported event moves us to.
 *
 * `warning` is deliberately NOT a phase: it leaves the phase alone, so a
 * frame-rate notice during a performance cannot read as being off air.
 */
export function nextPhase(phase, event) {
  switch (event) {
    case 'starting': return STARTING;
    case 'published': return LIVE;
    case 'stopped': return IDLE;
    case 'failed': return FAILED;
    case 'warning': return phase;
    default: return phase;
  }
}

/**
 * What to say when a join is refused.
 *
 * The route's own message wins whenever there is one: it knows whether
 * the show window has not opened, has closed, or is not this artist's,
 * and those are better sentences than anything invented here. The
 * fallback exists for a transport failure, where there is no message
 * because there was no answer.
 */
export function joinFailureMessage(routeError) {
  const given = typeof routeError === 'string' ? routeError.trim() : '';
  if (given) return given;
  return 'We could not put your camera in the show. Your connection may have dropped.';
}

/**
 * One line of status for a screen.
 *
 * Says what IS rather than what is being attempted, except while
 * starting — which is the one moment an artist needs to know that
 * something is happening and nothing has gone wrong yet.
 */
export function describePublishing(phase, { error = null } = {}) {
  switch (phase) {
    case LIVE: return 'Your camera and microphone are in the show.';
    case STARTING: return 'Putting your camera in the show…';
    case FAILED: return error || joinFailureMessage(null);
    default: return 'Your camera is not in the show.';
  }
}
