// native/src/spike/zoomPlan.js — the framing model of the spike and the
// maths behind every move, platform-free so it can be unit-tested and
// shared by both native sides (each side receives a plan as numbers,
// never as policy).
//
// THE SHOT. The director's framing is a SHOT: a square-aspect window of
// the wide (1x) field of view, `{ zoom, cx, cy }`: the window is 1/zoom
// of the frame per axis, centred at (cx, cy) in frame fractions. 1x
// centred is SHOT_HOME. A zoom to a target sets a new, centred shot; a
// pan moves the shot's centre and measures from the shot's framing; a
// move that would push the window past a frame edge is REFUSED with a
// reason (panPlan returns `refused`), never clamped into a smaller move.
// The crop therefore belongs to the shot: a zoom after a pan releases
// the pan's crop as part of the zoom, nothing stacks or lingers.
//
// REALISATION. A shot is realised per frame source (what the camera is
// actually told, zoomPlan.realise):
//   hardware   one crop region does zoom and pan; deviceZoom is 1 and
//              the crop IS the shot window (the HAL applies it);
//   gpu / cpu  device zoom (CONTROL_ZOOM_RATIO, centred) as high as the
//              shot allows, and a crop of the zoomed frame for the rest:
//              an off-centre window needs a wider device field of view
//              around it, so a pan costs some device zoom and gains the
//              same in crop (the old "pull-back", now implicit);
//   no device zoom at all: the crop does everything, capped at
//              DIGITAL_ZOOM_MAX.
// Every step of a move is the realisation of an intermediate shot, so
// device zoom and crop always change together on the same frame and
// nothing snaps.
//
// Decisions it encodes (docs/DECISIONS.md 2026-10-12, 2026-10-13):
//   - device zoom first; digital crop only when device zoom is
//     unavailable, and then never above DIGITAL_ZOOM_MAX;
//   - a zoom target is capped by the device's quality ceiling (survey.js
//     qualityCeiling: where the sensor crop stops holding 1080p);
//   - a pan is `degree` of the visible frame per command (an artist
//     setting), and a pan at a shot wider than `window` tightens to
//     `window` as part of the move;
//   - zero crop (SHOT_HOME) is the default for every shot.
//
// PRD rows 15, 16, 127. S&I: Real-time media.

import { regionFor } from './region.js';

export const DIGITAL_ZOOM_MAX = 1.2;
export const EASINGS = ['linear', 'ease-in-out', 'ease-out'];
export const FRAME_SOURCES = ['auto', 'hardware', 'gpu', 'cpu'];
export const SHOT_HOME = Object.freeze({ zoom: 1, cx: 0.5, cy: 0.5 });
/**
 * The pan defaults an artist can override per command. `degree` is the
 * fraction of the VISIBLE frame the picture moves (0.08 = eight percent
 * of what the viewer sees, the same apparent move at every zoom);
 * `window` is the tightest framing a pan at 1x tightens to so the window
 * has room to move (0.84 = 1.19x, within the digital cap on phones that
 * have to crop for it).
 */
export const PAN_DEFAULTS = { degree: 0.08, window: 0.84, durationMs: 3000, easing: 'ease-in-out' };
const PAN_DIRECTIONS = ['up', 'down', 'left', 'right'];
const r4 = (v) => +v.toFixed(4);
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function ease(kind, t) {
  const x = clamp(t, 0, 1);
  if (kind === 'ease-in-out') return x < 0.5 ? 2 * x * x : 1 - ((-2 * x + 2) ** 2) / 2;
  if (kind === 'ease-out') return 1 - (1 - x) ** 2;
  return x;
}

// ── the shot ────────────────────────────────────────────────────
/** The shot's window in frame fractions {x, y, w, h} (square: the same fraction on both axes keeps the aspect). */
export function shotWindow({ zoom, cx, cy }) { const w = 1 / zoom; return { x: r4(cx - w / 2), y: r4(cy - w / 2), w: r4(w), h: r4(w) }; }
/** Room left between the shot's window and the frame edge in `direction`, as a frame fraction (negative = already outside). */
export function shotRoom(shot, direction) {
  const w = 1 / shot.zoom;
  if (direction === 'left') return r4(shot.cx - w / 2);
  if (direction === 'right') return r4(1 - (shot.cx + w / 2));
  if (direction === 'up') return r4(shot.cy - w / 2);
  if (direction === 'down') return r4(1 - (shot.cy + w / 2));
  throw new Error(`unknown pan direction ${direction}`);
}
export function sameShot(a, b) { return !!a && !!b && Math.abs(a.zoom - b.zoom) < 1e-4 && Math.abs(a.cx - b.cx) < 1e-4 && Math.abs(a.cy - b.cy) < 1e-4; }

// ── what this camera can do ─────────────────────────────────────
/**
 * The limits a plan is made against, from the B2 profile and the latest
 * camera state. On the hardware frame source the zoom range is the crop
 * region's (1 to SCALER_AVAILABLE_MAX_DIGITAL_ZOOM, reported by the
 * capturer as deviceZoomMin/Max), not CONTROL_ZOOM_RATIO_RANGE.
 */
export function capsFor(profile, state = null) {
  const src = FRAME_SOURCES.includes(state?.frameSource) && state.frameSource !== 'auto' ? state.frameSource : 'cpu';
  const dz = profile?.deviceZoom;
  if (src === 'hardware') {
    const max = Number.isFinite(state?.deviceZoomMax) ? state.deviceZoomMax : (Number.isFinite(dz?.max) ? dz.max : 1);
    // panPath 'gpu': the HAL advertised FREEFORM but re-centres every
    // region (the capturer's start-up probe, docs/DECISIONS.md 2026-10-14),
    // so the region carries only a centred zoom and the GPU crop carries
    // the pan: planned like the gpu source, with the region's zoom range.
    const panPath = state?.panPath === 'gpu' ? 'gpu' : 'region';
    // The sensor the region is cut from, and the content rotation it is turned by (the same numbers the camera was given).
    const lens = (profile?.lenses || []).find((l) => l.id === (state?.cameraId ?? profile?.primaryCameraId)) || (profile?.lenses || [])[0] || null;
    const active = lens?.sensor?.activeArray ?? null;
    const region = active ? { rotation: Number.isFinite(state?.rotation) ? state.rotation : 90, active, maxDigitalZoom: lens?.sensor?.maxDigitalZoom ?? 4 } : null;
    return { frameSource: src, panPath, region, deviceZoom: { available: max > 1.0001, min: 1, max }, digitalMax: DIGITAL_ZOOM_MAX };
  }
  const available = Boolean(dz?.available) && Number.isFinite(dz.max) && dz.max > (dz.min ?? 1) && dz.max > 1.0001;
  return { frameSource: src, panPath: 'crop', deviceZoom: available ? { available: true, min: dz.min ?? 1, max: dz.max } : { available: false, min: 1, max: 1 }, digitalMax: DIGITAL_ZOOM_MAX };
}

/** True when one HAL crop region carries both the zoom and the pan (the hardware source with a HAL that honours an off-centre region). */
export function regionCarriesPan(caps) { return caps?.frameSource === 'hardware' && caps?.panPath !== 'gpu'; }

/** Decide how a zoom target will be reached on this device and where it lands: the device range, then the quality ceiling, then the digital cap. */
export function chooseZoomMode(profile, target, caps = capsFor(profile)) {
  const dev = caps.deviceZoom;
  const ceiling = profile?.qualityCeiling;
  const ceilingZoom = Number.isFinite(ceiling?.zoom) && ceiling.zoom >= 1 ? ceiling.zoom : null;
  if (dev.available) {
    let top = dev.max; let why = `device range ${dev.min}-${dev.max}`;
    if (ceilingZoom != null && ceilingZoom < top) { top = ceilingZoom; why = `quality ceiling ${ceilingZoom}x: ${ceiling.reason || 'sensor crop would drop below 1080p'}`; }
    const clamped = clamp(target, dev.min, top);
    return { mode: caps.frameSource === 'hardware' ? 'region' : 'device', target: clamped, clamped: clamped !== target, reason: clamped !== target ? why : null };
  }
  const top = ceilingZoom != null ? Math.min(DIGITAL_ZOOM_MAX, ceilingZoom) : DIGITAL_ZOOM_MAX;
  const clamped = clamp(target, 1, top);
  const why = !profile?.deviceZoom ? 'no capability profile' : !profile.deviceZoom.available ? (profile.deviceZoom.reason || 'device zoom unavailable') : 'device zoom range is fixed';
  return { mode: 'digital', target: clamped, clamped: clamped !== target, reason: clamped !== target ? `${why}; digital capped at ${top}x` : why };
}

// ── realisation ─────────────────────────────────────────────────
/**
 * What the camera is told for one shot on this frame source:
 * `{ mode, deviceZoom, crop, digitalFactor }` with `crop` a window of the
 * frame the source delivers ({x, y, w, h} fractions) and `digitalFactor`
 * how much of the shot's zoom the crop supplies. `mode` names the
 * realisation for the result record: region | device | device+crop |
 * digital.
 */
export function realise(shot, caps) {
  const win = shotWindow(shot);
  if (regionCarriesPan(caps)) return { mode: 'region', deviceZoom: 1, crop: win, digitalFactor: r4(shot.zoom) };
  const hybrid = caps.frameSource === 'hardware';   // region (centred) for the zoom, GPU crop for the pan
  const dev = caps.deviceZoom;
  const off = Math.max(Math.abs(shot.cx - 0.5), Math.abs(shot.cy - 0.5));
  // The largest centred device field of view that still contains the window.
  const d = dev.available ? clamp(1 / (win.w + 2 * off), dev.min, dev.max) : 1;
  const origin = 0.5 - 1 / (2 * d);          // the zoomed frame's top-left corner, in wide-frame fractions
  const cw = Math.min(1, r4(win.w * d));
  const x = clamp(r4((win.x - origin) * d), 0, 1 - cw); const y = clamp(r4((win.y - origin) * d), 0, 1 - cw);
  const digitalFactor = r4(1 / cw);
  const mode = !dev.available ? 'digital' : digitalFactor > 1.001 ? (hybrid ? 'region+crop' : 'device+crop') : (hybrid ? 'region' : 'device');
  return { mode, deviceZoom: r4(d), crop: { x, y, w: cw, h: cw }, digitalFactor };
}

/** Why a shot cannot be realised on this frame source, or null. */
export function unrealisable(shot, caps) {
  const r = realise(shot, caps);
  if (caps.frameSource === 'hardware' && shot.zoom > caps.deviceZoom.max + 1e-6) return `crop region cannot go past ${caps.deviceZoom.max}x on this camera`;
  if (!regionCarriesPan(caps) && r.digitalFactor > caps.digitalMax + 1e-6) {
    return caps.deviceZoom.available
      ? `off-centre framing needs a ${r.digitalFactor}x crop of the device-zoomed frame, past the ${caps.digitalMax}x cap (${caps.frameSource === 'hardware' ? 'this HAL re-centres crop regions, so a pan is a crop of the zoomed frame' : 'device zoom is always centred on this frame source'})`
      : `digital crop ${r.digitalFactor}x is past the ${caps.digitalMax}x cap and this camera has no device zoom`;
  }
  return null;
}

/**
 * The per-step plan of a move from one shot to another over `durationMs`,
 * sampled every `stepMs`: each step is the realisation of the eased
 * intermediate shot (zoom eased in log space so 1x->2x feels as even as
 * 2x->4x, the centre linearly). Steps are what the native side applies,
 * `shots` the framing each step stands for (so a cancelled move knows
 * where it stopped).
 */
export function movePlan({ from, to, durationMs, easing = 'ease-in-out', stepMs = 1000 / 30, caps }) {
  const n = Math.max(1, Math.round(durationMs / stepMs));
  const lf = Math.log(from.zoom); const lt = Math.log(to.zoom);
  const steps = []; const shots = [];
  for (let i = 1; i <= n; i += 1) {
    const t = ease(easing, i / n);
    const shot = { zoom: r4(Math.exp(lerp(lf, lt, t))), cx: r4(lerp(from.cx, to.cx, t)), cy: r4(lerp(from.cy, to.cy, t)) };
    const r = realise(shot, caps);
    shots.push(shot);
    const step = { atMs: Math.round((i / n) * durationMs), deviceZoom: r.deviceZoom, crop: [r.crop.x, r.crop.y, r.crop.w, r.crop.h] };
    // On the hardware path with one region carrying the pan, the step also names the sensor region itself (region.js), so the phone applies it as given.
    if (regionCarriesPan(caps) && caps.region) step.region = regionFor({ crop: r.crop, rotation: caps.region.rotation, active: caps.region.active, maxDigitalZoom: caps.region.maxDigitalZoom }).rect;
    steps.push(step);
  }
  return { steps, shots };
}

// ── the two commands ────────────────────────────────────────────
/** A zoom: a new centred shot at the (clamped) target, reached from the current shot. */
export function zoomPlan({ profile, caps = capsFor(profile), shot = SHOT_HOME, target, durationMs = 2000, easing = 'ease-in-out', stepMs = 1000 / 30 }) {
  const choice = chooseZoomMode(profile, target, caps);
  const to = { zoom: r4(choice.target), cx: 0.5, cy: 0.5 };
  const { steps, shots } = movePlan({ from: shot, to, durationMs, easing, stepMs, caps });
  const realised = realise(to, caps);
  return { ...choice, mode: realised.mode, from: shot, to, releasesCrop: Math.abs(shot.cx - 0.5) > 1e-4 || Math.abs(shot.cy - 0.5) > 1e-4, realised, steps, shots };
}

/**
 * A pan: the shot's window moves `degree` of the visible frame in
 * `direction` over `durationMs`. A shot wider than `window` (1x, say)
 * first tightens to `window` so there is room to move; the tightening
 * is part of the same eased move, not a snap before it. Refused (no
 * steps, `refused: true`, the reason in `reason`) when the window would
 * hit a frame edge or this frame source cannot realise the end framing;
 * `travelRequested` says what was asked, `room` what was there.
 */
export function panPlan({
  direction, degree = PAN_DEFAULTS.degree, window = PAN_DEFAULTS.window, durationMs = PAN_DEFAULTS.durationMs, easing = PAN_DEFAULTS.easing,
  stepMs = 1000 / 30, shot = SHOT_HOME, caps,
}) {
  if (!PAN_DIRECTIONS.includes(direction)) throw new Error(`unknown pan direction ${direction}`);
  if (!caps) throw new Error('panPlan needs caps (zoomPlan.capsFor)');
  const w0 = clamp(window, 0.2, 0.98);
  const zoom = r4(Math.max(shot.zoom, 1 / w0));
  const tightened = zoom > shot.zoom + 1e-6;
  const start = { zoom, cx: shot.cx, cy: shot.cy };   // the framing the pan measures from: the shot, tightened if it had to be
  const w = r4(1 / zoom);
  const travel = r4(clamp(degree, 0, 1) * w);
  const room = shotRoom(start, direction);
  const to = {
    zoom,
    cx: r4(start.cx + (direction === 'right' ? travel : direction === 'left' ? -travel : 0)),
    cy: r4(start.cy + (direction === 'down' ? travel : direction === 'up' ? -travel : 0)),
  };
  const base = { path: tightened ? 'tighten-pan' : 'pan', from: shot, window: w, zoom, tightened, travelRequested: travel, room, direction };
  if (travel > room + 1e-4) {
    return { ...base, refused: true, reason: `at frame edge: ${direction} has ${Math.max(0, room)} of the frame left and this pan needs ${travel}`, to: null, travel: 0, mode: null, steps: [], shots: [] };
  }
  const why = unrealisable(to, caps);
  if (why) return { ...base, refused: true, reason: why, to: null, travel: 0, mode: null, steps: [], shots: [] };
  const { steps, shots } = movePlan({ from: shot, to, durationMs, easing, stepMs, caps });
  return { ...base, refused: false, reason: null, to, travel, mode: realise(to, caps).mode, realised: realise(to, caps), steps, shots };
}

/** Target framing as a fraction of the Wide reference's field of view (B5 intent). */
export function tightnessFor(zoom, wideReferenceZoom = 1) { return +(wideReferenceZoom / zoom).toFixed(4); }
