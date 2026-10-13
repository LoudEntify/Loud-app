// native/src/spike/survey.js — the B2 device capability profile: the shape
// every platform fills in, and the normaliser that turns raw native
// answers into one record. Platform-free; the native module supplies the
// raw object.
//
// Two things the director reads from here before any move:
//   zoomRanges     which parts of the device zoom range are a lens
//                  (optical) and which are the sensor being cropped;
//   qualityCeiling the default zoom ceiling: the most zoom the sensor
//                  crop gives before the region feeding a 1080p stream
//                  is narrower than 1920 px (docs/DECISIONS.md 2026-10-13).
//
// PRD row 127. S&I: Observability.

export const PROFILE_SCHEMA_VERSION = 2;
export const OUTPUT_WIDTH_PX = 1920;   // the stream is 1080p (1920 x 1080 landscape, carried portrait)

export const PROFILE_SHAPE = {
  make: 'string', model: 'string', os: 'string', osVersion: 'string', appVersion: 'string',
  lenses: 'array of { id, facing, focalLengthMm, sensorMm, fieldOfViewDeg, maxZoomOnThisLens, sensor: { activeArray, pixelArray, croppingType, maxDigitalZoom, apertures }, physicalLenses[], frameSource: { eligible, reason } }',
  deviceZoom: '{ available, min, max, reason, smoothRamp, switchOverFactors[], opticalMaxZoom }',
  zoomRanges: "array of { from, to, kind: 'sensor-crop' | 'optical-switch', lensId, sensorPx }",
  qualityCeiling: '{ zoom, reason, basis: [{ lensId, baseZoom, sensorWidthPx, bandWidthPx, ceiling }] }',
  maxResolution: '{ width, height }', maxFrameRate: 'number', stabilisation: 'array of mode names',
  manualFocus: 'boolean', manualExposure: 'boolean', logicalMultiCamera: 'boolean',
  frameSource: "{ eligible: 'hardware' | 'gpu', reason }",
  activeMode: "'device' | 'digital'", activeModeReason: 'string',
};

const num = (v) => (Number.isFinite(v) ? v : null);
const floor1 = (v) => Math.floor(v * 10 + 1e-9) / 10;

/** The 16:9 band a 16:9 stream is cut from inside a sensor's active array, in px. */
export function bandWidthPx(activeArray) {
  const w = num(activeArray?.width); const h = num(activeArray?.height);
  if (!w || !h) return null;
  return Math.min(w, Math.round((h * 16) / 9));
}

/**
 * The physical lenses of a camera as zoom bases: the shortest focal
 * length is 1x; each longer lens is a base of focal/shortest. A camera
 * with no physical lens list is one lens at 1x.
 */
export function lensBases(lens) {
  const phys = Array.isArray(lens?.physicalLenses) && lens.physicalLenses.length ? lens.physicalLenses : [{ id: lens?.id ?? null, focalLengthMm: lens?.focalLengthMm ?? null, sensor: lens?.sensor ?? null }];
  const focals = phys.map((p) => num(p.focalLengthMm)).filter((f) => f != null && f > 0);
  const shortest = focals.length ? Math.min(...focals) : null;
  return phys
    .map((p) => ({ lensId: p.id ?? null, baseZoom: shortest && num(p.focalLengthMm) ? +(p.focalLengthMm / shortest).toFixed(2) : 1, activeArray: p.sensor?.activeArray ?? null }))
    .sort((a, b) => a.baseZoom - b.baseZoom);
}

/**
 * Which parts of [min, max] are optical and which are the sensor being
 * cropped. Between two lens bases the camera crops the shorter lens;
 * at a longer lens's base it switches lens (optical); beyond the longest
 * lens it crops that lens up to `max`.
 */
export function zoomRanges(lens, deviceZoom) {
  const bases = lensBases(lens);
  const min = num(deviceZoom?.min) ?? 1; const max = num(deviceZoom?.max) ?? 1;
  const out = [];
  const inRange = bases.filter((b) => b.baseZoom <= max + 1e-6);
  if (!inRange.length) return out;
  if (min < inRange[0].baseZoom - 1e-6) out.push({ from: min, to: inRange[0].baseZoom, kind: 'sensor-crop', lensId: inRange[0].lensId, sensorPx: inRange[0].activeArray, note: 'below the shortest lens: the HAL uses a wider field than 1x (ultrawide) or crops' });
  inRange.forEach((b, i) => {
    if (i > 0) out.push({ from: b.baseZoom, to: b.baseZoom, kind: 'optical-switch', lensId: b.lensId, sensorPx: b.activeArray });
    const to = i + 1 < inRange.length ? inRange[i + 1].baseZoom : max;
    if (to > b.baseZoom + 1e-6) out.push({ from: b.baseZoom, to, kind: 'sensor-crop', lensId: b.lensId, sensorPx: b.activeArray });
  });
  return out;
}

/**
 * The default zoom ceiling: on each lens, 1080p holds while the cropped
 * region is at least OUTPUT_WIDTH_PX wide, i.e. up to
 * baseZoom x bandWidth / 1920; the ceiling is the best lens's figure,
 * floored to 0.1 and kept inside the device range. `basis` shows every
 * lens so a gap (a lens whose crop runs out before the next lens starts)
 * can be seen; the ceiling itself is one number the director clamps to.
 */
export function qualityCeiling(lens, deviceZoom) {
  const max = num(deviceZoom?.max) ?? 1; const min = num(deviceZoom?.min) ?? 1;
  const basis = lensBases(lens).map((b) => {
    const band = bandWidthPx(b.activeArray);
    return { lensId: b.lensId, baseZoom: b.baseZoom, sensorWidthPx: num(b.activeArray?.width), bandWidthPx: band, ceiling: band ? floor1((b.baseZoom * band) / OUTPUT_WIDTH_PX) : null };
  });
  const known = basis.filter((b) => b.ceiling != null && b.baseZoom <= max + 1e-6);
  if (!known.length) return { zoom: null, reason: 'sensor size unknown: no ceiling (device range applies)', basis };
  const best = known.reduce((m, b) => (b.ceiling > m.ceiling ? b : m));
  const zoom = Math.min(max, Math.max(min, 1, best.ceiling));
  const why = best.ceiling >= max
    ? `the whole ${min}-${max}x range holds 1080p (lens ${best.lensId}: ${best.bandWidthPx} px wide band)`
    : `beyond ${zoom}x the sensor crop feeding 1080p is narrower than ${OUTPUT_WIDTH_PX} px (lens ${best.lensId} at ${best.baseZoom}x: ${best.bandWidthPx} px wide band)`;
  return { zoom: +zoom.toFixed(1), reason: why, basis };
}

/** Fill in defaults and derive the fields the director cares about from a raw native answer. */
export function normaliseProfile(raw, { appVersion, schemaVersion = PROFILE_SCHEMA_VERSION } = {}) {
  const dz = raw?.deviceZoom || {};
  const min = Number.isFinite(dz.min) ? dz.min : 1;
  const max = Number.isFinite(dz.max) ? dz.max : 1;
  const available = Boolean(dz.available) && max > min && max > 1.0001;
  const activeMode = available ? 'device' : 'digital';
  const lenses = Array.isArray(raw?.lenses) ? raw.lenses : [];
  const primary = lenses.find((l) => l.id === raw?.primaryCameraId) || lenses.find((l) => l.facing === 'back') || lenses[0] || null;
  const deviceZoom = {
    available, min, max,
    reason: available ? null : (dz.reason || (max <= 1.0001 ? 'zoom range is 1.0 to 1.0' : 'device zoom unavailable')),
    smoothRamp: Boolean(dz.smoothRamp),
    switchOverFactors: Array.isArray(dz.switchOverFactors) ? dz.switchOverFactors : [],
    opticalMaxZoom: num(dz.opticalMaxZoom) ?? 1,
  };
  const ceiling = qualityCeiling(primary, deviceZoom);
  return {
    schema_version: schemaVersion,
    make: raw?.make || null, model: raw?.model || null, os: raw?.os || null, osVersion: raw?.osVersion || null, appVersion: appVersion || null,
    primaryCameraId: raw?.primaryCameraId ?? primary?.id ?? null,
    lenses,
    deviceZoom,
    zoomRanges: zoomRanges(primary, deviceZoom),
    qualityCeiling: ceiling,
    maxResolution: raw?.maxResolution || null, maxFrameRate: raw?.maxFrameRate ?? null,
    stabilisation: Array.isArray(raw?.stabilisation) ? raw.stabilisation : [],
    manualFocus: Boolean(raw?.manualFocus), manualExposure: Boolean(raw?.manualExposure),
    logicalMultiCamera: Boolean(raw?.logicalMultiCamera),
    frameSource: primary?.frameSource || { eligible: null, reason: 'not surveyed' },
    activeMode,
    activeModeReason: available
      ? `device zoom ${min}x to ${max}x${ceiling.zoom != null && ceiling.zoom < max ? `, ceiling ${ceiling.zoom}x for 1080p` : ''}`
      : `digital fallback, capped at 1.2x: ${dz.reason || 'device zoom unavailable'}`,
    surveyedAt: new Date().toISOString(),
  };
}

/** File name a survey run writes, so a device farm run yields one file per model. */
export function surveyFileName(profile) {
  const slug = (s) => String(s || 'unknown').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `capability-${slug(profile.make)}-${slug(profile.model)}-${slug(profile.os)}-${slug(profile.osVersion)}.json`;
}
