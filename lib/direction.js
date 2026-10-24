// lib/direction.js
// ─────────────────────────────────────────────────────────────
// Direction settings: what the artist lets the director do. The approved
// screen is design/DirectionSettings.dc.html (auto director on/off, pace,
// manual cuts, the moves the director can use, Versus switching, what an
// operator can do); the transitions catalogue and the look are the two
// sections added on 23 Oct (docs/DECISIONS.md). Saved per artist in
// `direction_settings`; the look is copied onto each show at booking
// (`shows.look`) because the look on screen is a show-level fact like the
// Versus view (docs/CLAUDE.md §5).
//
// Pure data: defaults, normalisation of a stored row, the technique gate
// the auto director asks, and the transition choice (shot grammar first,
// then the artist's list, then the taste rules). No I/O.
//
// PRD rows 15, 16, 139. S&I: Real-time media.
// ─────────────────────────────────────────────────────────────
import { SHOT_TYPES } from './shotTypes.js';
import { TRANSITIONS, TRANSITION_KEYS, DIRECTIONS, transitionAllowed } from './pipeline/transitions.js';
import { LOOK_NAMES, LOOK_RECIPES } from './pipeline/lut.js';

/** The moves, in the screen's order. `shots` are the shot keys (lib/shotTypes.js) each switch governs. */
export const TECHNIQUES = Object.freeze([
  { key: 'cut', label: 'Cut between cameras', hint: 'Switch angle on the beat or a phrase', shots: ['wide', 'mediumCU', 'closeUp'], on: true },
  { key: 'closeUp', label: 'Close-ups', hint: 'Move in on your hands or face', shots: ['closeUp', 'mediumCU'], on: true },
  { key: 'wide', label: 'Wide shots', hint: 'Pull back to show the whole room', shots: ['wide'], on: true },
  { key: 'zoom', label: 'Moving zoom', hint: 'Slow push in, using the lens', shots: ['zoomIn', 'zoomOut'], on: true },
  { key: 'pan', label: 'Pan', hint: 'Slow sweep across the room', shots: ['pan'], on: true },
  { key: 'bop', label: 'Bop', hint: 'A small bounce on the beat', shots: ['bop'], on: true },
  { key: 'broll', label: 'B-roll inserts', hint: 'Cut to your own clips between songs', shots: ['bRoll', 'bRollClip'], on: true },
]);
export const TECHNIQUE_KEYS = TECHNIQUES.map((t) => t.key);
export const PACES = ['calm', 'balanced', 'lively'];
export const VERSUS_PICKERS = ['artist_a', 'automatic'];

/** Transitions as the screen lists them, with the family the taste rules group them by. */
export const TRANSITION_CHOICES = TRANSITION_KEYS.map((key) => ({ key, label: TRANSITIONS[key].label, family: TRANSITIONS[key].family }));
/** Looks as the screen lists them. */
export const LOOK_CHOICES = LOOK_NAMES.map((key) => ({ key, label: LOOK_RECIPES[key].label, note: LOOK_RECIPES[key].note }));

export const DEFAULT_DIRECTION = Object.freeze({
  autoDirector: true,
  pace: 'balanced',
  showManualCuts: false,
  techniques: Object.fromEntries(TECHNIQUES.map((t) => [t.key, t.on])),
  transitions: ['cut', 'fade'],                 // DIRECTOR_TRANSITIONS_DEFAULT: everything else is opt-in
  transitionStrength: 1,
  look: { lut: 'none', strength: 1 },
  versusPicker: 'artist_a',
  operator: { cut: true, prompts: true, end: false },
});

const bool = (v, d) => (typeof v === 'boolean' ? v : d);
const clamp01 = (v, d) => (Number.isFinite(Number(v)) ? Math.min(1, Math.max(0, Number(v))) : d);

/** A stored row (or a request body, or nothing) → a complete, valid settings object. Unknown keys are dropped, bad values fall back. */
export function normaliseDirection(input) {
  const s = input && typeof input === 'object' ? input : {};
  const techniques = {};
  for (const t of TECHNIQUES) techniques[t.key] = bool(s.techniques?.[t.key], DEFAULT_DIRECTION.techniques[t.key]);
  const transitions = Array.isArray(s.transitions) ? [...new Set(s.transitions.filter((k) => TRANSITION_KEYS.includes(k)))] : [...DEFAULT_DIRECTION.transitions];
  if (!transitions.includes('cut')) transitions.unshift('cut');   // a cut is always available: the director must be able to change shot
  const lut = typeof s.look?.lut === 'string' && LOOK_NAMES.includes(s.look.lut) ? s.look.lut : DEFAULT_DIRECTION.look.lut;
  return {
    autoDirector: bool(s.autoDirector, DEFAULT_DIRECTION.autoDirector),
    pace: PACES.includes(s.pace) ? s.pace : DEFAULT_DIRECTION.pace,
    showManualCuts: bool(s.showManualCuts, DEFAULT_DIRECTION.showManualCuts),
    techniques,
    transitions,
    transitionStrength: clamp01(s.transitionStrength, DEFAULT_DIRECTION.transitionStrength),
    look: { lut, strength: clamp01(s.look?.strength, DEFAULT_DIRECTION.look.strength) },
    versusPicker: VERSUS_PICKERS.includes(s.versusPicker) ? s.versusPicker : DEFAULT_DIRECTION.versusPicker,
    operator: { cut: bool(s.operator?.cut, true), prompts: bool(s.operator?.prompts, true), end: bool(s.operator?.end, false) },
  };
}

/** Row ↔ settings: the table stores the settings object in one jsonb column, so this is the only mapping. */
export const directionFromRow = (row) => normaliseDirection(row?.settings);
export const directionToRow = (artistId, settings) => ({ artist_id: artistId, settings: normaliseDirection(settings), updated_at: new Date().toISOString() });

/** May the auto director fire this shot under these settings? A shot no switch governs (home framing) is always allowed. */
export function techniqueAllowed(settings, shotKey) {
  const s = normaliseDirection(settings);
  const owners = TECHNIQUES.filter((t) => t.shots.includes(shotKey));
  if (!owners.length) return true;
  return owners.every((t) => s.techniques[t.key]);
}

/** The shot keys the director may use under these settings (from SHOT_TYPES, minus what is switched off). */
export function allowedShots(settings, keys = Object.keys(SHOT_TYPES)) {
  return keys.filter((k) => techniqueAllowed(settings, k));
}

/** Hold times per pace (ms a framing is held before the next cut), for the auto director. */
export const PACE_HOLD_MS = Object.freeze({ calm: { min: 9000, max: 16000 }, balanced: { min: 5000, max: 10000 }, lively: { min: 2500, max: 5500 } });

/**
 * Choose the transition for a shot change. The shot grammar decides first
 * (resolveTransition: a cut-only shot such as a live zoom stays a cut);
 * where the grammar allows a fade, any transition on the artist's list
 * may stand in, subject to the taste rules (transitionAllowed) unless a
 * cue asked for one by name. Returns { type, direction, durationMs,
 * strength, seed, reason }. `random` is injectable for tests.
 */
export function chooseTransition({ settings, fromShot, toShot, cued = null, sinceLastShotMs = Infinity, sinceLastTransitionMs = Infinity, seed = 1, random = Math.random } = {}) {
  const s = normaliseDirection(settings);
  // The grammar's legal set: a compositor transition may stand in only where both shots allow a fade (never around a live zoom or staccato).
  const allows = (key) => (SHOT_TYPES[key] ? SHOT_TYPES[key].allowedTransitions : ['cut', 'fade']);
  const fadeLegal = allows(fromShot).includes('fade') && allows(toShot).includes('fade');
  const pick = (type, reason) => {
    const def = TRANSITIONS[type] || TRANSITIONS.cut;
    const direction = def.direction ? DIRECTIONS[Math.floor(random() * DIRECTIONS.length) % DIRECTIONS.length] : null;
    return { type, direction, durationMs: def.durationMs, strength: s.transitionStrength, seed, reason };
  };
  if (!fadeLegal) return pick('cut', `the shot grammar allows only a cut from ${fromShot || 'start'} to ${toShot}`);
  if (cued && TRANSITION_KEYS.includes(cued)) {
    const ok = transitionAllowed({ type: cued, sinceLastShotMs, sinceLastTransitionMs, cued: true });
    if (ok.ok) return pick(cued, 'cued');
  }
  const pool = s.transitions.filter((k) => k !== 'cut');
  if (!pool.length) return pick('cut', 'the artist allows cuts only');
  // the fancier ones only when the taste rules say so; fade is always fine
  const candidates = pool.filter((k) => transitionAllowed({ type: k, sinceLastShotMs, sinceLastTransitionMs }).ok);
  if (!candidates.length) return pick('cut', 'taste rules: too soon for another transition');
  const type = candidates[Math.floor(random() * candidates.length) % candidates.length];
  return pick(type, `from the artist's list (${candidates.join(', ')})`);
}

/** The look to apply to a show: the show's own if set, else the artist's default. */
export function showLook(show, settings) {
  const s = normaliseDirection(settings);
  const own = show?.look && typeof show.look === 'object' ? normaliseDirection({ look: show.look }).look : null;
  return own || s.look;
}
