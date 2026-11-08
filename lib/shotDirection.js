// lib/shotDirection.js
// ─────────────────────────────────────────────────────────────
// Who is on screen, and what the artist may cut to.
//
// ── WHY THIS EXISTS ───────────────────────────────────────────
// docs/ONE_JOURNEY.md step 2 has two panels left behind the new web
// console: DirectorShotPanel and VideoDeckPanel. Neither is a wiring
// job. Every prop they take — `tracks`, `availableRoles`, `candidates`,
// `activeIdentity`, `onPick`, `mode` — is state that `RoomInner` inside
// components/LiveDemo.jsx owns, and the new console owns none of it. Its
// "Director: Auto" chip is dead markup today, and an artist performing
// from a browser cannot take a manual cut.
//
// The transport was never the problem: lib/shotCommands.js already
// builds and broadcasts commands, and lib/shotTypes.js already holds the
// grammar. What lived only inside LiveDemo was the handful of RULES
// below — which tracks belong to a slot, which of them an artist may
// actually cut to, and which shot a direct pick means. They were
// `useCallback`s in the middle of a 6,591-line component, so nothing
// else could use them and no test could reach them.
//
// So they move here, as functions over plain arrays. The React state
// that holds the current pick is the console's; these decide what the
// pick MAY be.
//
// ── WHAT THIS DOES NOT DO ─────────────────────────────────────
// It does not talk to LiveKit, build a command, or decide what the auto
// director fires. lib/shotCommands.js and lib/shotTypes.js own those and
// keep owning them. Imports nothing but the two modules that hold the
// grammar and the track vocabulary, so it can be tested without a room.
//
// PRD rows 15, 16 (Director Experience). S&I: Real-time media.
// ─────────────────────────────────────────────────────────────

import { NEAREST_SHOT_FOR_ROLE } from './shotTypes.js';
import { belongsToSlot, cameraTracksOnly, roleOfTrack, sourceKey } from './trackSources.js';

/**
 * The shot a DIRECT pick means.
 *
 * Picking a camera out of the feed strip is not a different mechanism
 * from cutting: it is a human cut to the nearest shot for that camera's
 * role. LiveDemo's own comment records why — the old 'active-camera'
 * message was untracked, so direct picks never reached the flywheel
 * while every other cut did. 'wide' is the fallback because a full-frame
 * main IS the wide shot when no dedicated wide camera exists
 * (lib/shotTypes.js says so at its `wide` entry).
 */
export const shotForDirectPick = (role) => (role && NEAREST_SHOT_FOR_ROLE[role]) || 'wide';

/**
 * The tracks belonging to one slot that are worth showing.
 *
 * A muted publication is excluded: the track exists, the camera is not
 * sending, and offering it as a cut is offering a black frame. This is
 * the one place that judgement is made, so the feed strip and the shot
 * console cannot disagree about whether a camera is available —
 * docs/CLAUDE.md §5: "camera healthy means frames keep arriving, not
 * that it connected."
 */
export function tracksForSlot(tracks, slot) {
  if (!Array.isArray(tracks)) return [];
  return tracks.filter((t) => belongsToSlot(t, slot) && !t?.publication?.isMuted);
}

/**
 * What VideoDeckPanel shows: the cameras in this slot, b-roll excluded.
 *
 * Cameras only, because the panel is a camera picker and resolving a
 * pick back to a track within a camera-only pool is then unambiguous.
 * A b-roll track could not be chosen here even if one were passed.
 */
export const candidatesForSlot = (tracks, slot) => cameraTracksOnly(tracksForSlot(tracks, slot));

/**
 * Which roles the director may use for this slot, from what is actually
 * publishing. An empty list means no camera is sending — which the shot
 * console shows as every cut unavailable, rather than offering cuts that
 * would land on nothing.
 */
export function availableRoles(tracks, slot) {
  const roles = new Set();
  for (const t of tracksForSlot(tracks, slot)) {
    const r = roleOfTrack(t);
    if (r) roles.add(r);
  }
  return [...roles];
}

/**
 * Resolve a picked participant identity back to its track and role.
 *
 * Returns `{ track, role, shotKey, sourceKey }`, or nulls when the
 * identity is not a camera in this slot — which happens when a phone
 * drops between the strip rendering and the tap landing. The caller
 * fires nothing in that case rather than cutting to a feed that left.
 *
 * The role comes from roleOfTrack, the same function every other site
 * uses, rather than from parsing the identity string: identities are
 * formatted in several places and a parser here would be a second,
 * quieter definition of what a camera's job is.
 */
export function resolveDirectPick(tracks, slot, identity) {
  const track = candidatesForSlot(tracks, slot).find((t) => t?.participant?.identity === identity) || null;
  const role = track ? (roleOfTrack(track) ?? null) : null;
  return {
    track,
    role,
    shotKey: track ? shotForDirectPick(role) : null,
    sourceKey: track ? sourceKey(track) : null,
  };
}

/** Director modes, as the console offers them. */
export const DIRECTOR_MODES = Object.freeze(['auto', 'manual']);
export const DEFAULT_DIRECTOR_MODE = 'auto';

/**
 * Is the auto director allowed to be running right now?
 *
 * Two things stop it, and they are different: the artist switched to
 * manual, or nothing is publishing. The second matters because an auto
 * director with no cameras does not idle quietly — it fires cuts at
 * tracks that are not there. docs/CLAUDE.md §4: the show must never
 * stop, so this degrades to a single camera rather than to cutting.
 */
export function autoDirectorState({ mode = DEFAULT_DIRECTOR_MODE, tracks = [], slot } = {}) {
  if (mode !== 'auto') return 'off';
  return availableRoles(tracks, slot).length > 1 ? 'running' : 'suspended';
}
