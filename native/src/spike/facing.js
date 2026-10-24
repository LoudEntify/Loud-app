// native/src/spike/facing.js — front and back as first-class cameras.
//
// Korey's rule (24 Oct): the advanced controls run on the back camera;
// the front camera gets the basic set (digital zoom, pan, bop) UNLESS the
// phone's front camera really does advertise the advanced capability, in
// which case it gets it too. So the policy here is "capability decides,
// facing is the default expectation": nothing is enabled because of a
// facing, and nothing is withheld from a front camera that can do it.
//
// Everything is derived from the B2 survey (survey.js), which already
// describes EVERY camera the phone has, not only the back one: each lens
// carries its own deviceZoom, sensor, frameSource eligibility, pro block
// and frame-rate ranges. This file picks the lens per facing and turns it
// into a feature list the controller can show and the runtime can obey.
//
// Pure data, no I/O; tested in tests/spike-facing.test.mjs.
//
// PRD rows 15, 127. S&I: Real-time media.

import { proSupport } from './proMode.js';
import { qualityCeiling, zoomRanges } from './survey.js';
import { frameRateOptions } from './frameRate.js';
import { DIGITAL_ZOOM_MAX, MIN_PAN_ZOOM } from './zoomPlan.js';

export const FACINGS = ['back', 'front'];
export const FACING_LABEL = { back: 'Back camera', front: 'Front camera' };
/** The controls a facing can offer, in the order the controller shows them. */
export const FEATURES = ['deviceZoom', 'lensSwitch', 'digitalZoom', 'pan', 'bop', 'pro', 'hardwarePath'];

const num = (v) => (Number.isFinite(v) ? v : null);

/** Every lens of one facing, best first (the one with the widest zoom range, then the lowest id). */
export function lensesFacing(profile, facing) {
  return (profile?.lenses || [])
    .filter((l) => l.facing === facing)
    .sort((a, b) => ((num(b.deviceZoom?.max) ?? 1) - (num(a.deviceZoom?.max) ?? 1)) || String(a.id).localeCompare(String(b.id)));
}

/** The lens a camera role on this facing would open: the survey's primary when it matches, else the best one. */
export function primaryLensFacing(profile, facing) {
  const all = lensesFacing(profile, facing);
  return all.find((l) => l.id === profile?.primaryCameraId) || all[0] || null;
}

/**
 * What one facing can do: { facing, available, lensId, deviceZoom,
 * zoomRanges, qualityCeiling, frameSource, pro, proSupport, frameRates,
 * features }. `features[k]` is { on, reason } — the reason is the one line
 * the controller shows beside a control it has greyed out.
 */
export function facingCapability(profile, facing) {
  const lens = primaryLensFacing(profile, facing);
  if (!lens) {
    const off = (reason) => ({ on: false, reason });
    return {
      facing, available: false, lensId: null,
      deviceZoom: { available: false, min: 1, max: 1, reason: `this phone reports no ${facing} camera` },
      zoomRanges: [], qualityCeiling: { zoom: null, reason: 'no camera', basis: [] },
      frameSource: { eligible: null, reason: 'no camera' }, pro: null, proSupport: proSupport(null), frameRates: [],
      features: Object.fromEntries(FEATURES.map((k) => [k, off(`this phone reports no ${facing} camera`)])),
    };
  }
  const dzRaw = lens.deviceZoom || {};
  const min = num(dzRaw.min) ?? 1; const max = num(dzRaw.max) ?? 1;
  const available = Boolean(dzRaw.available) && max > min && max > 1.0001;
  const deviceZoom = {
    available, min, max,
    reason: available ? null : (dzRaw.reason || 'this camera reports no zoom range beyond 1x'),
    smoothRamp: false,
    switchOverFactors: Array.isArray(dzRaw.switchOverFactors) ? dzRaw.switchOverFactors : [],
    opticalMaxZoom: num(dzRaw.opticalMaxZoom) ?? 1,
  };
  const ceiling = qualityCeiling(lens, deviceZoom);
  const support = proSupport(lens.pro || null);
  const proControls = ['iso', 'shutter', 'wb', 'focus', 'ev'].filter((k) => support[k]?.supported);
  const switches = deviceZoom.switchOverFactors;
  const hardware = lens.frameSource?.eligible === 'hardware';
  // Digital zoom, pan and bop are crops of the frame we already have, so they
  // need no capability from the camera at all: every facing has them.
  const features = {
    deviceZoom: available ? { on: true, reason: `${min}x to ${max}x on this camera` } : { on: false, reason: deviceZoom.reason },
    lensSwitch: switches.length ? { on: true, reason: `optical switch at ${switches.join(', ')}x` } : { on: false, reason: 'one lens on this camera: nothing to switch to' },
    digitalZoom: { on: true, reason: `crop of the frame, capped at ${DIGITAL_ZOOM_MAX}x` },
    pan: { on: true, reason: `crop of the frame; a pan tightens to ${MIN_PAN_ZOOM}x first when the shot is at 1x` },
    bop: { on: true, reason: 'a rhythmic crop of the frame' },
    pro: proControls.length ? { on: true, reason: `${support.hardwareLevel} level: ${proControls.join(', ')}` } : { on: false, reason: support.iso?.reason || 'this camera offers no manual controls' },
    hardwarePath: hardware ? { on: true, reason: lens.frameSource?.reason || 'FREEFORM crop region' } : { on: false, reason: lens.frameSource?.reason || 'not eligible for the hardware frame path' },
  };
  return {
    facing, available: true, lensId: lens.id ?? null,
    deviceZoom, zoomRanges: zoomRanges(lens, deviceZoom), qualityCeiling: ceiling,
    frameSource: lens.frameSource || { eligible: null, reason: 'not surveyed' },
    pro: lens.pro || null, proSupport: support,
    frameRates: frameRateOptions(lens.pro?.fpsRanges),
    features,
  };
}

/** Both facings at once: { back, front }. */
export function facingCapabilities(profile) {
  return Object.fromEntries(FACINGS.map((f) => [f, facingCapability(profile, f)]));
}

/**
 * One line per facing for the log and the report: what this camera gives
 * and what it does not. Plain English, because Korey reads these.
 */
export function describeFacing(cap) {
  if (!cap?.available) return `${FACING_LABEL[cap?.facing] || 'camera'}: not present on this phone`;
  const on = FEATURES.filter((k) => cap.features[k].on);
  const off = FEATURES.filter((k) => !cap.features[k].on);
  const names = { deviceZoom: 'device zoom', lensSwitch: 'lens switching', digitalZoom: 'digital zoom', pan: 'pan', bop: 'bop', pro: 'pro mode', hardwarePath: 'hardware frame path' };
  const head = `${FACING_LABEL[cap.facing]} (lens ${cap.lensId}): ${on.map((k) => names[k]).join(', ') || 'nothing'}`;
  return off.length ? `${head}. Not here: ${off.map((k) => `${names[k]} (${cap.features[k].reason})`).join('; ')}` : head;
}

/**
 * Is this command allowed on this facing, and why not: { ok, reason }.
 * The runtime asks before it calls the camera, so a refusal carries the
 * capability reason rather than a native error.
 */
export function commandAllowed(cap, command) {
  const type = command?.type;
  if (!cap?.available) return { ok: false, reason: `no ${cap?.facing || 'such'} camera on this phone` };
  if (type === 'zoom') {
    // A zoom beyond the digital cap needs the camera's own zoom.
    const target = num(command.target) ?? 1;
    if (target <= DIGITAL_ZOOM_MAX + 1e-9) return { ok: true, reason: null };
    return cap.features.deviceZoom.on ? { ok: true, reason: null } : { ok: false, reason: `${target}x needs the camera's own zoom: ${cap.features.deviceZoom.reason}` };
  }
  if (type === 'pan' || type === 'bop') return { ok: true, reason: null };
  if (type === 'pro' || type === 'match') {
    if (command.control === 'disable' || command.control === 'enable') return { ok: true, reason: null };
    return cap.features.pro.on ? { ok: true, reason: null } : { ok: false, reason: cap.features.pro.reason };
  }
  return { ok: true, reason: null };
}

/**
 * The mirror rule for a facing. A front camera is what the artist sees in
 * a mirror; what viewers should see is the un-mirrored picture, or their
 * shirt's writing reads backwards. The preview stays mirrored because
 * that is how a person expects to see themselves move. Both are reported
 * in the state sample, never implied (docs/DECISIONS.md 2026-10-24).
 */
export function mirrorRule(facing) {
  return facing === 'front'
    ? { preview: true, broadcast: false, reason: 'front camera: the preview is mirrored so moving feels right, the broadcast is not so writing reads correctly' }
    : { preview: false, broadcast: false, reason: 'back camera: what the lens sees is what everyone sees' };
}
