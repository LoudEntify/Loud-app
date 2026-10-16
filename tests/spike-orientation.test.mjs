// Orientation (native/src/spike/orientation.js), the hybrid pan path in
// zoomPlan.capsFor/realise, the orientation command, the slow-command
// diagnosis and the diagnostic records (14 Oct retest build).
import test from 'node:test';
import assert from 'node:assert/strict';
import { physicalOrientation, physicalFormat, orientationMismatch, normaliseOrientation, frameSizeFor, orientationLine, ORIENTATIONS, uprightRotation, orientationPlan, textureCorrection, quarterTurn, mountOf, nextMountPlan } from '../native/src/spike/orientation.js';
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
  // (on this path the 1.2x digital cap allows about 5 percent of the wide frame off-centre at 2x; the test pan is 4 percent of it)
  const pan = panPlan({ direction: 'right', degree: 0.08, shot: { zoom: 2, cx: 0.5, cy: 0.5 }, caps: hybrid });
  assert.equal(pan.refused, false); assert.equal(pan.mode, 'region+crop'); assert.equal(pan.to.cx, 0.46, "'right' moves the picture right: the framing moves left");
  assert.ok(pan.steps.every((s) => s.deviceZoom >= 1 && s.crop[2] <= 1));
  { const c = pan.steps[pan.steps.length - 1].crop; assert.ok(Math.abs(c[0] + c[2] / 2 - 0.5) > 0.01, 'the last step is cropped off-centre'); }
  // a second pan the same way would need more than the 1.2x crop cap: refused with the hybrid reason
  const twice = panPlan({ direction: 'right', degree: 0.08, shot: pan.to, caps: hybrid });
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

// ── the frame plan: width, height and rotation for both choices (14 Oct retest: the picture came out sideways and squashed) ──
const UPRIGHT = { x: 0.58, y: 9.757, z: 0.716 };       // phone standing up, as logged on the G35
const ON_SIDE = { x: 9.757, y: 0.58, z: 0.716 };       // phone lying on its long edge, landscape-left
const ON_SIDE_R = { x: -9.757, y: 0.58, z: 0.716 };    // landscape-right

test('the plan: portrait is 1080x1920 at the sensor rotation, landscape 1920x1080 a quarter turn less, on both sensor mountings', () => {
  // Moto G35: sensor orientation 90. Portrait: content rotated 90, a 1080-wide, 1920-tall frame. Landscape: 0, 1920 wide, 1080 tall.
  assert.deepEqual(orientationPlan({ orientation: 'portrait', sensorOrientation: 90 }), { orientation: 'portrait', sensorOrientation: 90, mount: { physical: 'unknown', known: false, inverted: false }, desiredRotation: 90, width: 1080, height: 1920 });
  assert.deepEqual(orientationPlan({ orientation: 'landscape', sensorOrientation: 90 }), { orientation: 'landscape', sensorOrientation: 90, mount: { physical: 'unknown', known: false, inverted: false }, desiredRotation: 0, width: 1920, height: 1080 });
  // A sensor mounted the other way round: 270 for portrait, 180 for landscape.
  assert.deepEqual(orientationPlan({ orientation: 'portrait', sensorOrientation: 270 }), { orientation: 'portrait', sensorOrientation: 270, mount: { physical: 'unknown', known: false, inverted: false }, desiredRotation: 270, width: 1080, height: 1920 });
  assert.deepEqual(orientationPlan({ orientation: 'landscape', sensorOrientation: 270 }), { orientation: 'landscape', sensorOrientation: 270, mount: { physical: 'unknown', known: false, inverted: false }, desiredRotation: 180, width: 1920, height: 1080 });
  // Anything that is not 'landscape' is portrait, and a sensor reading is snapped to a quarter turn.
  assert.equal(orientationPlan({ orientation: 'sideways', sensorOrientation: 90 }).orientation, 'portrait');
  assert.equal(uprightRotation('portrait', 88), 90); assert.equal(uprightRotation('landscape', 92), 0);
  assert.equal(quarterTurn(-90), 270); assert.equal(quarterTurn(NaN), 0);
});

test('the frame is never the wrong shape: portrait is tall and landscape is wide, for both phone sensor mountings', () => {
  for (const sensor of [90, 270]) {
    for (const o of ['portrait', 'landscape']) {
      const p = orientationPlan({ orientation: o, sensorOrientation: sensor });
      assert.equal(p.width > p.height, o === 'landscape', `${o} sensor ${sensor}: ${p.width}x${p.height}`);
      // the content rotation is a quarter turn exactly when the shape is swapped from the raw landscape sensor
      assert.equal(p.desiredRotation % 180 === 90, o === 'portrait', `${o} sensor ${sensor}: rotation ${p.desiredRotation}`);
      assert.equal(p.width * p.height, 1920 * 1080);
    }
  }
  // portrait is tall, landscape is wide, whichever way the phone is held
  assert.ok(orientationPlan({ orientation: 'portrait' }).height > orientationPlan({ orientation: 'portrait' }).width);
  assert.ok(orientationPlan({ orientation: 'landscape' }).width > orientationPlan({ orientation: 'landscape' }).height);
});

test('how the phone is held does not change the plan: upright and on its side give the same frame, and only the mount check differs', () => {
  const plan = orientationPlan({ orientation: 'portrait', sensorOrientation: 90 });
  const landPlan = orientationPlan({ orientation: 'landscape', sensorOrientation: 90 });
  assert.equal(physicalOrientation(UPRIGHT), 'portrait');
  assert.equal(physicalOrientation(ON_SIDE), 'landscape-left');
  assert.equal(physicalOrientation(ON_SIDE_R), 'landscape-right');
  // The plan is a function of the choice and the sensor only: there is no gravity argument to pass.
  assert.deepEqual(orientationPlan({ orientation: 'portrait', sensorOrientation: 90 }), plan);
  assert.deepEqual(orientationPlan({ orientation: 'landscape', sensorOrientation: 90 }), landPlan);
  // Portrait with the phone upright: no warning. Landscape with the phone on its side: no warning.
  assert.equal(orientationMismatch('portrait', physicalOrientation(UPRIGHT)).mismatch, false);
  assert.equal(orientationMismatch('landscape', physicalOrientation(ON_SIDE)).mismatch, false);
  assert.equal(orientationMismatch('landscape', physicalOrientation(ON_SIDE_R)).mismatch, false);
  // The mismatch cases warn, and the frame stays the chosen shape (a correctly proportioned sideways picture, never a squashed one).
  assert.equal(orientationMismatch('landscape', physicalOrientation(UPRIGHT)).mismatch, true);
  assert.equal(orientationMismatch('portrait', physicalOrientation(ON_SIDE)).mismatch, true);
  assert.ok(landPlan.width > landPlan.height, 'landscape frame is wide even with the phone upright');
});

test('the texture correction: whatever rotation the camera pipeline already applies, the result is the chosen orientation', () => {
  for (const builtIn of [0, 90, 180, 270]) {
    for (const o of ['portrait', 'landscape']) {
      for (const sensor of [90, 270]) {
        const desired = uprightRotation(o, sensor);
        const corr = textureCorrection(desired, builtIn);
        assert.equal((builtIn + corr) % 360, desired, `built-in ${builtIn}, ${o}, sensor ${sensor}`);
      }
    }
  }
  // no built-in rotation (the raw sensor): the correction is the content rotation itself
  assert.equal(textureCorrection(90, 0), 90); assert.equal(textureCorrection(0, 0), 0);
  // a camera that already turns the picture upright for portrait needs no further turn
  assert.equal(textureCorrection(90, 90), 0);
});

test('the capturer is told the plan, not its own guess: the rotation the JS side computes is the number the native module receives', async () => {
  // runtime.applyOrientation is the only caller of LoudCamera.setOrientation; it passes the plan's rotation.
  const { readFileSync } = await import('node:fs');
  const runtime = readFileSync(new URL('../native/src/spike/runtime.js', import.meta.url), 'utf8');
  assert.match(runtime, /const plan = orientationPlan\(\{ orientation: o, sensorOrientation: st\.sensorOrientation \?\? 90, physical \}\);/);
  assert.match(runtime, /LoudCamera\.setOrientation\(plan\.orientation, plan\.desiredRotation\)/);
  const mod = readFileSync(new URL('../native/modules/loud-camera/index.js', import.meta.url), 'utf8');
  assert.match(mod, /export function setOrientation\(orientation, desiredRotation\)/);
});

// ── the four mounts (15 Oct: landscape with the top to the right came out upside down) ──
const GRAVITY = {
  'portrait': { x: 0.58, y: 9.757, z: 0.716 },
  'portrait-down': { x: -0.58, y: -9.757, z: 0.716 },
  'landscape-left': { x: 9.757, y: 0.58, z: 0.716 },
  'landscape-right': { x: -9.757, y: -0.58, z: 0.716 },
};

test('the four mounts, both orientations, G35 sensor 90: the rotation that makes the picture upright, from the gravity reading', () => {
  const table = { 'portrait': 90, 'portrait-down': 270, 'landscape-left': 0, 'landscape-right': 180 };
  for (const [physical, want] of Object.entries(table)) {
    const reading = physicalOrientation(GRAVITY[physical]);
    assert.equal(reading, physical, `gravity for ${physical} reads back as ${reading}`);
    const o = physical.startsWith('portrait') ? 'portrait' : 'landscape';
    const plan = orientationPlan({ orientation: o, sensorOrientation: 90, physical: reading });
    assert.equal(plan.desiredRotation, want, `${o} on ${physical}`);
    assert.equal(plan.mount.known, true);
    assert.equal(plan.mount.inverted, want === 270 || want === 180, `${physical} is inverted for the base only when a half turn is needed`);
    assert.equal(plan.width, o === 'portrait' ? 1080 : 1920); assert.equal(plan.height, o === 'portrait' ? 1920 : 1080);
  }
});

test('the four mounts with the other sensor mounting (270): each is still the half turn of its partner', () => {
  const table = { 'portrait': 270, 'portrait-down': 90, 'landscape-left': 180, 'landscape-right': 0 };
  for (const [physical, want] of Object.entries(table)) {
    const o = physical.startsWith('portrait') ? 'portrait' : 'landscape';
    assert.equal(orientationPlan({ orientation: o, sensorOrientation: 270, physical }).desiredRotation, want, `${o} on ${physical}`);
  }
});

test('the measured case: landscape-right at the 270 built-in rotation needs a correction of 270, and the picture is then upright', () => {
  const plan = orientationPlan({ orientation: 'landscape', sensorOrientation: 90, physical: 'landscape-right' });
  assert.equal(plan.desiredRotation, 180);
  assert.equal(textureCorrection(plan.desiredRotation, 270), 270);
  assert.equal((270 + textureCorrection(plan.desiredRotation, 270)) % 360, 180);
  // the old plan (no mount) gave 0 there, and 0 is the upside-down picture for that mount
  assert.equal(orientationPlan({ orientation: 'landscape', sensorOrientation: 90 }).desiredRotation, 0);
});

test('a mismatch or a flat phone keeps the base plan and says it has no mount decision', () => {
  assert.deepEqual(mountOf('landscape', 'portrait'), { physical: 'portrait', known: false, inverted: false });
  assert.deepEqual(mountOf('portrait', 'landscape-right'), { physical: 'landscape-right', known: false, inverted: false });
  assert.deepEqual(mountOf('landscape', 'flat'), { physical: 'flat', known: false, inverted: false });
  assert.deepEqual(mountOf('portrait', undefined), { physical: 'unknown', known: false, inverted: false });
  assert.equal(orientationPlan({ orientation: 'landscape', sensorOrientation: 90, physical: 'flat' }).desiredRotation, 0);
  assert.equal(orientationPlan({ orientation: 'portrait', sensorOrientation: 90, physical: 'landscape-left' }).desiredRotation, 90);
});

test('setup-time mount watch: a mount change applies after two equal readings, a flat reading never does, and the lock freezes it', () => {
  // start upright, the phone is turned round to inverted
  let st = { planInverted: false, pending: null };
  const r1 = nextMountPlan({ planInverted: st.planInverted, reading: mountOf('portrait', 'portrait-down'), pending: st.pending });
  assert.equal(r1.apply, false, 'one reading is not enough');
  assert.equal(r1.pending, true);
  const r2 = nextMountPlan({ planInverted: r1.inverted, reading: mountOf('portrait', 'portrait-down'), pending: r1.pending });
  assert.equal(r2.apply, true, 'two equal readings apply it');
  assert.equal(r2.inverted, true);
  // flat readings and unknown readings never change the plan
  assert.equal(nextMountPlan({ planInverted: true, reading: mountOf('portrait', 'flat'), pending: null }).apply, false);
  assert.equal(nextMountPlan({ planInverted: true, reading: mountOf('portrait', 'unknown'), pending: null }).apply, false);
  // once locked (stage or move), nothing changes whatever the reading says
  assert.equal(nextMountPlan({ planInverted: false, reading: mountOf('portrait', 'portrait-down'), pending: true, locked: true }).apply, false);
  // a reading that goes back to the applied mount clears the pending change
  assert.equal(nextMountPlan({ planInverted: false, reading: mountOf('portrait', 'portrait'), pending: true }).pending, null);
});
