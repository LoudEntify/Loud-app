// native/src/spike/zoomPlan.js — the maths behind a zoom ramp and a pan,
// platform-free so it can be unit-tested and shared by both native sides
// (each side receives the plan as numbers, never as policy).
//
// Decisions it encodes (docs/DECISIONS.md 2026-10-12):
//   - device zoom first; digital crop only when device zoom is unavailable,
//     and then never above DIGITAL_ZOOM_MAX;
//   - a pan is a crop window moving inside the frame; when the device has
//     zoom headroom the device zoom is pulled BACK while the window
//     closes in on the same frames (no visible jump), otherwise the window
//     eases in as part of the move (see panPlan);
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
 * The pan defaults an artist can override per command. `degree` is the
 * fraction of the free room the window travels (1 = all of it, so the
 * move is clearly visible); `window` is the crop fraction, held at the
 * DIGITAL_ZOOM_MAX cap so a pan never costs more sharpness than a
 * digital zoom may; `leadInMs` is how long the pull-back takes before
 * the window starts to move.
 */
export const PAN_DEFAULTS = { degree: 1, window: 0.84, durationMs: 3000, easing: 'ease-in-out', leadInMs: 700 };
const PAN_DIRECTIONS = ['up', 'down', 'left', 'right'];
const r4 = (v) => +v.toFixed(4);
const lerp = (a, b, t) => a + (b - a) * t;
/** Keep a window of size `w` centred at `c` inside the frame. */
function fit(c, w) { const lo = w / 2; const hi = 1 - w / 2; return { x: Math.min(hi, Math.max(lo, c.x)), y: Math.min(hi, Math.max(lo, c.y)) }; }

/**
 * A pan: the crop window of fraction `window` (of the full frame, per
 * axis) moves by `degree` (0..1 of the free room) in `direction` over
 * `durationMs`, starting from the framing the camera has NOW (`zoomNow`
 * device zoom, `cropNow` window) so nothing jumps when the move begins.
 *
 * The window has to be smaller than the frame to have room to move, and
 * getting it there is where the old plan snapped. Three paths, chosen
 * here and reported in `path` so the result record says which ran:
 *
 *   'pull-back'  the device has zoom headroom: over `leadInMs` the device
 *                zoom ramps OUT and the window ramps IN on the same
 *                frames, device_t = (zoomNow / startW) * w_t, so the
 *                field of view is unchanged until the window starts to
 *                move;
 *   'crop-ease'  no headroom (minimum zoom, no wider lens, or no device
 *                zoom at all): the window eases in WHILE it moves, one
 *                continuous move instead of a snap then a slide;
 *   'pan-only'   the window is already the asked size (a second pan
 *                after a first): it just moves.
 *
 * Every step carries the window and, on the pull-back path, the device
 * zoom for that frame; the native side applies both per step.
 */
export function panPlan({
  direction, degree = PAN_DEFAULTS.degree, window = PAN_DEFAULTS.window, durationMs = PAN_DEFAULTS.durationMs, easing = PAN_DEFAULTS.easing,
  stepMs = 1000 / 30, zoomNow = 1, zoomMin = null, zoomMax = null, cropNow = null, leadInMs = PAN_DEFAULTS.leadInMs,
}) {
  if (!PAN_DIRECTIONS.includes(direction)) throw new Error(`unknown pan direction ${direction}`);
  const w = r4(Math.min(0.98, Math.max(1 / DIGITAL_ZOOM_MAX, window)));
  const d = Math.min(1, Math.max(0, degree));
  const startW = cropNow && cropNow.w > 0 && cropNow.w < 0.999 ? r4(cropNow.w) : 1;
  const start = startW < 1 ? fit({ x: cropNow.x + startW / 2, y: cropNow.y + startW / 2 }, startW) : { x: 0.5, y: 0.5 };
  const room = 1 - w;                          // free room on the axis, as a fraction of the frame
  const travel = (room / 2) * d;
  const end = fit({
    x: start.x + (direction === 'right' ? travel : direction === 'left' ? -travel : 0),
    y: start.y + (direction === 'down' ? travel : direction === 'up' ? -travel : 0),
  }, w);
  const zoom0 = Number.isFinite(zoomNow) && zoomNow > 0 ? zoomNow : 1;
  const deviceEnd = r4(zoom0 * (w / startW));  // what device zoom must become for the field of view to stay put
  const cropChanges = Math.abs(w - startW) > 0.0005;
  const headroom = Number.isFinite(zoomMin) && deviceEnd >= zoomMin - 1e-6 && (!Number.isFinite(zoomMax) || deviceEnd <= zoomMax + 1e-6);
  const path = !cropChanges ? 'pan-only' : headroom ? 'pull-back' : 'crop-ease';
  const lead = path === 'pull-back' ? Math.min(Math.max(0, leadInMs), Math.max(0, durationMs - stepMs)) : 0;
  const n = Math.max(1, Math.round(durationMs / stepMs));
  const steps = [];
  for (let i = 1; i <= n; i += 1) {
    const atMs = Math.round((i / n) * durationMs);
    let wt; let c; let deviceZoom = null;
    if (path === 'pull-back' && atMs <= lead) {
      const t = ease(easing, lead > 0 ? atMs / lead : 1);
      wt = lerp(startW, w, t); c = fit(start, wt); deviceZoom = r4((zoom0 / startW) * wt);
    } else if (path === 'pull-back') {
      const t = ease(easing, (atMs - lead) / (durationMs - lead));
      wt = w; c = { x: lerp(start.x, end.x, t), y: lerp(start.y, end.y, t) };
      if (atMs - lead <= stepMs + 0.5) deviceZoom = deviceEnd; // the first moving step restates the final pull-back, in case the lead-in rounded short
    } else {
      const t = ease(easing, i / n);
      wt = path === 'crop-ease' ? lerp(startW, w, t) : w;
      c = fit({ x: lerp(start.x, end.x, t), y: lerp(start.y, end.y, t) }, wt);
    }
    steps.push({ atMs, deviceZoom, x: r4(c.x - wt / 2), y: r4(c.y - wt / 2), w: r4(wt), h: r4(wt) });
  }
  return {
    path, window: w, digitalFactor: r4(1 / w),
    deviceZoom: path === 'pull-back' ? deviceEnd : null, deviceZoomFrom: r4(zoom0), leadInMs: lead,
    travel: r4(Math.hypot(end.x - start.x, end.y - start.y)), travelRequested: r4(travel),
    from: { x: r4(start.x), y: r4(start.y) }, to: { x: r4(end.x), y: r4(end.y) },
    steps,
  };
}

/** Target framing as a fraction of the Wide reference's field of view (B5 intent). */
export function tightnessFor(zoom, wideReferenceZoom = 1) { return +(wideReferenceZoom / zoom).toFixed(4); }
