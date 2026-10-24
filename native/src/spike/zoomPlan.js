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
// The crop cap is the one exception (2026-10-21): a pan that the cap would
// otherwise refuse goes as far as the cap allows, and the ack says so
// (`capped`), because on centred-zoom cameras the cap left no pan at all.
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
export const PAN_DEFAULTS = { degree: 0.12, window: 0.84, durationMs: 3000, easing: 'ease-in-out' };
/**
 * Pans are a technique for zoomed framings (docs/DECISIONS.md 2026-10-16):
 * below this zoom the 1.2x digital limit leaves a pan too small to see, so a
 * pan at a wider shot is refused with that reason, never made into a near-
 * invisible move. 1.5x is the least zoom at which the default pan is clearly
 * visible on a phone.
 */
export const MIN_PAN_ZOOM = 1.5;
/** The direction a pan names is where the PICTURE moves on screen; the framing (the window) moves the other way. */
const FRAMING_MOVE = { left: 'right', right: 'left', up: 'down', down: 'up' };
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
 * A pan: the PICTURE moves `degree` of the visible frame in `direction` over
 * `durationMs` ('left' moves the picture to the left on screen, so the framing
 * moves right: the same on every orientation and mount, because the window is
 * judged in the display frame, which the sensor region is mapped from). Only
 * on a zoomed shot (MIN_PAN_ZOOM and above): a pan at a wider shot is refused
 * with a reason. Refused (no steps, `refused: true`, the reason in `reason`)
 * when the framing would hit a frame edge or this frame source cannot realise
 * the end framing; `travelRequested` says what was asked, `room` what was there.
 */
export function panPlan({
  direction, degree = PAN_DEFAULTS.degree, window = PAN_DEFAULTS.window, durationMs = PAN_DEFAULTS.durationMs, easing = PAN_DEFAULTS.easing,
  stepMs = 1000 / 30, shot = SHOT_HOME, caps,
}) {
  if (!PAN_DIRECTIONS.includes(direction)) throw new Error(`unknown pan direction ${direction}`);
  if (!caps) throw new Error('panPlan needs caps (zoomPlan.capsFor)');
  if (shot.zoom < MIN_PAN_ZOOM - 1e-6) {
    return {
      path: 'pan', from: shot, window: null, zoom: shot.zoom, tightened: false, travelRequested: 0, room: null, direction,
      refused: true, reason: `panning is for zoomed framings: zoom to ${MIN_PAN_ZOOM}x or more first (at ${shot.zoom}x a pan is too small to see)`,
      to: null, travel: 0, mode: null, steps: [], shots: [],
    };
  }
  const w0 = clamp(window, 0.2, 0.98);
  const zoom = r4(Math.max(shot.zoom, 1 / w0));
  const tightened = zoom > shot.zoom + 1e-6;
  const start = { zoom, cx: shot.cx, cy: shot.cy };   // the framing the pan measures from: the shot, tightened if it had to be
  const w = r4(1 / zoom);
  const travel = r4(clamp(degree, 0, 1) * w);
  const framing = FRAMING_MOVE[direction];           // the way the framing (the window) moves
  const room = shotRoom(start, framing);
  const to = {
    zoom,
    cx: r4(start.cx + (framing === 'right' ? travel : framing === 'left' ? -travel : 0)),
    cy: r4(start.cy + (framing === 'down' ? travel : framing === 'up' ? -travel : 0)),
  };
  const base = { path: tightened ? 'tighten-pan' : 'pan', from: shot, window: w, zoom, tightened, travelRequested: travel, room, direction };
  if (travel > room + 1e-4) {
    return { ...base, refused: true, reason: `at frame edge: the picture cannot move ${direction} any further (${Math.max(0, room)} of the frame left, this pan needs ${travel})`, to: null, travel: 0, mode: null, steps: [], shots: [] };
  }
  const why = unrealisable(to, caps);
  if (why) {
    // The crop cap (docs/DECISIONS.md 2026-10-21): on a frame source where a
    // pan is a crop of the centred, device-zoomed frame, the cap leaves only
    // so much off-centre room. The pan goes as far as the cap allows and the
    // ack says how far and why, instead of refusing the whole move: a pan
    // that moves a little beats one that never moves. Measured on the S25
    // Ultra (20 Oct): at 2x the default 0.12 pan needs a 1.24x crop, so no
    // pan ever ran. Only the cap is relaxed this way; a frame edge still
    // refuses above, because there is nothing to pan into.
    const allowed = cappedTravel({ start, framing, travel, caps });
    if (allowed <= 1e-4) return { ...base, refused: true, reason: why, to: null, travel: 0, mode: null, steps: [], shots: [], capped: true };
    const toCapped = {
      zoom,
      cx: r4(start.cx + (framing === 'right' ? allowed : framing === 'left' ? -allowed : 0)),
      cy: r4(start.cy + (framing === 'down' ? allowed : framing === 'up' ? -allowed : 0)),
    };
    const { steps, shots } = movePlan({ from: shot, to: toCapped, durationMs, easing, stepMs, caps });
    const r = realise(toCapped, caps);
    return { ...base, refused: false, capped: true, reason: `moved ${allowed} of the ${travel} asked: the crop cap (${caps.digitalMax}x of the device-zoomed frame) leaves no more room off centre at ${zoom}x`, to: toCapped, travel: allowed, mode: r.mode, realised: r, steps, shots };
  }
  const { steps, shots } = movePlan({ from: shot, to, durationMs, easing, stepMs, caps });
  return { ...base, refused: false, capped: false, reason: null, to, travel, mode: realise(to, caps).mode, realised: realise(to, caps), steps, shots };
}

/**
 * The largest travel from `start` in the framing direction that the crop
 * cap still realises on this frame source (0 when the start is already at
 * the cap). Found by halving, so it holds for any realisation rule.
 */
export function cappedTravel({ start, framing, travel, caps, iterations = 12 }) {
  const at = (t) => ({
    zoom: start.zoom,
    cx: r4(start.cx + (framing === 'right' ? t : framing === 'left' ? -t : 0)),
    cy: r4(start.cy + (framing === 'down' ? t : framing === 'up' ? -t : 0)),
  });
  if (!unrealisable(at(travel), caps)) return travel;
  let lo = 0; let hi = travel;
  if (unrealisable(at(0), caps)) return 0;
  for (let i = 0; i < iterations; i += 1) {
    const mid = (lo + hi) / 2;
    if (unrealisable(at(mid), caps)) hi = mid; else lo = mid;
  }
  return r4(lo);
}

/** Target framing as a fraction of the Wide reference's field of view (B5 intent). */
export function tightnessFor(zoom, wideReferenceZoom = 1) { return +(wideReferenceZoom / zoom).toFixed(4); }

// ── the bop (docs/DECISIONS.md 2026-10-21) ──────────────────────
/**
 * A BOP is a rhythmic micro-pan with a bounce: on every beat the picture
 * jumps a short way in a direction, overshoots, and settles back home, the
 * way a handheld camera "hits" a beat drop in short-form music video. It
 * is the pan's mechanism (the GPU crop of the device-zoomed frame, every
 * frame) driven by a spring-like curve instead of a smooth ease, plus a
 * small zoom pulse on the hit so it reads as handheld rather than
 * mechanical. Written as a cue first (the artist sets direction, tempo,
 * length and strength); the director learns it from those cues later.
 *
 * Constraints it respects: the same crop cap as a pan (the amplitude is
 * the smaller of the asked amplitude, the room to the frame edge and what
 * the cap allows, cappedTravel), MIN_PAN_ZOOM (a bop at a wide shot is
 * refused like a pan), and the move always ends on the shot it started
 * from, so nothing stacks or lingers.
 */
export const BOP_DEFAULTS = Object.freeze({ bpm: 120, durationMs: 4000, strength: 1, amplitude: 0.08, pulse: 0.03 });
export const BOP_DIRECTIONS = ['left', 'right', 'up', 'down', 'left-right', 'up-down'];
/** Fastest and slowest tempo a bop is planned for (beats outside this are not a bop, they are a pan or a shake). */
export const BOP_BPM_RANGE = Object.freeze({ min: 50, max: 200 });

/**
 * One beat of the bounce, t in [0, 1]: a fast hit to 1 in the first 12
 * percent of the beat (ease-out), then a decaying oscillation through the
 * other side (the overshoot and settle), back to about 0 at the end of the
 * beat so consecutive beats chain cleanly.
 */
export function bopCurve(t) {
  const x = clamp(t, 0, 1);
  const attack = 0.12;
  if (x < attack) { const u = x / attack; return 1 - (1 - u) * (1 - u); }
  const u = (x - attack) / (1 - attack);
  return Math.exp(-4 * u) * Math.cos(Math.PI * 2.5 * u);
}

/** The zoom pulse of one beat: the same hit, decaying without the oscillation (a punch-in on the beat, never a punch-out). */
export function bopPulse(t) {
  const x = clamp(t, 0, 1);
  const attack = 0.12;
  if (x < attack) { const u = x / attack; return 1 - (1 - u) * (1 - u); }
  return Math.exp(-5 * (x - attack) / (1 - attack));
}

/** The picture directions a bop pattern alternates between, beat by beat. */
function bopBeatDirections(direction) {
  if (direction === 'left-right') return ['left', 'right'];
  if (direction === 'up-down') return ['up', 'down'];
  return [direction];
}

/**
 * The plan of a bop from the current shot: steps at `stepMs` for
 * `durationMs`, beats at `bpm`, the picture moving `amplitude` of the
 * visible frame (scaled by `strength`) in `direction` on each beat and
 * bouncing back, with a zoom pulse of `pulse` (also scaled). Refused
 * below MIN_PAN_ZOOM. `capped` says the amplitude was cut by the crop cap
 * or the frame edge, and `amplitudeRequested` / `amplitude` say by how much.
 * The move ends on the start shot (`to` is `shot`).
 */
export function bopPlan({
  direction, bpm = BOP_DEFAULTS.bpm, durationMs = BOP_DEFAULTS.durationMs, strength = BOP_DEFAULTS.strength,
  amplitude = BOP_DEFAULTS.amplitude, pulse = BOP_DEFAULTS.pulse, stepMs = 1000 / 30, shot = SHOT_HOME, caps,
}) {
  if (!BOP_DIRECTIONS.includes(direction)) throw new Error(`unknown bop direction ${direction}`);
  if (!caps) throw new Error('bopPlan needs caps (zoomPlan.capsFor)');
  const tempo = clamp(Number(bpm) || BOP_DEFAULTS.bpm, BOP_BPM_RANGE.min, BOP_BPM_RANGE.max);
  const beatMs = 60000 / tempo;
  const length = clamp(Number(durationMs) || BOP_DEFAULTS.durationMs, beatMs, 60000);
  const s = clamp(Number(strength) || 1, 0.2, 2);
  const base = { path: 'bop', from: shot, direction, bpm: tempo, beatMs: r4(beatMs), durationMs: Math.round(length), strength: s, zoom: shot.zoom };
  if (shot.zoom < MIN_PAN_ZOOM - 1e-6) {
    return { ...base, refused: true, reason: `the bop is for zoomed framings: zoom to ${MIN_PAN_ZOOM}x or more first (at ${shot.zoom}x there is no room to move in)`, amplitudeRequested: 0, amplitude: 0, capped: false, beats: 0, to: null, mode: null, steps: [], shots: [] };
  }
  const w = r4(1 / shot.zoom);
  const asked = r4(clamp(amplitude, 0, 0.3) * s * w);            // in wide-frame fractions, like a pan's travel
  // The amplitude every used direction can reach: the frame edge, then the crop cap (pans and bops share both limits).
  const dirs = bopBeatDirections(direction);
  let amp = asked;
  for (const d of dirs) {
    const framing = FRAMING_MOVE[d];
    amp = Math.min(amp, Math.max(0, shotRoom(shot, framing)));
    amp = Math.min(amp, cappedTravel({ start: shot, framing, travel: amp, caps }));
  }
  // The zoom pulse must stay realisable too (it tightens the window on the hit); scale the pulse down with the amplitude.
  const pulseAmt = clamp(pulse, 0, 0.1) * s;
  const peakZoom = shot.zoom * (1 + pulseAmt);
  const zoomCap = caps.deviceZoom?.available ? caps.deviceZoom.max : shot.zoom;
  const pulseUsed = peakZoom > zoomCap + 1e-6 ? Math.max(0, zoomCap / shot.zoom - 1) : pulseAmt;
  amp = r4(amp * 0.95);                                            // a little inside the limits, because the pulse tightens the window on the hit
  if (amp <= 1e-4) {
    return { ...base, refused: true, reason: `no room for a bop at this framing: the crop cap (${caps.digitalMax}x) and the frame edge leave nothing to move in at ${shot.zoom}x here`, amplitudeRequested: asked, amplitude: 0, capped: true, beats: 0, to: null, mode: null, steps: [], shots: [] };
  }
  const n = Math.max(1, Math.round(length / stepMs));
  const steps = []; const shots = [];
  const beats = Math.max(1, Math.round(length / beatMs));
  for (let i = 1; i <= n; i += 1) {
    const t = i * stepMs;
    const k = Math.min(beats - 1, Math.floor(t / beatMs));
    const tau = (t - k * beatMs) / beatMs;
    const d = dirs[k % dirs.length];
    const framing = FRAMING_MOVE[d];
    const off = amp * bopCurve(tau);
    const z = r4(shot.zoom * (1 + pulseUsed * bopPulse(tau)));
    const sh = {
      zoom: z,
      cx: r4(shot.cx + (framing === 'right' ? off : framing === 'left' ? -off : 0)),
      cy: r4(shot.cy + (framing === 'down' ? off : framing === 'up' ? -off : 0)),
    };
    // If a step is still past a limit (rounding, or the pulse at the hit), pull its offset in rather than drop the frame.
    let fixed = sh;
    for (let tries = 0; tries < 4 && unrealisable(fixed, caps); tries += 1) {
      fixed = { zoom: fixed.zoom, cx: r4(shot.cx + (fixed.cx - shot.cx) * 0.8), cy: r4(shot.cy + (fixed.cy - shot.cy) * 0.8) };
    }
    if (unrealisable(fixed, caps)) fixed = { ...shot };
    const r = realise(fixed, caps);
    shots.push(fixed);
    const step = { atMs: Math.round(t), deviceZoom: r.deviceZoom, crop: [r.crop.x, r.crop.y, r.crop.w, r.crop.h] };
    if (regionCarriesPan(caps) && caps.region) step.region = regionFor({ crop: r.crop, rotation: caps.region.rotation, active: caps.region.active, maxDigitalZoom: caps.region.maxDigitalZoom }).rect;
    steps.push(step);
  }
  // Home at the end, always: the bop leaves the framing where it found it.
  const home = realise(shot, caps);
  const last = { atMs: Math.round(n * stepMs) + Math.round(stepMs), deviceZoom: home.deviceZoom, crop: [home.crop.x, home.crop.y, home.crop.w, home.crop.h] };
  if (regionCarriesPan(caps) && caps.region) last.region = regionFor({ crop: home.crop, rotation: caps.region.rotation, active: caps.region.active, maxDigitalZoom: caps.region.maxDigitalZoom }).rect;
  steps.push(last); shots.push({ ...shot });
  const capped = amp < r4(asked * 0.95) - 1e-4;                      // cut by the cap or the edge, not by the 5 percent margin
  return {
    ...base, refused: false, amplitudeRequested: asked, amplitude: amp, pulse: r4(pulseUsed), capped, beats,
    reason: capped ? `amplitude ${amp} of the ${asked} asked: the crop cap (${caps.digitalMax}x) or the frame edge leaves no more room at ${shot.zoom}x` : null,
    to: { ...shot }, mode: realise(shots[Math.min(shots.length - 1, 1)], caps).mode, steps, shots,
  };
}
