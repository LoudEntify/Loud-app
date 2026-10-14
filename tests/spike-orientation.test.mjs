// Orientation (native/src/spike/orientation.js), the hybrid pan path in
// zoomPlan.capsFor/realise, the orientation command, the slow-command
// diagnosis and the diagnostic records (14 Oct retest build).
import test from 'node:test';
import assert from 'node:assert/strict';
import { physicalOrientation, physicalFormat, orientationMismatch, normaliseOrientation, frameSizeFor, orientationLine, ORIENTATIONS } from '../native/src/spike/orientation.js';
import { orientationCommand, ack, encode, decode, slowCommandDiagnosis, SLOW_COMMAND_MS } from '../native/src/spike/commands.js';
import { capsFor, realise, regionCarriesPan, panPlan, zoomPlan, unrealisable, SHOT_HOME } from '../native/src/spike/zoomPlan.js';
import { CaptureBuffer } from '../native/src/spike/capture.js';

const G = 9.81;
const g35 = { deviceZoom: { available: true, min: 1, max: 4 }, qualityCeiling: { zoom: 2.1, reason: 'sensor crop would drop below 1080p' } };

test('physicalOrientation reads one gravity vector: upright, on its side, flat, nothing', () => {
  assert.equal(physicalOrientation({ x: 0.2, y: G, z: 0.5 }), 'portrait');
  assert.equal(physicalOrientation({ x: 0.1, y: -G, z: 0.3 }), 'portrait-down');
  assert.equal(physicalOrientation({ x: G, y: 0.4, z: 0.2 }), 'landscape-left');
  assert.equal(physicalOrientation({ x: -G, y: 0.4, z: 0.2 }), 'landscape-right');
  assert.equal(physicalOrientation({ x: 0.3, y: 0.2, z: G }), 'flat', 'screen up');
  assert.equal(physicalOrientation({ x: 0.3, y: 0.2, z: -G }), 'flat', 'screen down');
  assert.equal(physicalOrientation({ x: 2, y: 6, z: 7 }), 'portrait', 'propped at an angle still reads from the dominant in-plane axis');
  assert.equal(physicalOrientation(null), 'unknown'); assert.equal(physicalOrientation({ x: 0, y: 0, z: 0 }), 'unknown');
  assert.equal(physicalFormat('portrait-down'), 'portrait'); assert.equal(physicalFormat('landscape-right'), 'landscape'); assert.equal(physicalFormat('flat'), null);
});

test('orientationMismatch warns with a one-line fix only when the mount contradicts the show', () => {
  const ok = orientationMismatch('portrait', 'portrait');
  assert.equal(ok.mismatch, false); assert.equal(ok.warning, null);
  const bad = orientationMismatch('portrait', 'landscape-left');
  assert.equal(bad.mismatch, true); assert.match(bad.warning, /mounted landscape but the show is portrait/); assert.match(bad.fix, /stand the phone up tall, or set the show to Landscape/);
  const bad2 = orientationMismatch('landscape', 'portrait');
  assert.equal(bad2.mismatch, true); assert.match(bad2.fix, /turn the phone on its side, or set the show to Portrait/);
  const flat = orientationMismatch('portrait', 'flat');
  assert.equal(flat.mismatch, false); assert.match(flat.warning, /lying flat/); assert.match(flat.fix, /stand it up/);
  assert.deepEqual(orientationMismatch('landscape', 'unknown'), { chosen: 'landscape', physical: 'unknown', mismatch: false, warning: null, fix: null });
  assert.equal(normaliseOrientation('sideways'), 'portrait', 'anything but landscape is portrait (the default)');
  assert.deepEqual(frameSizeFor('landscape'), { width: 1920, height: 1080 }); assert.deepEqual(frameSizeFor('portrait'), { width: 1080, height: 1920 });
  assert.deepEqual(ORIENTATIONS, ['portrait', 'landscape']);
  assert.match(orientationLine({ orientation: 'landscape', width: 1920, height: 1080, sensorOrientation: 90, rotation: 0, physical: 'portrait', mismatch: true, warning: 'w', fix: 'f' }), /landscape \(1920×1080, sensor 90°, rotation 0°\) · mounted portrait MISMATCH: w\. Fix: f/);
});

test('the orientation command round-trips, and an ack can carry the camera diagnostics', () => {
  const c = orientationCommand({ orientation: 'landscape', decidedAt: 5 });
  assert.equal(c.type, 'orientation'); assert.equal(c.orientation, 'landscape'); assert.deepEqual(decode(encode(c)), c);
  const plain = ack({ command: c, receivedAt: 1, startedAt: 2, completedAt: 3, result: { kind: 'orientation', achieved: 'landscape' } });
  assert.equal('diag' in plain, false, 'no diag field unless given');
  const withDiag = ack({ command: c, receivedAt: 1, startedAt: 2, completedAt: 3, result: {}, diag: { receivedLocalMs: 10, offsetMs: -700, stallMs: null, linkEvents: [] } });
  assert.deepEqual(decode(encode(withDiag)).diag, { receivedLocalMs: 10, offsetMs: -700, stallMs: null, linkEvents: [] });
});

test('capsFor: a hardware source whose HAL re-centres regions plans like the gpu source with the region zoom range', () => {
  const region = capsFor(g35, { frameSource: 'hardware', deviceZoomMax: 4, panPath: 'region' });
  const hybrid = capsFor(g35, { frameSource: 'hardware', deviceZoomMax: 4, panPath: 'gpu' });
  assert.equal(region.panPath, 'region'); assert.equal(regionCarriesPan(region), true);
  assert.equal(hybrid.panPath, 'gpu'); assert.equal(hybrid.frameSource, 'hardware'); assert.equal(regionCarriesPan(hybrid), false);
  assert.deepEqual(hybrid.deviceZoom, { available: true, min: 1, max: 4 });
  assert.equal(capsFor(g35, { frameSource: 'gpu' }).panPath, 'crop');
  // a centred 2x: the region (hwZoom) does it, no crop
  const z = realise({ zoom: 2, cx: 0.5, cy: 0.5 }, hybrid);
  assert.equal(z.mode, 'region'); assert.equal(z.deviceZoom, 2); assert.deepEqual(z.crop, { x: 0, y: 0, w: 1, h: 1 });
  // an off-centre shot: the region zooms a little less, the GPU crop carries the pan
  const p = realise({ zoom: 2, cx: 0.54, cy: 0.5 }, hybrid);
  assert.equal(p.mode, 'region+crop'); assert.ok(p.deviceZoom < 2 && p.deviceZoom > 1.5, `device zoom pulled back for the pan: ${p.deviceZoom}`); assert.ok(p.crop.x > 0.1, 'the crop is off-centre'); assert.ok(p.digitalFactor > 1.1 && p.digitalFactor <= 1.2);
  // on the pure region path the same shot is one region
  assert.equal(realise({ zoom: 2, cx: 0.54, cy: 0.5 }, region).mode, 'region');
  // a pan at 2x on the hybrid path: steps carry both a device zoom and a crop, and the shot moves
  const pan = panPlan({ direction: 'right', shot: { zoom: 2, cx: 0.5, cy: 0.5 }, caps: hybrid });
  assert.equal(pan.refused, false); assert.equal(pan.mode, 'region+crop'); assert.equal(pan.to.cx, 0.54);
  assert.ok(pan.steps.every((s) => s.deviceZoom >= 1 && s.crop[2] <= 1));
  assert.ok(pan.steps[pan.steps.length - 1].crop[0] > 0, 'the last step is cropped off-centre');
  // a second pan the same way would need more than the 1.2x crop cap: refused with the hybrid reason
  const twice = panPlan({ direction: 'right', shot: pan.to, caps: hybrid });
  assert.equal(twice.refused, true); assert.match(twice.reason, /this HAL re-centres crop regions, so a pan is a crop of the zoomed frame/);
  assert.equal(unrealisable({ zoom: 2, cx: 0.5, cy: 0.5 }, hybrid), null);
  // zooms are unchanged by the pan path: 5x still lands on the 2.1x ceiling
  assert.equal(zoomPlan({ profile: g35, caps: hybrid, shot: SHOT_HOME, target: 5 }).to.zoom, 2.1);
});

test('slowCommandDiagnosis: nothing under the threshold; a clock step, a stall, a link change or an unexplained stall each get a verdict', () => {
  assert.equal(slowCommandDiagnosis({ commandLatencyMs: 40 }, { sentLocal: 0, offsetAtSend: 0 }, null), null);
  assert.equal(SLOW_COMMAND_MS, 2000);
  // server-clock leg 30 s, but on the two local clocks it was 30 ms: a clock offset stepped
  const step = slowCommandDiagnosis({ commandLatencyMs: 30371 }, { sentLocal: 1000, offsetAtSend: 19 }, { receivedLocalMs: 1751, offsetMs: -702, stallMs: null, linkEvents: [] });
  assert.equal(step.localLegMs, 30); assert.match(step.verdict, /clock offset changed by ~30341 ms/);
  // local leg also 30 s and the camera's JS thread was blocked: the camera
  const stall = slowCommandDiagnosis({ commandLatencyMs: 30000 }, { sentLocal: 1000, offsetAtSend: 0 }, { receivedLocalMs: 31000, offsetMs: 0, stallMs: 29000, linkEvents: [] });
  assert.match(stall.verdict, /JS thread was blocked for ~29000 ms/);
  const link = slowCommandDiagnosis({ commandLatencyMs: 30000 }, { sentLocal: 1000, offsetAtSend: 0 }, { receivedLocalMs: 31000, offsetMs: 0, stallMs: null, linkEvents: ['reconnecting', 'reconnected'] });
  assert.match(link.verdict, /connection changed state \(reconnecting, reconnected\)/);
  const bare = slowCommandDiagnosis({ commandLatencyMs: 30000 }, { sentLocal: 1000, offsetAtSend: 0 }, { receivedLocalMs: 31000, offsetMs: 0, stallMs: null, linkEvents: [] });
  assert.match(bare.verdict, /stalled with no connection-state change and no clock step/);
  assert.match(slowCommandDiagnosis({ commandLatencyMs: 30000 }, { sentLocal: 1000, offsetAtSend: 0 }, null).verdict, /no camera diagnostics/);
});

test('the buffer records link changes, stalls and a stepped clock as their own streams', () => {
  const b = new CaptureBuffer({ deviceId: 'd', sessionId: 's', now: () => 1 });
  b.link('reconnecting'); b.stall(2400); b.clock({ offsetMs: 30000, errorBoundMs: 20, rttMs: 40, samples: 5 }, { step_ms: 30000 }); b.clock({ offsetMs: 30010, errorBoundMs: 20, rttMs: 40, samples: 5 });
  assert.deepEqual(b.records.map((r) => r.stream), ['LINK', 'STALL', 'B12', 'B12']);
  assert.equal(b.records[0].state, 'reconnecting'); assert.equal(b.records[1].lag_ms, 2400); assert.equal(b.records[2].step_ms, 30000); assert.equal('step_ms' in b.records[3], false);
});
