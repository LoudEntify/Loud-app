// lib/liveCuts.js — the artist cutting their own show.
//
// The console's "Cuts" button (Console.dc.html, next to Prompt, Vote and
// Fix) opens a picker of the cameras that are actually on. The phone board
// draws the button and no panel; TabletConsole.dc.html draws the panel, as
// a row of four tiles — Main, Side, Close, B-roll — with the live one
// marked `aria-pressed` and bordered 3px teal, over a feed tagged
// `ON AIR · MAIN`. That row is the vocabulary, so the phone sheet is built
// from it rather than from a second idea of what a cut is.
//
// Two states, one control:
//
//   Auto    the director cuts, on the artist's pace and allowed moves
//           (DirectionSettings.dc.html). Taking a cut by hand leaves it.
//   Manual  the artist's last pick stays on air until they pick again or
//           go back to Auto.
//
// This file is the rules only — which cuts exist, which are available
// right now, and what a request resolves to. It has no I/O and no React,
// so the console, the compositor and the tests all read the same answers.
//
// PRD rows 127, 128. S&I: Real-time media.

import { NEAREST_SHOT_FOR_ROLE } from './shotTypes.js';
import { allowedShots } from './direction.js';

/** The four the board draws, in the order it draws them. */
export const CUTS = Object.freeze([
  { role: 'main', label: 'Main', note: 'The camera you perform to.' },
  { role: 'side', label: 'Side', note: 'A second phone, off to one side.' },
  { role: 'close', label: 'Close', note: 'Tight on your hands or your face.' },
  { role: 'broll', label: 'B-roll', note: 'A clip from your library.' },
]);

export const CUT_ROLES = CUTS.map((c) => c.role);
export const DIRECTOR_MODES = Object.freeze(['auto', 'manual']);
export const DEFAULT_CUT = 'main';

/** The shot grammar key a camera role resolves to, for the egress log. */
export const shotKeyFor = (role) => NEAREST_SHOT_FOR_ROLE[role] || null;

const isRole = (r) => CUT_ROLES.includes(r);

/**
 * Which cuts the artist can take right now.
 *
 * A camera that is paired but not sending frames is not available: "Camera
 * healthy means frames keep arriving, not that it connected" (CLAUDE.md §5).
 * B-roll is available only when the artist has a clip to play. A cut the
 * artist has switched off in Direction settings is not offered at all,
 * because the console is not the place to argue with their own settings.
 *
 * @param cameras  { main: {live}, side: {live}, close: {live} } or similar
 * @param brollCount how many clips are in the library
 * @param settings the artist's direction settings, or null for no filtering
 * @returns [{ role, label, note, available, why }]
 */
export function cutAvailability({ cameras = {}, brollCount = 0, settings = null } = {}) {
  const permitted = settings ? new Set(allowedShots(settings)) : null;
  return CUTS.map((c) => {
    const shot = shotKeyFor(c.role);
    if (permitted && shot && !permitted.has(shot)) {
      return { ...c, available: false, why: 'You have this one switched off in Direction settings.' };
    }
    if (c.role === 'broll') {
      return brollCount > 0
        ? { ...c, available: true, why: null }
        : { ...c, available: false, why: 'Add a clip in Studio library and it appears here.' };
    }
    const cam = cameras[c.role];
    if (!cam) return { ...c, available: false, why: c.role === 'main' ? 'No camera is sending yet.' : 'Pair a phone as this camera to use it.' };
    if (cam.live === false) return { ...c, available: false, why: 'This camera stopped sending. The Fix sheet can bring it back.' };
    return { ...c, available: true, why: null };
  });
}

/** The cuts that can be taken, as roles. */
export const availableCuts = (input) => cutAvailability(input).filter((c) => c.available).map((c) => c.role);

/**
 * What is on air after a request.
 *
 * The rules the show depends on, in order:
 *
 *   1. The show must never stop. A cut to a camera that is not available
 *      is refused and whatever is on air stays on air — the artist sees
 *      why, the audience sees nothing.
 *   2. Taking a cut by hand means manual. Nobody taps a camera and expects
 *      the director to take it back two seconds later.
 *   3. Going back to Auto hands over at once, from wherever it was.
 *   4. If what is on air becomes unavailable (a camera drops), fall back to
 *      the first available cut rather than holding a dead feed.
 *
 * @returns { role, shotKey, mode, changed, refused }
 */
export function resolveCut({ current = DEFAULT_CUT, requested = null, mode = 'auto', cameras = {}, brollCount = 0, settings = null } = {}) {
  const open = availableCuts({ cameras, brollCount, settings });
  const fallback = open[0] || DEFAULT_CUT;
  const safeCurrent = open.includes(current) ? current : fallback;

  // Going back to the director.
  if (requested === 'auto') {
    return { role: safeCurrent, shotKey: shotKeyFor(safeCurrent), mode: 'auto', changed: safeCurrent !== current, refused: null };
  }

  if (requested == null) {
    // No request: only a dropped camera moves anything.
    return { role: safeCurrent, shotKey: shotKeyFor(safeCurrent), mode: DIRECTOR_MODES.includes(mode) ? mode : 'auto', changed: safeCurrent !== current, refused: null };
  }

  if (!isRole(requested)) {
    return { role: safeCurrent, shotKey: shotKeyFor(safeCurrent), mode, changed: safeCurrent !== current, refused: 'That is not a camera.' };
  }

  if (!open.includes(requested)) {
    const why = cutAvailability({ cameras, brollCount, settings }).find((c) => c.role === requested)?.why || 'That camera is not available.';
    // Refused, and the picture does not move.
    return { role: safeCurrent, shotKey: shotKeyFor(safeCurrent), mode, changed: safeCurrent !== current, refused: why };
  }

  return { role: requested, shotKey: shotKeyFor(requested), mode: 'manual', changed: requested !== current, refused: null };
}

/** What the board tags over the picture: "ON AIR · MAIN". */
export const onAirLabel = (role) => `ON AIR · ${(CUTS.find((c) => c.role === role)?.label || role).toUpperCase()}`;

/** The word on the console's director button: "Director: Auto" / "Director: Manual". */
export const directorLabel = (mode) => `Director: ${mode === 'manual' ? 'Manual' : 'Auto'}`;
