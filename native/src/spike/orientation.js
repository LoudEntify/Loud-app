// native/src/spike/orientation.js — the show's orientation, platform-free.
//
// The artist chooses Portrait or Landscape per show on the main device
// before going live (docs/DECISIONS.md 2026-10-14). The choice goes to
// every camera over the command channel, is stored with the show, and is
// LOCKED for the show. Each camera publishes an upright frame in that
// orientation (1080x1920 or 1920x1080) computed from its sensor
// orientation and the choice only: device rotation, the gravity sensor
// and the SurfaceTexture transform never re-orient the picture mid-show.
//
// Gravity is read ONCE per camera at setup (the Kit Check; in the spike,
// when the orientation is set and when the camera starts), to warn when a
// phone is mounted the other way from the choice, with a one-line fix.
// This module classifies that one reading and words the warning; the
// native side (LoudCameraXCapturer.gravityCheck) supplies the vector.
//
// PRD rows 12, 15. S&I: Real-time media.

export const ORIENTATIONS = ['portrait', 'landscape'];
export const DEFAULT_ORIENTATION = 'portrait';

export function normaliseOrientation(o) { return o === 'landscape' ? 'landscape' : 'portrait'; }

/** The published frame's size for an orientation (1080p long edge). */
export function frameSizeFor(o, longEdge = 1920, shortEdge = 1080) {
  return normaliseOrientation(o) === 'landscape' ? { width: longEdge, height: shortEdge } : { width: shortEdge, height: longEdge };
}

/** Quarter-turn of an angle (any integer degrees) as 0 | 90 | 180 | 270. */
export function quarterTurn(deg) {
  const d = Number(deg);
  if (!Number.isFinite(d)) return 0;
  return ((Math.round(d / 90) * 90) % 360 + 360) % 360;
}

/**
 * The content rotation (degrees clockwise) that makes the sensor's frame
 * upright in the chosen orientation. Portrait is the sensor orientation
 * itself (90 on the Moto G35: the sensor is landscape, the phone upright);
 * landscape is that less a quarter turn (0 on the G35: the phone on its
 * side). This is the ONLY place the mapping is written: the capturer is
 * handed the number, it does not derive its own.
 */
export function uprightRotation(orientation, sensorOrientation = 90) {
  const s = quarterTurn(sensorOrientation);
  return normaliseOrientation(orientation) === 'landscape' ? (s + 270) % 360 : s;
}

/**
 * Which of the two mounts of the chosen orientation the phone is in, from one
 * physical reading (physicalOrientation). Each orientation has two mounts a
 * half turn apart: portrait upright (the base) or upside down, landscape with
 * the top to the left (the base) or to the right. The base is the one the
 * sensor rotation gives; the other is the base plus 180. A flat phone, an
 * unreadable reading or a phone in the other orientation (a mismatch, which
 * is sideways either way) has no 180 decision: `known` is false and the
 * plan keeps the base.
 *
 * Read on the G35 on 15 Oct: landscape with the top to the right (physical
 * landscape-right) came out upside down at the base, so landscape-right is the
 * inverted landscape mount.
 */
export function mountOf(orientation, physical) {
  const o = normaliseOrientation(orientation);
  const p = physical || 'unknown';
  const format = physicalFormat(p);
  if (!format || format !== o) return { physical: p, known: false, inverted: false };
  const inverted = o === 'portrait' ? p === 'portrait-down' : p === 'landscape-right';
  return { physical: p, known: true, inverted };
}

/**
 * Everything the camera is told for one orientation: the content rotation
 * (the sensor rotation, half a turn more for the inverted mount), the mount
 * it was chosen for, and the frame size that rotation produces (portrait
 * 1080x1920, landscape 1920x1080). The swap of width and height follows the
 * rotation, so a picture is never published at the wrong shape.
 */
export function orientationPlan({ orientation, sensorOrientation = 90, physical } = {}) {
  const o = normaliseOrientation(orientation);
  const mount = mountOf(o, physical);
  const desiredRotation = (uprightRotation(o, sensorOrientation) + (mount.inverted ? 180 : 0)) % 360;
  const { width, height } = frameSizeFor(o);
  return { orientation: o, sensorOrientation: quarterTurn(sensorOrientation), mount, desiredRotation, width, height };
}

/**
 * The setup-time decision about the plan, from each new reading. Before the
 * lock, the plan follows the mount: a change of mount (inverted or not) is
 * applied after two equal readings in a row, so one jolt does not flip the
 * picture; a flat or unknown reading never changes it. After the lock
 * (`locked`) nothing changes. Returns { apply, pending, inverted }.
 */
export function nextMountPlan({ planInverted, reading, pending = null, locked = false }) {
  if (locked || !reading || !reading.known) return { apply: false, pending: null, inverted: planInverted };
  if (reading.inverted === planInverted) return { apply: false, pending: null, inverted: planInverted };
  if (pending !== reading.inverted) return { apply: false, pending: reading.inverted, inverted: planInverted };
  return { apply: true, pending: null, inverted: reading.inverted };
}

/**
 * The texture correction still needed after the camera pipeline has
 * already rotated the texture by `builtInRotation` (the turn the picture
 * shows, measured on the first frame by the capturer; the preview target is
 * pinned, so it does not change with the device). Applying the correction
 * on top of the built-in rotation gives `desiredRotation` again:
 * builtIn + correction ≡ desired (mod 360).
 *
 * A MIRRORED texture transform (negative determinant: the vertical flip
 * camera textures usually carry) turns a correction the opposite way on
 * screen, so there the correction is builtIn − desired. Measured on the
 * Moto G35 (19 Oct): mirrored, built-in 90 (raw reading 270), so portrait
 * (desired 90) needs 0 and landscape (desired 0) needs 90; the unmirrored
 * sum gave portrait 180, the upside-down picture.
 */
export function textureCorrection(desiredRotation, builtInRotation = 0, mirrored = false) {
  const d = quarterTurn(desiredRotation); const b = quarterTurn(builtInRotation);
  const c = mirrored ? b - d : d - b;
  return ((c % 360) + 360) % 360;
}

/** The turn a texture shows, from the raw angle its transform sends the x axis to: the opposite turn when mirrored. */
export function builtInRotationShown(measured, mirrored = false) {
  const m = quarterTurn(measured);
  return mirrored ? (360 - m) % 360 : m;
}

/**
 * Which way the phone is physically held, from one gravity reading in
 * Android's device frame (x along the short edge, positive to the right;
 * y along the long edge, positive to the top; z out of the screen), in
 * m/s². Returns 'portrait' (top up), 'portrait-down', 'landscape-left'
 * (top of the phone to the left), 'landscape-right', 'flat' (screen up
 * or down: the camera points at the ceiling or the floor) or 'unknown'
 * (no reading).
 */
export function physicalOrientation(g, { flatMs2 = 7.5 } = {}) {
  const x = Number(g?.x); const y = Number(g?.y); const z = Number(g?.z);
  if (![x, y, z].every(Number.isFinite)) return 'unknown';
  if (Math.hypot(x, y, z) < 1) return 'unknown';
  if (Math.abs(z) > flatMs2 && Math.hypot(x, y) < 4.5) return 'flat';
  if (Math.abs(y) >= Math.abs(x)) return y > 0 ? 'portrait' : 'portrait-down';
  return x > 0 ? 'landscape-left' : 'landscape-right';
}

/** 'portrait' | 'landscape' | null for a physical reading ('flat' and 'unknown' give null). */
export function physicalFormat(physical) {
  if (physical === 'portrait' || physical === 'portrait-down') return 'portrait';
  if (physical === 'landscape-left' || physical === 'landscape-right') return 'landscape';
  return null;
}

/**
 * The setup warning: does the way the phone is mounted contradict the
 * show's orientation? `{ chosen, physical, mismatch, warning, fix }`;
 * `warning` and `fix` are null when the mount agrees or the reading says
 * nothing. A flat phone is not a mismatch but gets its own one-liner.
 */
export function orientationMismatch(chosen, physical) {
  const c = normaliseOrientation(chosen);
  const p = physical || 'unknown';
  const format = physicalFormat(p);
  if (p === 'flat') return { chosen: c, physical: p, mismatch: false, warning: 'this phone is lying flat (the camera points at the ceiling or the floor), so the mount check could not tell its orientation', fix: 'stand it up where it will film from and check again' };
  if (!format) return { chosen: c, physical: p, mismatch: false, warning: null, fix: null };
  if (format === c) return { chosen: c, physical: p, mismatch: false, warning: null, fix: null };
  return {
    chosen: c, physical: p, mismatch: true,
    warning: `this phone is mounted ${format} but the show is ${c}: viewers would see its picture turned on its side`,
    fix: c === 'portrait' ? 'stand the phone up tall, or set the show to Landscape before going live' : 'turn the phone on its side, or set the show to Portrait before going live',
  };
}

/** One line for logs and the report: the chosen orientation, the fixed rotation applied and the mount check. */
export function orientationLine(o) {
  if (!o) return 'orientation: not set';
  const base = `orientation ${o.orientation ?? o.chosen ?? '?'} (${o.width ?? '?'}×${o.height ?? '?'}, sensor ${o.sensorOrientation ?? '?'}°, rotation ${o.rotation ?? '?'}°)`;
  const mount = o.physical ? ` · mounted ${o.physical}${o.mismatch ? ` MISMATCH: ${o.warning}. Fix: ${o.fix}` : ''}` : '';
  return base + mount;
}
