// lib/shotTypes.js
// ─────────────────────────────────────────────────────────────
// Loudentify Shot Grammar — single source of truth.
// Drives: DirectorShotPanel (UI), ShotRenderer (viewer transforms),
// and flywheel logging (technique labels).
//
// PRD: Director Experience | S&I: Real-time media, Observability
// ─────────────────────────────────────────────────────────────

// --- Portrait crop starting values (Stage 2 of the portrait work) -----
// The landscape values inlined below (mediumCU/closeUp/bRoll/zoomIn/
// zoomOut/dolly) are untouched and already working -- these are the
// portrait counterparts, and they're first guesses, not settled: a
// person fills more of a tall narrow frame than a wide one at the same
// distance, so portrait framings generally need LESS additional zoom to
// read as tight than their landscape equivalents. Every one of these is
// meant to be tuned by eye against real portrait footage -- that's the
// whole point of naming them individually here instead of inlining
// literals, so each can be nudged without hunting through the object
// below or risking a typo in a duplicated literal.
//
// zoomIn/zoomOut/dolly's *ranges* (not just origins) are narrowed here
// too, since "gentler in portrait" applies to motion as much as static
// crops -- Stage 3 (technique scaling, not started yet) will likely
// formalize this further into the agreed landscape / portrait-native /
// portrait-cropped three-tier system; treat these as Stage 2's
// reasonable starting point for that, not the final system.
const PORTRAIT_MEDIUM_CU_SCALE = 1.1;
const PORTRAIT_MEDIUM_CU_ORIGIN_X = 50;
const PORTRAIT_MEDIUM_CU_ORIGIN_Y = 32;

const PORTRAIT_CLOSE_UP_SCALE = 1.2;
const PORTRAIT_CLOSE_UP_ORIGIN_X = 50;
const PORTRAIT_CLOSE_UP_ORIGIN_Y = 28;

const PORTRAIT_B_ROLL_SCALE = 1.1;
const PORTRAIT_B_ROLL_ORIGIN_X = 50;
const PORTRAIT_B_ROLL_ORIGIN_Y = 55;

const PORTRAIT_ZOOM_IN_FROM = 1.0;
const PORTRAIT_ZOOM_IN_TO = 1.2;
const PORTRAIT_ZOOM_IN_ORIGIN_X = 50;
const PORTRAIT_ZOOM_IN_ORIGIN_Y = 32;

const PORTRAIT_ZOOM_OUT_FROM = 1.2;
const PORTRAIT_ZOOM_OUT_TO = 1.0;
const PORTRAIT_ZOOM_OUT_ORIGIN_X = 50;
const PORTRAIT_ZOOM_OUT_ORIGIN_Y = 32;

const PORTRAIT_DOLLY_FROM = 1.15;
const PORTRAIT_DOLLY_TO = 1.0;
const PORTRAIT_DOLLY_ORIGIN_X = 50;
const PORTRAIT_DOLLY_ORIGIN_Y = 40;

export const SHOT_TYPES = {
  // ───────── STATIC ─────────
  wide: {
    label: 'Wide',
    category: 'static',
    source: ['wide', 'main'], // full-frame main is the wide shot when no wide camfeed exists (L6-4)
    transform: null,
    allowedTransitions: ['cut', 'fade'],
    defaultTransition: 'fade',
  },
  mediumCU: {
    label: 'Medium CU',
    category: 'static',
    source: ['main', 'wide'], // prefer the contestant's own phone, fall back to cropped wide
    transform: {
      landscape: { kind: 'crop', scale: 1.25, originX: 50, originY: 30 },
      portrait: { kind: 'crop', scale: PORTRAIT_MEDIUM_CU_SCALE, originX: PORTRAIT_MEDIUM_CU_ORIGIN_X, originY: PORTRAIT_MEDIUM_CU_ORIGIN_Y },
    },
    allowedTransitions: ['cut', 'fade'],
    defaultTransition: 'fade',
  },
  closeUp: {
    label: 'Close Up',
    category: 'static',
    source: ['close', 'main'], // prefer a dedicated close camfeed; fall back to cropped main
    transform: {
      landscape: { kind: 'crop', scale: 1.4, originX: 50, originY: 25 },
      portrait: { kind: 'crop', scale: PORTRAIT_CLOSE_UP_SCALE, originX: PORTRAIT_CLOSE_UP_ORIGIN_X, originY: PORTRAIT_CLOSE_UP_ORIGIN_Y },
    },
    allowedTransitions: ['cut', 'fade'],
    defaultTransition: 'fade',
  },
  bRoll: {
    label: 'B-Roll',
    category: 'static',
    source: ['side'],
    transform: {
      landscape: { kind: 'crop', scale: 1.2, originX: 50, originY: 60 }, // hands / instrument zone
      portrait: { kind: 'crop', scale: PORTRAIT_B_ROLL_SCALE, originX: PORTRAIT_B_ROLL_ORIGIN_X, originY: PORTRAIT_B_ROLL_ORIGIN_Y },
    },
    allowedTransitions: ['cut', 'fade'],
    defaultTransition: 'fade',
  },

  // ───────── MOVING (digital) ─────────
  zoomIn: {
    label: 'Zoom In',
    category: 'moving',
    source: 'currentOrSelected',
    transform: {
      landscape: {
        kind: 'animatedZoom',
        from: 1.0,
        to: 1.4,
        durationMs: 4000,
        easing: 'ease-in-out',
        originX: 50,
        originY: 30,
      },
      portrait: {
        kind: 'animatedZoom',
        from: PORTRAIT_ZOOM_IN_FROM,
        to: PORTRAIT_ZOOM_IN_TO,
        durationMs: 4000,
        easing: 'ease-in-out',
        originX: PORTRAIT_ZOOM_IN_ORIGIN_X,
        originY: PORTRAIT_ZOOM_IN_ORIGIN_Y,
      },
    },
    allowedTransitions: ['cut'], // never fade around a live zoom
    defaultTransition: 'cut',
    interruptible: true,
  },
  zoomOut: {
    label: 'Zoom Out',
    category: 'moving',
    source: 'currentOrSelected',
    transform: {
      landscape: {
        kind: 'animatedZoom',
        from: 1.4,
        to: 1.0,
        durationMs: 4000,
        easing: 'ease-in-out',
        originX: 50,
        originY: 30,
      },
      portrait: {
        kind: 'animatedZoom',
        from: PORTRAIT_ZOOM_OUT_FROM,
        to: PORTRAIT_ZOOM_OUT_TO,
        durationMs: 4000,
        easing: 'ease-in-out',
        originX: PORTRAIT_ZOOM_OUT_ORIGIN_X,
        originY: PORTRAIT_ZOOM_OUT_ORIGIN_Y,
      },
    },
    allowedTransitions: ['cut'],
    defaultTransition: 'cut',
    interruptible: true,
  },
  pan: {
    label: 'Pan',
    category: 'moving',
    source: 'currentOrSelected',
    transform: {
      kind: 'animatedPan',
      overscan: 1.3,
      direction: 'left', // overridden via params.direction
      durationMs: 6000,
      easing: 'linear',
    },
    allowedTransitions: ['cut', 'fade'],
    defaultTransition: 'cut',
    interruptible: true,
    paramOptions: { direction: ['left', 'right', 'up', 'down'] },
  },

  // ───────── MOVING (physical — human operator, no transform) ─────────
  dolly: {
    label: 'Dolly',
    category: 'physical',
    source: ['side'],
    // Optional reverse digital zoom → dolly-zoom ("vertigo") effect.
    // Set params.vertigo = true on the command to enable.
    transform: {
      landscape: {
        kind: 'animatedZoom',
        from: 1.3,
        to: 1.0,
        durationMs: 5000,
        easing: 'ease-in-out',
        originX: 50,
        originY: 40,
        optional: true,
      },
      portrait: {
        kind: 'animatedZoom',
        from: PORTRAIT_DOLLY_FROM,
        to: PORTRAIT_DOLLY_TO,
        durationMs: 5000,
        easing: 'ease-in-out',
        originX: PORTRAIT_DOLLY_ORIGIN_X,
        originY: PORTRAIT_DOLLY_ORIGIN_Y,
        optional: true,
      },
    },
    allowedTransitions: ['cut'],
    defaultTransition: 'cut',
  },
  follow: {
    label: 'Follow',
    category: 'physical',
    source: ['main', 'side'],
    transform: null,
    allowedTransitions: ['cut', 'fade'],
    defaultTransition: 'fade',
  },

  // ───────── SEQUENCER ─────────
  staccato: {
    label: 'Staccato',
    category: 'sequence',
    source: 'multi',
    transform: {
      kind: 'hardCutSequence',
      intervalMs: 500, // Layer 2: replace with beat interval from aubio
      pool: ['wide', 'closeUp', 'bRoll'],
    },
    allowedTransitions: ['cut'], // hard cuts only, in and out
    defaultTransition: 'cut',
    exclusive: true, // suspends auto-rotate + other commands while running
  },
};

// ─── Transition rules engine ─────────────────────────────────
// The director never chooses a transition directly. Given the shot
// being left and the shot being entered, this resolves the only
// legal transition. Rule: a transition must be allowed by BOTH sides;
// 'cut' is always the safe intersection.
export function resolveTransition(fromShotKey, toShotKey) {
  const from = SHOT_TYPES[fromShotKey];
  const to = SHOT_TYPES[toShotKey];
  if (!to) return 'cut';

  const fromAllowed = from ? from.allowedTransitions : ['cut', 'fade'];
  const legal = to.allowedTransitions.filter((t) => fromAllowed.includes(t));

  // Prefer the incoming shot's default if it survived the intersection
  if (legal.includes(to.defaultTransition)) return to.defaultTransition;
  return legal[0] || 'cut';
}

// ─── Source resolution ───────────────────────────────────────
// Maps a shot to the desired camera ROLE ('main' | 'wide' | 'close' |
// 'side') given which roles are actually publishing for that slot.
// resolveTargetIdentity (shotCommands.js) turns that role into a
// concrete LiveKit participant identity.
export function resolveSourceRole(shotKey, availableRoles, currentRole = null) {
  const shot = SHOT_TYPES[shotKey];
  if (!shot) return null;

  if (shot.source === 'currentOrSelected') {
    return currentRole && availableRoles.includes(currentRole)
      ? currentRole
      : availableRoles[0] || null;
  }
  if (shot.source === 'multi') return null; // sequencer resolves per-cut

  for (const role of shot.source) {
    if (availableRoles.includes(role)) return role;
  }
  return availableRoles[0] || null;
}

// Nearest static shot for a camera role, used when a direct feed pick
// (as opposed to a shot-console tap) needs a shotKey to build a valid
// SHOT_COMMAND -- picking a specific participant is still "the director
// chose a shot", just one resolved from the feed instead of the console.
// Not from the integration spec verbatim -- inferred from the source
// arrays above, so worth double-checking against real footage rather
// than trusting it blindly.
export const NEAREST_SHOT_FOR_ROLE = {
  main: 'closeUp',
  wide: 'wide',
  close: 'closeUp',
  side: 'bRoll',
};

// Fade duration used app-wide so DirectorView preview and every
// ViewerStage agree on timing.
export const FADE_MS = 350;

// Crossfade duration specifically for camera-to-camera cuts -- the only
// thing FADE_MS actually animates in the live app today (a same-camera
// shot change is an instant crop snap in ShotTransformFrame, not a
// layer crossfade). Kept as its own constant so it can be tuned against
// real footage without dragging along whatever else might reuse FADE_MS.
export const CAMERA_CHANGE_FADE_MS = 250;

export const SHOT_KEYS = Object.keys(SHOT_TYPES);
