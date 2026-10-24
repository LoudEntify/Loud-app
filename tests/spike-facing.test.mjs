// Front and back as first-class cameras (native/src/spike/facing.js): the
// capability of the camera that is running decides what works, not which
// way it faces. Korey's rule, 24 Oct: advanced on the back, basic on the
// front unless the front camera really advertises more.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FACINGS, lensesFacing, primaryLensFacing, facingCapability, facingCapabilities, describeFacing, commandAllowed, mirrorRule } from '../native/src/spike/facing.js';

const sensor = (w, h, cropping = 'freeform', maxDigital = 4) => ({ activeArray: { width: w, height: h }, pixelArray: { width: w, height: h }, croppingType: cropping, maxDigitalZoom: maxDigital, apertures: [1.8] });
const proFull = { hardwareLevel: 'full', manualSensor: true, manualPostProcessing: true, readSensorSettings: true, isoRange: [50, 6400], shutterNsRange: [20000, 500000000], evRange: [-12, 12], evStep: 0.1667, focus: { minDiopters: 10, calibration: 'approximate', afModes: ['off', 'auto'] }, awbModes: ['off', 'auto'], awbLockAvailable: true, aeModes: ['off', 'on'], aeLockAvailable: true, fpsRanges: [[24, 24], [30, 30], [60, 60]] };
const proBasic = { hardwareLevel: 'limited', manualSensor: false, manualPostProcessing: false, isoRange: null, shutterNsRange: null, evRange: [0, 0], evStep: 0, focus: { minDiopters: 0, afModes: ['auto'] }, awbModes: ['auto'], awbLockAvailable: false, aeModes: ['on'], aeLockAvailable: false, fpsRanges: [[15, 30], [30, 30]] };

// A typical phone: a zooming multi-lens back camera, a plain fixed front one.
const typical = {
  primaryCameraId: '0',
  lenses: [
    { id: '0', facing: 'back', focalLengthMm: 5.4, physicalLenses: [{ id: '2', focalLengthMm: 5.4, sensor: sensor(4080, 3060) }, { id: '5', focalLengthMm: 15.4, sensor: sensor(4000, 3000) }], sensor: sensor(4080, 3060), frameSource: { eligible: 'hardware', reason: 'FREEFORM crop region, max digital zoom 4.0' }, pro: proFull, deviceZoom: { available: true, min: 1, max: 10, switchOverFactors: [2.86], opticalMaxZoom: 3 } },
    { id: '1', facing: 'front', focalLengthMm: 2.7, sensor: sensor(2600, 1950, 'center_only', 1), frameSource: { eligible: 'gpu', reason: 'SCALER_CROPPING_TYPE is CENTER_ONLY: the HAL would re-centre a pan' }, pro: proBasic, deviceZoom: { available: false, min: 1, max: 1, reason: 'zoom range is 1.0 to 1.0', switchOverFactors: [], opticalMaxZoom: 1 } },
  ],
};
// A phone whose front camera is genuinely capable: it must not be held back by the rule.
const capableFront = {
  primaryCameraId: '0',
  lenses: [
    typical.lenses[0],
    { id: '1', facing: 'front', focalLengthMm: 2.7, sensor: sensor(3000, 2250), frameSource: { eligible: 'hardware', reason: 'FREEFORM crop region, max digital zoom 2.0' }, pro: proFull, deviceZoom: { available: true, min: 1, max: 2, switchOverFactors: [], opticalMaxZoom: 1 } },
  ],
};

test('lensesFacing and primaryLensFacing pick the right camera for each facing', () => {
  assert.deepEqual(lensesFacing(typical, 'back').map((l) => l.id), ['0']);
  assert.deepEqual(lensesFacing(typical, 'front').map((l) => l.id), ['1']);
  assert.equal(primaryLensFacing(typical, 'front').id, '1');
  assert.equal(primaryLensFacing(typical, 'back').id, '0');
  assert.equal(primaryLensFacing({ lenses: [] }, 'front'), null);
});

test('the back camera of a normal phone gets everything, with its own zoom range and ceiling', () => {
  const back = facingCapability(typical, 'back');
  assert.equal(back.available, true);
  assert.equal(back.lensId, '0');
  assert.equal(back.deviceZoom.max, 10);
  assert.equal(back.features.deviceZoom.on, true);
  assert.equal(back.features.lensSwitch.on, true);
  assert.match(back.features.lensSwitch.reason, /2\.86/);
  assert.equal(back.features.pro.on, true);
  assert.equal(back.features.hardwarePath.on, true);
  assert.ok(back.qualityCeiling.zoom > 1);
  // 25 is absent here because this fixture advertises only fixed 24, 30 and 60 with no range around 25
  assert.deepEqual(back.frameRates.filter((f) => f.supported).map((f) => f.fps), [24, 30, 60]);
});

test('a plain front camera keeps the basic set and says why the rest is missing', () => {
  const front = facingCapability(typical, 'front');
  assert.equal(front.available, true);
  assert.equal(front.features.digitalZoom.on, true);
  assert.equal(front.features.pan.on, true);
  assert.equal(front.features.bop.on, true);
  assert.equal(front.features.deviceZoom.on, false);
  assert.match(front.features.deviceZoom.reason, /1\.0 to 1\.0/);
  assert.equal(front.features.lensSwitch.on, false);
  assert.equal(front.features.pro.on, false);
  assert.match(front.features.pro.reason, /MANUAL_SENSOR|hardware level/);
  assert.equal(front.features.hardwarePath.on, false);
  assert.match(front.features.hardwarePath.reason, /CENTER_ONLY/);
  // 60 fps is not on this camera even though the back one has it
  assert.equal(front.frameRates.find((f) => f.fps === 60).supported, false);
});

test('a front camera that really is capable is not held back by the rule', () => {
  const front = facingCapability(capableFront, 'front');
  assert.equal(front.features.deviceZoom.on, true);
  assert.equal(front.features.pro.on, true);
  assert.equal(front.features.hardwarePath.on, true);
  assert.equal(front.deviceZoom.max, 2);
});

test('a phone with no front camera says so rather than offering controls', () => {
  const only = { primaryCameraId: '0', lenses: [typical.lenses[0]] };
  const front = facingCapability(only, 'front');
  assert.equal(front.available, false);
  for (const k of Object.keys(front.features)) assert.equal(front.features[k].on, false, k);
  assert.match(describeFacing(front), /not present/);
  assert.deepEqual(Object.keys(facingCapabilities(only)), FACINGS);
});

test('describeFacing reads as plain English, on and off', () => {
  const line = describeFacing(facingCapability(typical, 'front'));
  assert.match(line, /^Front camera \(lens 1\): /);
  assert.match(line, /digital zoom/);
  assert.match(line, /Not here: device zoom/);
});

test('commandAllowed: a zoom past the digital cap needs the camera\'s own zoom; crops are always fine', () => {
  const front = facingCapability(typical, 'front');
  const back = facingCapability(typical, 'back');
  assert.deepEqual(commandAllowed(front, { type: 'zoom', target: 1.2 }), { ok: true, reason: null });
  const refused = commandAllowed(front, { type: 'zoom', target: 2 });
  assert.equal(refused.ok, false);
  assert.match(refused.reason, /needs the camera's own zoom/);
  assert.equal(commandAllowed(back, { type: 'zoom', target: 5 }).ok, true);
  assert.equal(commandAllowed(front, { type: 'pan', direction: 'left' }).ok, true);
  assert.equal(commandAllowed(front, { type: 'bop', direction: 'left-right' }).ok, true);
  assert.equal(commandAllowed(front, { type: 'pro', control: 'iso', value: 400 }).ok, false);
  assert.equal(commandAllowed(front, { type: 'pro', control: 'disable' }).ok, true);
  assert.equal(commandAllowed(back, { type: 'pro', control: 'iso', value: 400 }).ok, true);
  assert.equal(commandAllowed(facingCapability(capableFront, 'front'), { type: 'pro', control: 'iso', value: 400 }).ok, true);
});

test('mirrorRule: the front preview is mirrored, the broadcast is not', () => {
  assert.deepEqual(mirrorRule('front').preview, true);
  assert.deepEqual(mirrorRule('front').broadcast, false);
  assert.match(mirrorRule('front').reason, /reads correctly/);
  assert.deepEqual(mirrorRule('back'), { preview: false, broadcast: false, reason: 'back camera: what the lens sees is what everyone sees' });
});
