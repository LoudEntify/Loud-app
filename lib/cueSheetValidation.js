// lib/cueSheetValidation.js
// ─────────────────────────────────────────────────────────────
// Cue-Sheet Director, Phase 1 (CD-1). Pure validation/normalization for
// one cue row -- no I/O, so this can run both at write time (the seed
// script, before an insert) and defensively at read time (cueDirector,
// skipping any malformed row a hand-edited SQL insert produced without
// going through the seed script).
//
// Grammar source of truth is lib/shotTypes.js -- a cue's shot_type must
// be a real SHOT_KEYS entry (reject unknowns), and slot_role must be
// one of the roles resolveSourceRole/resolveTargetIdentity already
// resolve against. motion is optional and maps onto the params fields
// ShotRenderer already reads (direction for pan, vertigo for dolly);
// motion.scale is stored/clamped for forward compatibility even though
// no renderer today consumes a scale param -- see the phase-1 plan note
// at the cueDirector call site.
//
// PRD: Cue-Sheet Director Phase 1 (CD-1/CD-2)
// ─────────────────────────────────────────────────────────────

// Explicit .js extension (unlike the rest of this codebase's extensionless
// relative imports) -- this file is also loaded directly by Node's native
// ESM loader from scripts/seedCueSheet.js (not just through Next's
// bundler, which resolves either form fine), and Node's loader requires
// the extension.
import { SHOT_TYPES, SHOT_KEYS } from './shotTypes.js';

// 'broll' is a role a cue may name, alongside the four camera roles.
//
// It was NOT here when b-roll playback shipped, which made an earlier
// claim in DECISIONS.md ("cue sheets can cut to a playing clip") simply
// false: validateCue rejected slot_role 'broll' outright, so such a cue
// could never have existed. Corrected here rather than in prose.
export const SLOT_ROLES = ['main', 'wide', 'close', 'side', 'broll'];
export const FALLBACK_BEHAVIOURS = ['hold_last', 'auto_director', 'default_wide'];
export const MOTION_SCALE_CEILING = 1.2; // matches the portrait crop ceiling already established in shotTypes.js

// Returns { valid: true, cue: <normalized cue> } or { valid: false, reason }.
// Never throws -- a bad row is a validation result, not an exception.
export function validateCue(rawCue) {
  if (!rawCue || typeof rawCue !== 'object') {
    return { valid: false, reason: 'cue is not an object' };
  }

  const { timestamp_ms: timestampMs, shot_type: shotType, slot_role: slotRole, motion } = rawCue;

  if (typeof timestampMs !== 'number' || !Number.isFinite(timestampMs) || timestampMs < 0) {
    return { valid: false, reason: `timestamp_ms must be a non-negative number (got ${JSON.stringify(timestampMs)})` };
  }

  if (!SHOT_KEYS.includes(shotType)) {
    return { valid: false, reason: `shot_type "${shotType}" is not in shotTypes.js's grammar (${SHOT_KEYS.join(', ')})` };
  }

  if (!SLOT_ROLES.includes(slotRole)) {
    return { valid: false, reason: `slot_role "${slotRole}" is not one of ${SLOT_ROLES.join(', ')}` };
  }

  let normalizedMotion;
  // ── clip_id: WHICH clip, for a b-roll cue ─────────────────────
  // Gated to slot_role 'broll' the same way motion.direction is gated to
  // pan: a field that only means something for one shape of cue is a
  // validation error everywhere else, not silently-ignored noise.
  //
  // OPTIONAL, and the two cases differ in kind:
  //   with a clip_id    -> the director STARTS that clip and cuts to it
  //   without a clip_id -> the cue can only cut to a clip that is
  //                        already playing, and falls back otherwise
  // A sheet authored in the editor always sets one; a hand-written row
  // may not, and the second behaviour is the honest reading of it.
  const clipId = rawCue.clip_id;
  if (clipId !== undefined && clipId !== null) {
    if (slotRole !== 'broll') {
      return { valid: false, reason: `clip_id is only valid when slot_role is "broll" (got "${slotRole}")` };
    }
    if (typeof clipId !== 'string' || !clipId.trim()) {
      return { valid: false, reason: 'clip_id must be a non-empty string when present' };
    }
  }

  if (motion != null) {
    if (typeof motion !== 'object') {
      return { valid: false, reason: 'motion must be an object when present' };
    }
    normalizedMotion = {};

    if (motion.direction !== undefined) {
      if (shotType !== 'pan') {
        return { valid: false, reason: `motion.direction is only valid when shot_type is "pan" (got "${shotType}")` };
      }
      const allowedDirections = SHOT_TYPES.pan.paramOptions.direction;
      if (!allowedDirections.includes(motion.direction)) {
        return { valid: false, reason: `motion.direction "${motion.direction}" is not one of ${allowedDirections.join(', ')}` };
      }
      normalizedMotion.direction = motion.direction;
    }

    if (motion.vertigo !== undefined) {
      if (shotType !== 'dolly') {
        return { valid: false, reason: `motion.vertigo is only valid when shot_type is "dolly" (got "${shotType}")` };
      }
      normalizedMotion.vertigo = !!motion.vertigo;
    }

    if (motion.scale !== undefined) {
      if (typeof motion.scale !== 'number' || !Number.isFinite(motion.scale) || motion.scale <= 0) {
        return { valid: false, reason: `motion.scale must be a positive number (got ${JSON.stringify(motion.scale)})` };
      }
      const category = SHOT_TYPES[shotType]?.category;
      if (category !== 'moving' && category !== 'physical') {
        return { valid: false, reason: `motion.scale is only valid on a moving/physical shot_type (got "${shotType}", category "${category}")` };
      }
      // Clamp, don't reject -- an over-eager author asking for 1.5x still
      // gets a usable cue at the ceiling instead of a hard failure.
      normalizedMotion.scale = Math.min(motion.scale, MOTION_SCALE_CEILING);
    }

    if (Object.keys(normalizedMotion).length === 0) normalizedMotion = undefined;
  }

  return {
    valid: true,
    cue: {
      timestamp_ms: timestampMs,
      shot_type: shotType,
      slot_role: slotRole,
      ...(clipId ? { clip_id: String(clipId).trim() } : {}),
      ...(normalizedMotion ? { motion: normalizedMotion } : {}),
    },
  };
}

// Validates a whole cues array. Returns { cues, errors } -- errors carry
// the offending index so a bad row is easy to find in a hand-authored
// sheet; valid cues are sorted ascending by timestamp_ms regardless of
// input order (storage order isn't required to be sorted).
export function validateCueSheet(rawCues) {
  if (!Array.isArray(rawCues)) return { cues: [], errors: ['cues must be an array'] };

  const cues = [];
  const errors = [];
  rawCues.forEach((rawCue, index) => {
    const result = validateCue(rawCue);
    if (result.valid) cues.push(result.cue);
    else errors.push(`cue[${index}]: ${result.reason}`);
  });

  cues.sort((a, b) => a.timestamp_ms - b.timestamp_ms);
  return { cues, errors };
}

export function isValidFallbackBehaviour(value) {
  return FALLBACK_BEHAVIOURS.includes(value);
}
