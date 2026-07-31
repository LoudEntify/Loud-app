// lib/shotTypes.js
// ─────────────────────────────────────────────────────────────
// Loudentify Shot Grammar — single source of truth.
// Drives: DirectorShotPanel (UI), ShotRenderer (viewer transforms),
// and flywheel logging (technique labels).
//
// PRD: Director Experience | S&I: Real-time media, Observability
// ─────────────────────────────────────────────────────────────

export const SHOT_TYPES = {
  // ───────── STATIC ─────────
  wide: {
    label: 'Wide',
    category: 'static',
    source: ['wide', 'main'], // full-frame main is the wide shot when no wide camfeed exists (L6-4)
    transform: null,
    allowedTransitions: ['cut', 'fade'],
    defaultTransition: 'cut',
  },
  mediumCU: {
    label: 'Medium CU',
    category: 'static',
    source: ['main', 'wide'], // prefer the contestant's own phone, fall back to cropped wide
    transform: { kind: 'crop', scale: 1.25, originX: 50, originY: 30 },
    allowedTransitions: ['cut', 'fade'],
    defaultTransition: 'cut',
  },
  closeUp: {
    label: 'Close Up',
    category: 'static',
    source: ['main'],
    transform: { kind: 'crop', scale: 1.4, originX: 50, originY: 25 },
    allowedTransitions: ['cut', 'fade'],
    defaultTransition: 'cut',
  },
  bRoll: {
    label: 'B-Roll',
    category: 'static',
    source: ['side'],
    transform: { kind: 'crop', scale: 1.2, originX: 50, originY: 60 }, // hands / instrument zone
    allowedTransitions: ['cut', 'fade'],
    defaultTransition: 'fade',
  },

  // ───────── MOVING (digital) ─────────
  zoomIn: {
    label: 'Zoom In',
    category: 'moving',
    source: 'currentOrSelected',
    transform: {
      kind: 'animatedZoom',
      from: 1.0,
      to: 1.4,
      durationMs: 4000,
      easing: 'ease-in-out',
      originX: 50,
      originY: 30,
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
      kind: 'animatedZoom',
      from: 1.4,
      to: 1.0,
      durationMs: 4000,
      easing: 'ease-in-out',
      originX: 50,
      originY: 30,
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
      kind: 'animatedZoom',
      from: 1.3,
      to: 1.0,
      durationMs: 5000,
      easing: 'ease-in-out',
      originX: 50,
      originY: 40,
      optional: true,
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
    defaultTransition: 'cut',
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

export const SHOT_KEYS = Object.keys(SHOT_TYPES);
