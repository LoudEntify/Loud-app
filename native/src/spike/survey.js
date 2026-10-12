// native/src/spike/survey.js — the B2 device capability profile: the shape
// every platform fills in, and the normaliser that turns raw native
// answers into one record. Platform-free; the native module supplies the
// raw object.
//
// PRD row 127. S&I: Observability.

export const PROFILE_SCHEMA_VERSION = 1;

export const PROFILE_SHAPE = {
  make: 'string', model: 'string', os: 'string', osVersion: 'string', appVersion: 'string',
  lenses: 'array of { id, facing, focalLengthMm, sensorMm, fieldOfViewDeg, maxZoomOnThisLens }',
  deviceZoom: '{ available, min, max, reason, smoothRamp, switchOverFactors[] }',
  maxResolution: '{ width, height }', maxFrameRate: 'number', stabilisation: 'array of mode names',
  manualFocus: 'boolean', manualExposure: 'boolean', logicalMultiCamera: 'boolean',
  activeMode: "'device' | 'digital'", activeModeReason: 'string',
};

/** Fill in defaults and derive the fields the director cares about from a raw native answer. */
export function normaliseProfile(raw, { appVersion, schemaVersion = PROFILE_SCHEMA_VERSION } = {}) {
  const dz = raw?.deviceZoom || {};
  const min = Number.isFinite(dz.min) ? dz.min : 1;
  const max = Number.isFinite(dz.max) ? dz.max : 1;
  const available = Boolean(dz.available) && max > min && max > 1.0001;
  const activeMode = available ? 'device' : 'digital';
  return {
    schema_version: schemaVersion,
    make: raw?.make || null, model: raw?.model || null, os: raw?.os || null, osVersion: raw?.osVersion || null, appVersion: appVersion || null,
    lenses: Array.isArray(raw?.lenses) ? raw.lenses : [],
    deviceZoom: { available, min, max, reason: available ? null : (dz.reason || (max <= 1.0001 ? 'zoom range is 1.0 to 1.0' : 'device zoom unavailable')), smoothRamp: Boolean(dz.smoothRamp), switchOverFactors: Array.isArray(dz.switchOverFactors) ? dz.switchOverFactors : [] },
    maxResolution: raw?.maxResolution || null, maxFrameRate: raw?.maxFrameRate ?? null,
    stabilisation: Array.isArray(raw?.stabilisation) ? raw.stabilisation : [],
    manualFocus: Boolean(raw?.manualFocus), manualExposure: Boolean(raw?.manualExposure),
    logicalMultiCamera: Boolean(raw?.logicalMultiCamera),
    activeMode, activeModeReason: available ? `device zoom ${min}x to ${max}x` : `digital fallback, capped at 1.2x: ${dz.reason || 'device zoom unavailable'}`,
    surveyedAt: new Date().toISOString(),
  };
}

/** File name a survey run writes, so a device farm run yields one file per model. */
export function surveyFileName(profile) {
  const slug = (s) => String(s || 'unknown').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `capability-${slug(profile.make)}-${slug(profile.model)}-${slug(profile.os)}-${slug(profile.osVersion)}.json`;
}
