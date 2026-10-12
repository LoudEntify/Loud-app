// native/src/spike/zoomPlan.js — the maths behind a zoom ramp and a pan,
// platform-free so it can be unit-tested and shared by both native sides
// (each side receives the plan as numbers, never as policy).
//
// Decisions it encodes (docs/DECISIONS.md 2026-10-12):
//   - device zoom first; digital crop only when device zoom is unavailable,
//     and then never above DIGITAL_ZOOM_MAX;
//   - a pan is a crop window moving inside the frame, with device zoom
//     pulled BACK by the pan margin first, so the window has room to move
//     without the frame running out of picture;
//   - zero crop is the default for every shot.
//
// PRD rows 15, 16, 127. S&I: Real-time media.

export const DIGITAL_ZOOM_MAX = 1.2;
export const EASINGS = ['linear', 'ease-in-out', 'ease-out'];

/** Decide how a zoom target will be reached on this device. */
export function chooseZoomMode(profile, target) {
  const dev = profile?.deviceZoom;
  const usable = dev && dev.available && dev.max > dev.min && dev.max > 1.0001;
  if (usable) {
    const clamped = Math.min(Math.max(target, dev.min), dev.max);
    return { mode: 'device', target: clamped, clamped: clamped !== target, reason: clamped !== target ? `device range ${dev.min}-${dev.max}` : null };
  }
  const clamped = Math.min(Math.max(target, 1), DIGITAL_ZOOM_MAX);
  const why = !dev ? 'no capability profile' : !dev.available ? (dev.reason || 'device zoom unavailable') : 'device zoom range is fixed';
  return { mode: 'digital', target: clamped, clamped: clamped !== target, reason: clamped !== target ? `${why}; digital capped at ${DIGITAL_ZOOM_MAX}x` : why };
}

export function ease(kind, t) {
  const x = Math.min(1, Math.max(0, t));
  if (kind === 'ease-in-out') return x < 0.5 ? 2 * x * x : 1 - ((-2 * x + 2) ** 2) / 2;
  if (kind === 'ease-out') return 1 - (1 - x) ** 2;
  return x;
}

/**
 * The per-step schedule of a ramp from `from` to `to` over `durationMs`,
 * sampled every `stepMs` (the native side applies one value per step).
 * Zoom is eased in log space so a 1x->2x ramp feels as even as 2x->4x.
 */
export function rampSchedule({ from, to, durationMs, easing = 'ease-in-out', stepMs = 1000 / 30 }) {
  const steps = Math.max(1, Math.round(durationMs / stepMs));
  const out = [];
  const lf = Math.log(from); const lt = Math.log(to);
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    out.push({ atMs: Math.round(t * durationMs), zoom: +Math.exp(lf + (lt - lf) * ease(easing, t)).toFixed(4) });
  }
  return out;
}

/**
 * A pan: the crop window of fraction `window` (of the full frame, per
 * axis) moves by `degree` (0..1 of the free room) in `direction` over
 * `durationMs`. Returns the device-zoom pull-back and the window path.
 * The pull-back is what makes room: at window 0.8 the device zoom is
 * reduced by 1/0.8 so the composed field of view stays what the shot asked for.
 */
export function panPlan({ direction, degree = 0.5, window = 0.85, durationMs, easing = 'ease-in-out', stepMs = 1000 / 30, zoomNow = 1 }) {
  if (!['up', 'down', 'left', 'right'].includes(direction)) throw new Error(`unknown pan direction ${direction}`);
  const w = Math.min(0.98, Math.max(0.5, window));
  const room = 1 - w;                      // free room on the axis, as a fraction of the frame
  const d = Math.min(1, Math.max(0, degree));
  const pullBack = +(zoomNow * w).toFixed(4); // device zoom reduced so the window shows what zoomNow showed
  const start = { x: room / 2, y: room / 2 };
  const end = { ...start };
  const travel = (room / 2) * d;
  if (direction === 'left') end.x = start.x - travel;
  if (direction === 'right') end.x = start.x + travel;
  if (direction === 'up') end.y = start.y - travel;
  if (direction === 'down') end.y = start.y + travel;
  const steps = Math.max(1, Math.round(durationMs / stepMs));
  const path = [];
  for (let i = 1; i <= steps; i += 1) {
    const t = ease(easing, i / steps);
    path.push({ atMs: Math.round((i / steps) * durationMs), x: +(start.x + (end.x - start.x) * t).toFixed(4), y: +(start.y + (end.y - start.y) * t).toFixed(4), w, h: w });
  }
  return { deviceZoom: Math.max(1, pullBack), window: w, path, digitalFactor: +(1 / w).toFixed(4) };
}

/** Target framing as a fraction of the Wide reference's field of view (B5 intent). */
export function tightnessFor(zoom, wideReferenceZoom = 1) { return +(wideReferenceZoom / zoom).toFixed(4); }
