// Pro mode, the platform-free part (native/src/spike/proMode.js): support
// and reasons per lens, clamping, the Kelvin <-> gain mapping, warnings,
// match targets and residuals; plus the commands and the stage tag.
import test from 'node:test';
import assert from 'node:assert/strict';
import { proSupport, clampPro, kelvinToRgb, kelvinToGains, gainsToKelvin, proWarnings, matchTargets, matchResidual, residualLine, KELVIN_RANGE, PRO_CONTROLS } from '../native/src/spike/proMode.js';
import { proCommand, matchCommand, stageCommand, surveyRequest, encode, decode } from '../native/src/spike/commands.js';
import { CaptureBuffer } from '../native/src/spike/capture.js';
import { normaliseProfile } from '../native/src/spike/survey.js';

// A FULL-level camera with everything, a LIMITED one with nothing manual, a fixed-focus one.
const full = {
  hardwareLevel: 'full', manualSensor: true, manualPostProcessing: true, readSensorSettings: true,
  isoRange: [50, 6400], shutterNsRange: [20_000, 500_000_000], maxFrameDurationNs: 500_000_000,
  evRange: [-12, 12], evStep: 0.1667, focus: { minDiopters: 10, hyperfocalDiopters: 0.5, calibration: 'approximate', afModes: ['off', 'auto', 'continuous-video'] },
  awbModes: ['off', 'auto', 'daylight'], awbLockAvailable: true, aeModes: ['off', 'on'], aeLockAvailable: true, fpsRanges: [[15, 30], [30, 30]], stabilisation: ['off', 'eis'],
};
const limited = { ...full, hardwareLevel: 'limited', manualSensor: false, manualPostProcessing: false, aeModes: ['on'], awbModes: ['auto'], focus: { minDiopters: 0, calibration: 'uncalibrated', afModes: ['auto'] }, evRange: [0, 0], evStep: 0, aeLockAvailable: false, awbLockAvailable: false };

test('proSupport: a FULL camera supports everything with ranges in the wire units', () => {
  const s = proSupport(full);
  assert.deepEqual(s.iso, { supported: true, reason: null, min: 50, max: 6400 });
  assert.deepEqual(s.shutter, { supported: true, reason: null, min: 0.02, max: 500 });
  assert.deepEqual(s.wb, { supported: true, reason: null, min: 2000, max: 10000 });
  assert.deepEqual(s.focus, { supported: true, reason: null, min: 0, max: 10, calibration: 'approximate' });
  assert.deepEqual(s.ev, { supported: true, reason: null, min: -2, max: 2, step: 0.167 });
  assert.equal(s.lockAe.supported, true); assert.equal(s.lockAwb.supported, true); assert.equal(s.lockAf.supported, true);
});

test('proSupport: a LIMITED camera without manual capabilities says why for each control', () => {
  const s = proSupport(limited);
  assert.equal(s.iso.supported, false); assert.match(s.iso.reason, /no MANUAL_SENSOR capability \(hardware level limited\)/);
  assert.equal(s.shutter.supported, false);
  assert.equal(s.wb.supported, false); assert.match(s.wb.reason, /MANUAL_POST_PROCESSING/);
  assert.equal(s.focus.supported, false); assert.equal(s.focus.reason, 'fixed-focus lens');
  assert.equal(s.ev.supported, false); assert.match(s.ev.reason, /empty/);
  assert.equal(s.lockAe.supported, false); assert.equal(s.lockAwb.supported, false); assert.equal(s.lockAf.supported, false);
  assert.equal(proSupport(null).hardwareLevel, 'unknown'); assert.equal(proSupport(null).iso.supported, false);
});

test('clampPro: values land inside the range, EV snaps to the step, unsupported controls say so', () => {
  assert.deepEqual(clampPro('iso', 800, full), { value: 800, clamped: false, supported: true, reason: null });
  const hi = clampPro('iso', 12800, full);
  assert.equal(hi.value, 6400); assert.equal(hi.clamped, true); assert.match(hi.reason, /outside 50–6400; using 6400/);
  assert.equal(clampPro('shutter', 0.001, full).value, 0.02);
  assert.equal(clampPro('wb', 12000, full).value, KELVIN_RANGE[1]);
  assert.equal(clampPro('focus', 25, full).value, 10);
  const ev = clampPro('ev', 0.4, full);
  assert.ok(Math.abs(ev.value - 0.333) < 0.01, `ev snaps to a third: ${ev.value}`); assert.equal(ev.clamped, false);
  assert.equal(clampPro('ev', 3, full).value, 2);
  assert.deepEqual(clampPro('lock', 'ae', full), { value: 'ae', clamped: false, supported: true, reason: null });
  assert.equal(clampPro('lock', 'zoom', full).supported, false);
  assert.equal(clampPro('iso', 800, limited).supported, false); assert.match(clampPro('iso', 800, limited).reason, /MANUAL_SENSOR/);
  assert.equal(clampPro('iso', 'abc', full).value, null);
  assert.equal(clampPro('enable', null, limited).supported, true, 'enable/disable are always allowed');
  assert.equal(clampPro('sharpen', 1, full).supported, false);
  assert.deepEqual(PRO_CONTROLS, ['iso', 'shutter', 'wb', 'focus', 'ev', 'lock', 'unlock', 'enable', 'disable']);
});

test('Kelvin <-> gains: warm light needs more blue gain, daylight is near neutral, and the mapping inverts', () => {
  assert.deepEqual(kelvinToRgb(6600), { r: 255, g: 255, b: 255 }, '6600 K is the fit\'s white point');
  const tungsten = kelvinToGains(3200); const day = kelvinToGains(6500); const shade = kelvinToGains(9000);
  assert.ok(tungsten.b > tungsten.r, 'under tungsten the blue channel is boosted');
  assert.ok(shade.r > shade.b, 'in shade the red channel is boosted');
  assert.ok(Math.abs(day.r - 1) < 0.05 && Math.abs(day.b - 1) < 0.05);
  assert.equal(tungsten.gEven, 1); assert.equal(tungsten.gOdd, 1);
  for (const k of [2500, 3200, 4000, 5600, 6500, 8000]) assert.ok(Math.abs(gainsToKelvin(kelvinToGains(k)) - k) <= 25, `round trip at ${k} K`);
  assert.equal(gainsToKelvin({ r: 0, b: 1 }), null); assert.equal(gainsToKelvin(null), null);
});

test('proWarnings: a shutter longer than a frame costs frame rate; high ISO means grain; slow-path devices are named', () => {
  assert.deepEqual(proWarnings('shutter', 16, { fps: 30, pro: full }), []);
  const slow = proWarnings('shutter', 100, { fps: 30, pro: full });
  assert.equal(slow.length, 1); assert.match(slow[0], /will drop to about 10 fps/);
  assert.match(proWarnings('iso', 4000, { fps: 30, pro: full })[0], /top half .*6400/);
  assert.deepEqual(proWarnings('iso', 400, { fps: 30, pro: full }), []);
  const lim = proWarnings('focus', 2, { fps: 30, pro: limited });
  assert.equal(lim.length, 1); assert.match(lim[0], /hardware level limited/);
  assert.deepEqual(proWarnings('lock', 'ae', { fps: 30, pro: limited }), []);
});

test('match: targets come from the reference state, residuals are in stops and Kelvin', () => {
  const t = matchTargets({ iso: 400, exposureNs: 16_666_667, pro: { colorGains: kelvinToGains(4000) } });
  assert.equal(t.iso, 400); assert.equal(t.shutterMs, 16.6667); assert.ok(Math.abs(t.wbKelvin - 4000) <= 25);
  assert.deepEqual(matchTargets({}), { iso: null, shutterMs: null, wbKelvin: null });
  const res = matchResidual({ iso: 400, shutterMs: 16.6667, wbKelvin: 4000 }, { iso: 800, shutterMs: 8.3333, wbKelvin: 4100 });
  assert.equal(res.isoStops, 1); assert.ok(Math.abs(res.shutterStops + 1) < 0.001); assert.ok(Math.abs(res.exposureStops) < 0.001); assert.equal(res.wbKelvin, 100);
  assert.equal(residualLine(res), '+0 stops exposure, +100 K');
  assert.equal(residualLine(matchResidual({ iso: 400 }, { iso: 400 })), '+0 stops exposure');
  assert.equal(residualLine(null), 'no residual');
});

test('commands: pro, match and stage round-trip through the wire format', () => {
  const p = proCommand({ control: 'wb', value: 5600, decidedAt: 1 });
  const m = matchCommand({ phase: 'apply', targets: { iso: 400, shutterMs: 16.7, wbKelvin: 4000 }, decidedAt: 2 });
  const st = stageCommand({ stage: 'B', decidedAt: 3 });
  const sv = surveyRequest({ decidedAt: 4 });
  for (const c of [p, m, st, sv]) assert.deepEqual(decode(encode(c)), c);
  assert.equal(p.type, 'pro'); assert.equal(p.control, 'wb'); assert.equal(p.value, 5600); assert.ok(p.decisionId.startsWith('dec-'));
  assert.equal(m.phase, 'apply'); assert.equal(st.stage, 'B'); assert.ok(sv.decisionId);
});

test('every buffered record carries the current stage, null before the first stage command', () => {
  const b = new CaptureBuffer({ deviceId: 'd', sessionId: 's', now: () => 1000 });
  b.state({ x: 1 });
  b.setStage('A'); b.intent('dec-1', { type: 'pro' });
  b.setStage('B'); b.cost({ cpuMs: 1 });
  assert.deepEqual(b.records.map((r) => r.stage), [null, 'A', 'B']);
});

test('the profile carries the pro block and the derived support for the primary lens (schema 3)', () => {
  const p = normaliseProfile({ primaryCameraId: '0', lenses: [{ id: '0', facing: 'back', pro: full }], deviceZoom: { available: true, min: 1, max: 4 } });
  assert.equal(p.schema_version, 3); assert.deepEqual(p.pro, full); assert.equal(p.proSupport.iso.supported, true);
  assert.equal(normaliseProfile(null).proSupport.iso.supported, false);
});
