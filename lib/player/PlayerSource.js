// lib/player/PlayerSource.js
// ─────────────────────────────────────────────────────────────
// PlayerSource: the one interface viewer delivery sits behind.
//
// docs/CLAUDE.md §5: "Viewer delivery goes behind one interface
// (PlayerSource) with two implementations: youtube (first) and
// loudentify-llhls (later, when funded). Switching is configuration, not a
// rewrite." PRD row 143. This file adds a third, `fixture`, for tests and
// seeded shows (see docs/DECISIONS.md, 2 Oct).
//
// Contract — every implementation returns an object with:
//
//   kind              'youtube' | 'loudentify-llhls' | 'fixture'
//   mount(el, opts)   put the player INSIDE `el` (a sized box the layout
//                     owns; the source must fill it and never escape it).
//                     opts.onState(state) with 'loading' | 'ready' |
//                     'playing' | 'paused' | 'buffering' | 'ended' |
//                     'error' | 'offline'; opts.onError(message).
//   play() / pause()
//   positionMs()      the viewer's CURRENT playback position in ms, or null
//                     if unknown. This is what votes, reactions, Support and
//                     metering are stamped with (docs/CLAUDE.md §5).
//   setVersusView(v)  optional; only the fixture draws views itself. The
//                     real sources show whatever the compositor sent.
//   destroy()
//
// Screens never import an implementation directly; they call
// createPlayerSource(show) and use the contract. Nothing may overlay the
// element the source is mounted in (docs/CLAUDE.md §6).
// ─────────────────────────────────────────────────────────────

export const PLAYER_STATES = ['loading', 'ready', 'playing', 'paused', 'buffering', 'ended', 'error', 'offline'];

export const DELIVERY_KINDS = ['youtube', 'loudentify-llhls', 'fixture'];

/**
 * Pick the implementation from the show's configuration.
 * `show.delivery` is the per-show setting (migration 20261002010000);
 * NEXT_PUBLIC_PLAYER_SOURCE_OVERRIDE lets an environment force one kind
 * (e.g. 'fixture' in CI), which is the "selected by configuration per
 * show or per region" rule in ARCHITECTURE.md.
 */
export async function createPlayerSource(show, { override } = {}) {
  const kind = override || (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_PLAYER_SOURCE_OVERRIDE) || show?.delivery || 'youtube';
  if (!DELIVERY_KINDS.includes(kind)) throw new Error(`Unknown PlayerSource kind: ${kind}`);
  if (kind === 'fixture') {
    const { createFixtureSource } = await import('./fixture.js');
    return createFixtureSource(show);
  }
  if (kind === 'loudentify-llhls') {
    const { createLlhlsSource } = await import('./llhls.js');
    return createLlhlsSource(show);
  }
  const { createYouTubeSource } = await import('./youtube.js');
  return createYouTubeSource(show);
}

/** Shared helper: a tiny state machine so every source reports the same way. */
export function makeStateReporter(opts) {
  let last = null;
  return (state) => {
    if (!PLAYER_STATES.includes(state)) return;
    if (state === last) return;
    last = state;
    try { opts?.onState?.(state); } catch { /* a listener must never break playback */ }
  };
}
