// native/src/spike/proMode.js — pro mode (manual camera control), the
// platform-free part: what a lens supports and why not, how a requested
// value is clamped, the Kelvin <-> colour-gain mapping Camera2 needs
// (it has no Kelvin API), the frame-rate warnings, and the arithmetic
// behind "Match cameras". Shared by the phone and the laptop controller;
// unit-tested in tests/spike-pro.test.mjs.
//
// Units on the wire (docs/SPIKE_PRO_MODE_PLAN.md): ISO as a number,
// shutter in milliseconds, white balance in Kelvin, focus in diopters
// (0 = infinity), exposure compensation in stops.
//
// PRD rows 15, 16, 127. S&I: Real-time media.

export const PRO_CONTROLS = ['iso', 'shutter', 'wb', 'focus', 'ev', 'lock', 'unlock', 'enable', 'disable'];
export const LOCKS = ['ae', 'awb', 'af'];
export const KELVIN_RANGE = [2000, 10000];
export const STAGES = ['A', 'B'];

const r = (v, d = 3) => +Number(v).toFixed(d);
const num = (v) => (Number.isFinite(v) ? v : null);
const log2 = (v) => Math.log(v) / Math.LN2;

// ── capability → support ─────────────────────────────────────────
/**
 * From a lens's B2 `pro` block, what each control can do on this camera:
 * { iso, shutter, wb, focus, ev, lockAe, lockAwb, lockAf }, each
 * { supported, reason, min, max, step? }. The reasons are the one line the
 * controller shows next to a greyed control.
 */
export function proSupport(pro) {
  const p = pro || {};
  const level = p.hardwareLevel || 'unknown';
  const manualSensor = Boolean(p.manualSensor);
  const manualPost = Boolean(p.manualPostProcessing);
  const iso = p.isoRange && num(p.isoRange[0]) != null && num(p.isoRange[1]) != null ? p.isoRange : null;
  const sh = p.shutterNsRange && num(p.shutterNsRange[0]) != null && num(p.shutterNsRange[1]) != null ? p.shutterNsRange : null;
  const ev = p.evRange && num(p.evRange[0]) != null && num(p.evRange[1]) != null ? p.evRange : null;
  const evStep = num(p.evStep) || 0;
  const minDiopters = num(p.focus?.minDiopters);
  const afOff = Array.isArray(p.focus?.afModes) ? p.focus.afModes.includes('off') : false;
  const awbOff = Array.isArray(p.awbModes) ? p.awbModes.includes('off') : false;
  const aeOff = Array.isArray(p.aeModes) ? p.aeModes.includes('off') : false;
  const noManual = !manualSensor ? `no MANUAL_SENSOR capability (hardware level ${level})` : !aeOff ? 'AE mode OFF is not offered' : null;
  return {
    hardwareLevel: level,
    iso: noManual || !iso ? { supported: false, reason: noManual || 'no sensitivity range reported', min: null, max: null }
      : { supported: true, reason: null, min: iso[0], max: iso[1] },
    shutter: noManual || !sh ? { supported: false, reason: noManual || 'no exposure time range reported', min: null, max: null }
      : { supported: true, reason: null, min: r(sh[0] / 1e6, 4), max: r(sh[1] / 1e6, 2) },
    wb: !manualPost ? { supported: false, reason: `no MANUAL_POST_PROCESSING capability (hardware level ${level}): the HAL will not take colour gains`, min: null, max: null }
      : !awbOff ? { supported: false, reason: 'AWB mode OFF is not offered', min: null, max: null }
        : { supported: true, reason: null, min: KELVIN_RANGE[0], max: KELVIN_RANGE[1] },
    focus: minDiopters == null ? { supported: false, reason: 'no minimum focus distance reported', min: null, max: null }
      : minDiopters <= 0 ? { supported: false, reason: 'fixed-focus lens', min: null, max: null }
        : !afOff ? { supported: false, reason: 'AF mode OFF is not offered', min: null, max: null }
          : { supported: true, reason: null, min: 0, max: minDiopters, calibration: p.focus?.calibration || 'uncalibrated' },
    ev: !ev || (ev[0] === 0 && ev[1] === 0) || evStep <= 0 ? { supported: false, reason: 'exposure compensation range is empty', min: null, max: null }
      : { supported: true, reason: null, min: r(ev[0] * evStep, 2), max: r(ev[1] * evStep, 2), step: r(evStep, 3) },
    lockAe: p.aeLockAvailable ? { supported: true, reason: null } : { supported: false, reason: 'AE lock is not available on this camera' },
    lockAwb: p.awbLockAvailable ? { supported: true, reason: null } : { supported: false, reason: 'AWB lock is not available on this camera' },
    lockAf: minDiopters != null && minDiopters > 0 && afOff ? { supported: true, reason: null } : { supported: false, reason: 'AF lock needs manual focus (AF mode OFF), which this lens does not offer' },
  };
}

/** Which of the eight controls a lock/unlock command maps to. */
function lockKey(value) { return value === 'ae' ? 'lockAe' : value === 'awb' ? 'lockAwb' : value === 'af' ? 'lockAf' : null; }

/**
 * Clamp a requested value to what the lens supports:
 * { value, clamped, supported, reason }. `value` is null when unsupported.
 */
export function clampPro(control, value, pro) {
  const s = proSupport(pro);
  if (control === 'enable' || control === 'disable') return { value: null, clamped: false, supported: true, reason: null };
  if (control === 'lock' || control === 'unlock') {
    const k = lockKey(value);
    if (!k) return { value: null, clamped: false, supported: false, reason: `unknown lock ${value}; one of ${LOCKS.join(', ')}` };
    return { value, clamped: false, supported: s[k].supported, reason: s[k].reason };
  }
  const c = s[control];
  if (!c) return { value: null, clamped: false, supported: false, reason: `unknown control ${control}; one of ${PRO_CONTROLS.join(', ')}` };
  if (!c.supported) return { value: null, clamped: false, supported: false, reason: c.reason };
  const v = Number(value);
  if (!Number.isFinite(v)) return { value: null, clamped: false, supported: true, reason: `${control} needs a number` };
  let out = v;
  if (control === 'ev' && c.step) out = Math.round(out / c.step) * c.step;
  out = Math.min(c.max, Math.max(c.min, out));
  if (control === 'iso') out = Math.round(out);
  out = r(out, control === 'shutter' ? 4 : 3);
  const clamped = Math.abs(out - v) > (control === 'ev' ? c.step / 2 + 1e-9 : 1e-6);
  return { value: out, clamped, supported: true, reason: clamped ? `${control} ${v} is outside ${c.min}–${c.max}; using ${out}` : null };
}

// ── Kelvin <-> colour gains ──────────────────────────────────────
/**
 * Colour temperature → the RGB colour of a black body at that
 * temperature (Tanner Helland's fit of the Planckian locus, 1000–40000 K,
 * 0–255 per channel). Good to a few percent, which is what a "set it to
 * 5600 K" control needs; a calibrated pipeline would use the sensor's
 * own calibration matrices (SENSOR_CALIBRATION_TRANSFORM1/2), later.
 */
export function kelvinToRgb(kelvin) {
  const t = Math.min(40000, Math.max(1000, kelvin)) / 100;
  const clamp = (v) => Math.min(255, Math.max(0, v));
  const red = t <= 66 ? 255 : clamp(329.698727446 * ((t - 60) ** -0.1332047592));
  const green = t <= 66 ? clamp(99.4708025861 * Math.log(t) - 161.1195681661) : clamp(288.1221695283 * ((t - 60) ** -0.0755148492));
  const blue = t >= 66 ? 255 : t <= 19 ? 0 : clamp(138.5177312231 * Math.log(t - 10) - 305.0447927307);
  return { r: red, g: green, b: blue };
}

/**
 * The white-balance gains that make a scene lit at `kelvin` look neutral:
 * the inverse of the illuminant's colour, normalised to green = 1
 * (Camera2 COLOR_CORRECTION_GAINS order: R, G_even, G_odd, B).
 */
export function kelvinToGains(kelvin) {
  const c = kelvinToRgb(kelvin);
  const g = c.g || 1;
  const gain = (ch) => r(g / Math.max(ch, 1), 4);
  return { r: gain(c.r), gEven: 1, gOdd: 1, b: gain(c.b) };
}

/** The Kelvin whose gains best match the ones the HAL reports (search on the red/blue ratio, 2000–10000 K in 25 K steps). */
export function gainsToKelvin(gains) {
  const gr = num(gains?.r); const gb = num(gains?.b);
  if (gr == null || gb == null || gr <= 0 || gb <= 0) return null;
  const want = gr / gb;
  let best = null; let bestErr = Infinity;
  for (let k = KELVIN_RANGE[0]; k <= KELVIN_RANGE[1]; k += 25) {
    const g = kelvinToGains(k);
    const err = Math.abs(Math.log(g.r / g.b) - Math.log(want));
    if (err < bestErr) { bestErr = err; best = k; }
  }
  return best;
}

// ── warnings ─────────────────────────────────────────────────────
/**
 * One-line warnings for a control about to be applied on this lens at
 * this frame rate; empty when there is nothing to say.
 */
export function proWarnings(control, value, { fps = 30, pro } = {}) {
  const out = [];
  const s = proSupport(pro);
  const v = Number(value);
  if (control === 'shutter' && Number.isFinite(v) && fps > 0 && v > 1000 / fps + 0.05) {
    out.push(`a ${v} ms shutter is longer than one frame at ${fps} fps: the frame rate will drop to about ${Math.max(1, Math.floor(1000 / v))} fps`);
  }
  if (control === 'iso' && Number.isFinite(v) && s.iso.supported && v > s.iso.max / 2) out.push(`ISO ${Math.round(v)} is in the top half of this sensor's range (${s.iso.max}): expect visible grain`);
  if (['iso', 'shutter', 'wb', 'focus'].includes(control) && (s.hardwareLevel === 'legacy' || s.hardwareLevel === 'limited') && !pro?.manualSensor) {
    out.push(`hardware level ${s.hardwareLevel}: manual controls run through a slower path on this device; expect dropped frames`);
  }
  return out;
}

// ── match cameras ────────────────────────────────────────────────
/** The targets a reference camera's state gives: { iso, shutterMs, wbKelvin } (null fields when the reference did not report them). */
export function matchTargets(state) {
  const iso = num(state?.iso);
  const ns = num(state?.exposureNs);
  const kelvin = num(state?.pro?.wbKelvin) ?? (state?.pro?.colorGains ? gainsToKelvin(state.pro.colorGains) : null);
  return { iso: iso != null ? Math.round(iso) : null, shutterMs: ns != null ? r(ns / 1e6, 4) : null, wbKelvin: kelvin };
}

/** How far a camera landed from the match targets, in stops for exposure and Kelvin for colour. */
export function matchResidual(target, achieved) {
  const stops = (a, b) => (num(a) != null && num(b) != null && a > 0 && b > 0 ? r(log2(b / a), 3) : null);
  const isoStops = stops(target?.iso, achieved?.iso);
  const shutterStops = stops(target?.shutterMs, achieved?.shutterMs);
  const wbKelvin = num(target?.wbKelvin) != null && num(achieved?.wbKelvin) != null ? achieved.wbKelvin - target.wbKelvin : null;
  const exposureStops = isoStops != null && shutterStops != null ? r(isoStops + shutterStops, 3) : (isoStops ?? shutterStops);
  return { isoStops, shutterStops, exposureStops, wbKelvin };
}

/** Format a residual for a log line. */
export function residualLine(res) {
  if (!res) return 'no residual';
  const parts = [];
  if (res.exposureStops != null) parts.push(`${res.exposureStops >= 0 ? '+' : ''}${res.exposureStops} stops exposure`);
  if (res.wbKelvin != null) parts.push(`${res.wbKelvin >= 0 ? '+' : ''}${res.wbKelvin} K`);
  return parts.length ? parts.join(', ') : 'exact';
}
