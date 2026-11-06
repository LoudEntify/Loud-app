// native/src/spike/frameRate.js — the frame rate a camera role runs at,
// the platform-free part: which rates this lens can hold, how a request
// is resolved against what the HAL advertises, and what to warn about.
// Shared by the phone and the laptop controller; unit-tested in
// tests/spike-framerate.test.mjs.
//
// Android takes a frame-rate RANGE of whole numbers and only the ranges
// the camera itself advertises (CONTROL_AE_AVAILABLE_TARGET_FPS_RANGES,
// B2 `pro.fpsRanges` as [lo, hi] pairs). A fixed rate is the range
// [f, f]; a request that is not a whole number (24.5) or not advertised
// (28) cannot be set and resolves to the nearest rate that can
// (docs/DECISIONS.md 2026-10-21).
//
// PRD rows 15, 127. S&I: Real-time media.

/** The rates offered in Settings, in the order they are shown. */
export const FRAME_RATE_CHOICES = [24, 25, 30, 60];
export const FRAME_RATE_DEFAULT = 30;

const num = (v) => (Number.isFinite(v) ? v : null);

/** Clean [lo, hi] pairs from whatever the survey carried (null when nothing usable). */
export function cleanRanges(fpsRanges) {
  if (!Array.isArray(fpsRanges)) return [];
  return fpsRanges
    .map((r) => (Array.isArray(r) ? [num(r[0]), num(r[1])] : [num(r?.lower ?? r?.min), num(r?.upper ?? r?.max)]))
    .filter(([lo, hi]) => lo != null && hi != null && lo > 0 && hi >= lo)
    .map(([lo, hi]) => [Math.round(lo), Math.round(hi)]);
}

/**
 * How one rate can be held on this lens:
 * { fps, supported, exact, range, reason }. `exact` when the HAL advertises
 * [f, f]; otherwise the narrowest advertised range that contains f, which
 * the HAL may float inside (a "variable" rate the warning names).
 */
export function frameRateSupport(fps, fpsRanges) {
  const f = Math.round(Number(fps));
  const ranges = cleanRanges(fpsRanges);
  if (!Number.isFinite(f) || f <= 0) return { fps: null, supported: false, exact: false, range: null, reason: 'frame rate needs a positive number' };
  if (!ranges.length) {
    // No survey yet (or a HAL that reports nothing): 30 is what every camera holds; anything else waits for the survey.
    return f === FRAME_RATE_DEFAULT
      ? { fps: f, supported: true, exact: true, range: [f, f], reason: 'no frame-rate ranges reported; 30 fps assumed' }
      : { fps: f, supported: false, exact: false, range: null, reason: 'no frame-rate ranges reported by this camera' };
  }
  if (ranges.some(([lo, hi]) => lo === f && hi === f)) return { fps: f, supported: true, exact: true, range: [f, f], reason: null };
  const containing = ranges.filter(([lo, hi]) => lo <= f && f <= hi).sort((a, b) => (a[1] - a[0]) - (b[1] - b[0]));
  if (containing.length) {
    const [lo, hi] = containing[0];
    return { fps: f, supported: true, exact: false, range: [lo, hi], reason: `this camera offers ${f} fps only inside ${lo}–${hi}: the rate may float with the light` };
  }
  const top = Math.max(...ranges.map(([, hi]) => hi));
  return { fps: f, supported: false, exact: false, range: null, reason: f > top ? `this camera tops out at ${top} fps` : `${f} fps is not among the rates this camera advertises (${ranges.map(([lo, hi]) => (lo === hi ? `${lo}` : `${lo}–${hi}`)).join(', ')})` };
}

/** The Settings list: every choice with its support on this lens. */
export function frameRateOptions(fpsRanges) {
  return FRAME_RATE_CHOICES.map((f) => frameRateSupport(f, fpsRanges));
}

/**
 * Resolve what was asked for to what will be set:
 * { requested, fps, range, exact, changed, reason }. A fractional or
 * unadvertised request lands on the nearest supported choice, ties to
 * the lower rate: 24.5 → 24, 28 → 30, 50 → 60 when both are advertised.
 */
export function resolveFrameRate(requested, fpsRanges) {
  const want = Number(requested);
  if (!Number.isFinite(want) || want <= 0) return resolveFrameRate(FRAME_RATE_DEFAULT, fpsRanges);
  const options = frameRateOptions(fpsRanges).filter((o) => o.supported);
  if (!options.length) return { requested: want, fps: FRAME_RATE_DEFAULT, range: [FRAME_RATE_DEFAULT, FRAME_RATE_DEFAULT], exact: true, changed: want !== FRAME_RATE_DEFAULT, reason: 'no supported rate found; 30 fps assumed' };
  const isWhole = Number.isInteger(want);
  const direct = isWhole ? options.find((o) => o.fps === want) : null;
  if (direct) return { requested: want, fps: direct.fps, range: direct.range, exact: direct.exact, changed: false, reason: direct.reason };
  // nearest supported choice; on a tie the lower rate (it is the one the HAL will hold more surely)
  let best = options[0];
  for (const o of options) {
    const d = Math.abs(o.fps - want); const bd = Math.abs(best.fps - want);
    if (d < bd || (d === bd && o.fps < best.fps)) best = o;
  }
  const why = !isWhole
    ? `Android sets whole-number frame rates only: ${want} fps cannot be set; using ${best.fps}`
    : !cleanRanges(fpsRanges).length
      ? `no frame-rate ranges reported by this camera yet; using ${best.fps}`
      : `${want} fps is not a rate this camera advertises; using ${best.fps}`;
  return { requested: want, fps: best.fps, range: best.range, exact: best.exact, changed: true, reason: why };
}

/**
 * One-line warnings for running this rate on this frame path (empty when
 * there is nothing to say). The GPU and CPU paths convert every frame,
 * so 60 fps doubles their per-second cost (B4 convertMsPerFrame).
 */
export function frameRateWarnings(fps, { frameSource = 'auto', convertMsPerFrame = null, exact = true } = {}) {
  const out = [];
  if (!exact) out.push('the rate may float inside the camera\'s range: shutter and bop timing will follow the real rate');
  if (fps >= 50) {
    if (frameSource === 'cpu' || frameSource === 'gpu') {
      const budget = 1000 / fps;
      const cost = Number.isFinite(convertMsPerFrame) ? convertMsPerFrame : null;
      out.push(cost != null && cost > budget * 0.6
        ? `${fps} fps leaves ${budget.toFixed(1)} ms per frame and the ${frameSource} path spends ${cost} ms converting each one: expect dropped frames`
        : `${fps} fps on the ${frameSource} path converts twice the frames of 30: watch dropped frames`);
    }
    out.push(`${fps} fps halves the longest shutter to ${(1000 / fps).toFixed(1)} ms: low light will need more ISO`);
  }
  if (fps < 30) out.push(`${fps} fps is a film rate: fast pans and the bop will look choppier than at 30`);
  return out;
}
