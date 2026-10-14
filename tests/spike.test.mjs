// Unit tests for the platform-free spike modules in native/src/spike.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseZoomMode, capsFor, realise, unrealisable, shotWindow, shotRoom, zoomPlan, panPlan, ease, tightnessFor, DIGITAL_ZOOM_MAX, PAN_DEFAULTS, SHOT_HOME } from '../native/src/spike/zoomPlan.js';
import { zoomCommand, panCommand, ack, encode, decode, roundTripMs, ackLatencies, summariseLatencies, TOPIC } from '../native/src/spike/commands.js';
import { pickOffset, measureOffset, toServerMs } from '../native/src/spike/clock.js';
import { CaptureBuffer, uploadDue, objectPath, BATCH_EVERY_MS, STATE_SAMPLE_MS, MAX_BUFFER_RECORDS } from '../native/src/spike/capture.js';
import { normaliseProfile, surveyFileName, qualityCeiling, zoomRanges, bandWidthPx } from '../native/src/spike/survey.js';

const deviceProfile = { deviceZoom: { available: true, min: 0.6, max: 8 } };
const fixedProfile = { deviceZoom: { available: false, min: 1, max: 1, reason: 'zoom range is 1 to 1' } };
const g35Profile = { deviceZoom: { available: true, min: 1, max: 4 }, qualityCeiling: { zoom: 2.1, reason: 'beyond 2.1x the sensor crop feeding 1080p is narrower than 1920 px' } };
const gpuCaps = capsFor(deviceProfile, { frameSource: 'gpu' });
const hwCaps = capsFor(g35Profile, { frameSource: 'hardware', deviceZoomMin: 1, deviceZoomMax: 4 });
const cpuNoZoom = capsFor(fixedProfile, { frameSource: 'cpu' });
const inFrame = (c) => c[0] >= -1e-4 && c[1] >= -1e-4 && c[0] + c[2] <= 1.0001 && c[1] + c[3] <= 1.0001;

test('zoom mode: device first, clamped to the device range, then to the quality ceiling', () => {
  assert.deepEqual(chooseZoomMode(deviceProfile, 2), { mode: 'device', target: 2, clamped: false, reason: null });
  const over = chooseZoomMode(deviceProfile, 20);
  assert.equal(over.target, 8); assert.equal(over.clamped, true); assert.match(over.reason, /device range/);
  // the Moto G35: 4x device range, but 1080p only holds to 2.1x
  const five = chooseZoomMode(g35Profile, 5, hwCaps);
  assert.equal(five.mode, 'region'); assert.equal(five.target, 2.1); assert.equal(five.clamped, true); assert.match(five.reason, /quality ceiling 2.1x/);
  assert.equal(chooseZoomMode(g35Profile, 2, hwCaps).clamped, false);
});

test('zoom mode: digital fallback only when device zoom is unavailable, capped at 1.2x', () => {
  const r = chooseZoomMode(fixedProfile, 3);
  assert.equal(r.mode, 'digital'); assert.equal(r.target, DIGITAL_ZOOM_MAX); assert.equal(r.clamped, true); assert.match(r.reason, /capped at 1.2x/);
  const small = chooseZoomMode(fixedProfile, 1.1);
  assert.equal(small.target, 1.1); assert.equal(small.clamped, false);
  assert.equal(chooseZoomMode(null, 2).mode, 'digital');
});

test('caps: the hardware source takes its zoom range from the crop region, the others from the profile', () => {
  assert.deepEqual(hwCaps, { frameSource: 'hardware', panPath: 'region', deviceZoom: { available: true, min: 1, max: 4 }, digitalMax: DIGITAL_ZOOM_MAX });
  assert.deepEqual(gpuCaps, { frameSource: 'gpu', panPath: 'crop', deviceZoom: { available: true, min: 0.6, max: 8 }, digitalMax: DIGITAL_ZOOM_MAX });
  assert.deepEqual(cpuNoZoom.deviceZoom, { available: false, min: 1, max: 1 });
  assert.equal(capsFor(deviceProfile, null).frameSource, 'cpu');
});

test('a shot is a window of the wide frame; realised per frame source', () => {
  const two = { zoom: 2, cx: 0.5, cy: 0.5 };
  assert.deepEqual(shotWindow(two), { x: 0.25, y: 0.25, w: 0.5, h: 0.5 });
  assert.equal(shotRoom(two, 'left'), 0.25); assert.equal(shotRoom({ zoom: 2, cx: 0.3, cy: 0.5 }, 'left'), 0.05); assert.equal(shotRoom(SHOT_HOME, 'up'), 0);
  // hardware: the window IS the crop, device zoom 1, nothing digital
  assert.deepEqual(realise(two, hwCaps), { mode: 'region', deviceZoom: 1, crop: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 }, digitalFactor: 2 });
  // gpu with device zoom: a centred shot is pure device zoom
  assert.deepEqual(realise(two, gpuCaps), { mode: 'device', deviceZoom: 2, crop: { x: 0, y: 0, w: 1, h: 1 }, digitalFactor: 1 });
  // gpu, off-centre: device zoom gives way so the window fits, the crop takes the rest
  const off = realise({ zoom: 2, cx: 0.45, cy: 0.5 }, gpuCaps);
  assert.equal(off.mode, 'device+crop'); assert.equal(off.deviceZoom, 1.6667); assert.ok(Math.abs(off.digitalFactor - 1.2) < 0.001);
  assert.ok(Math.abs(off.crop.x) < 1e-3, 'window sits on the left edge of the zoomed frame'); assert.equal(off.crop.w, 0.8333);
  // beyond the device range the crop tops up
  assert.deepEqual(realise({ zoom: 9, cx: 0.5, cy: 0.5 }, gpuCaps).mode, 'device+crop');
  // no device zoom: the crop does it all
  assert.deepEqual(realise({ zoom: 1.2, cx: 0.5, cy: 0.5 }, cpuNoZoom), { mode: 'digital', deviceZoom: 1, crop: { x: 0.0833, y: 0.0833, w: 0.8333, h: 0.8333 }, digitalFactor: 1.2 });
  assert.equal(unrealisable({ zoom: 2, cx: 0.5, cy: 0.5 }, cpuNoZoom) !== null, true);
  assert.equal(unrealisable({ zoom: 5, cx: 0.5, cy: 0.5 }, hwCaps) !== null, true);
  assert.equal(unrealisable(two, hwCaps), null);
});

test('a zoom is a smooth move between shots: monotonic, ends exactly on target, eased in log space, and releases a pan crop', () => {
  const z = zoomPlan({ profile: deviceProfile, caps: gpuCaps, shot: SHOT_HOME, target: 4, durationMs: 1000, stepMs: 100 });
  assert.equal(z.mode, 'device'); assert.equal(z.steps.length, 10); assert.equal(z.to.zoom, 4); assert.equal(z.releasesCrop, false);
  for (let i = 1; i < z.steps.length; i += 1) assert.ok(z.steps[i].deviceZoom >= z.steps[i - 1].deviceZoom);
  assert.equal(z.steps[z.steps.length - 1].deviceZoom, 4); assert.equal(z.steps[z.steps.length - 1].atMs, 1000);
  assert.deepEqual(z.steps[z.steps.length - 1].crop, [0, 0, 1, 1]);
  const mid = zoomPlan({ profile: deviceProfile, caps: gpuCaps, target: 4, durationMs: 1000, easing: 'linear', stepMs: 500 }).steps[0].deviceZoom;
  assert.ok(Math.abs(mid - 2) < 0.01, `log-space midpoint of 1x..4x is 2x, got ${mid}`);
  // after a pan, zooming to 1x goes home: the crop is released as part of the move, no lingering 1.19x
  const panned = { zoom: 1.1905, cx: 0.433, cy: 0.5 };
  const home = zoomPlan({ profile: deviceProfile, caps: gpuCaps, shot: panned, target: 1, durationMs: 1000, stepMs: 100 });
  assert.equal(home.releasesCrop, true); assert.deepEqual(home.to, { zoom: 1, cx: 0.5, cy: 0.5 });
  assert.deepEqual(home.steps[home.steps.length - 1], { atMs: 1000, deviceZoom: 1, crop: [0, 0, 1, 1] });
  assert.ok(home.steps.every((st) => inFrame(st.crop)));
  // and on the hardware source the same zoom is one region per step
  const hw = zoomPlan({ profile: g35Profile, caps: hwCaps, target: 2, durationMs: 300, stepMs: 100 });
  assert.equal(hw.mode, 'region'); assert.ok(hw.steps.every((st) => st.deviceZoom === 1)); assert.deepEqual(hw.steps[2].crop, [0.25, 0.25, 0.5, 0.5]);
});

test('pan at 1x: tightens to the pan window and moves in one eased move, nothing snaps', () => {
  const p = panPlan({ direction: 'right', shot: SHOT_HOME, caps: hwCaps, durationMs: 3000, stepMs: 100 });
  assert.equal(p.refused, false); assert.equal(p.path, 'tighten-pan'); assert.equal(p.tightened, true); assert.equal(p.zoom, 1.1905); assert.equal(p.window, 0.84);
  assert.equal(p.travelRequested, 0.0672); assert.equal(p.travel, 0.0672); assert.equal(p.room, 0.08);
  assert.equal(p.steps.length, 30);
  assert.ok(p.steps[0].crop[2] > 0.99, 'first step is almost the full frame');
  for (let i = 1; i < p.steps.length; i += 1) {
    const a = p.steps[i - 1].crop; const b = p.steps[i].crop;
    assert.ok(b[2] <= a[2] + 1e-9, 'window only shrinks');
    assert.ok(b[0] + b[2] / 2 >= a[0] + a[2] / 2 - 1e-9, 'centre only moves right');
    assert.ok(Math.abs(b[2] - a[2]) < 0.03, 'no step changes the window by more than a few percent');
  }
  assert.ok(p.steps.every((st) => inFrame(st.crop)));
  assert.deepEqual(p.to, { zoom: 1.1905, cx: 0.5672, cy: 0.5 });
  // on the gpu source the same pan trades device zoom for crop on the same frames (the old pull-back, now implicit)
  const g = panPlan({ direction: 'right', shot: SHOT_HOME, caps: gpuCaps, durationMs: 300, stepMs: 100 });
  assert.equal(g.mode, 'device+crop'); assert.ok(g.steps.every((st) => st.deviceZoom >= 1 && st.deviceZoom <= 1.2));
  assert.ok(g.realised.digitalFactor <= DIGITAL_ZOOM_MAX + 1e-4);
});

test('pan at 2x measures from the shot: a fixed share of the visible frame, no tightening', () => {
  const two = { zoom: 2, cx: 0.5, cy: 0.5 };
  const p = panPlan({ direction: 'left', shot: two, caps: hwCaps, durationMs: 300, stepMs: 100 });
  assert.equal(p.path, 'pan'); assert.equal(p.tightened, false); assert.equal(p.travel, 0.04); assert.equal(p.room, 0.25);
  assert.deepEqual(p.to, { zoom: 2, cx: 0.46, cy: 0.5 });
  assert.deepEqual(p.steps[2].crop, [0.21, 0.25, 0.5, 0.5]);
  // a second pan starts from the shot the first one left
  const q = panPlan({ direction: 'up', shot: p.to, caps: hwCaps, durationMs: 300, stepMs: 100 });
  assert.deepEqual(q.from, p.to); assert.deepEqual(q.to, { zoom: 2, cx: 0.46, cy: 0.46 });
  assert.equal(panPlan({ direction: 'down', degree: 0.5, shot: two, caps: hwCaps, durationMs: 100, stepMs: 100 }).travel, 0.25);
  assert.throws(() => panPlan({ direction: 'sideways', shot: two, caps: hwCaps }));
  assert.throws(() => panPlan({ direction: 'left', shot: two }));
});

test('a pan into a frame edge is refused with a reason, and the shot is untouched', () => {
  const atEdge = { zoom: 1.1905, cx: 0.4328, cy: 0.5 };
  const r = panPlan({ direction: 'left', shot: atEdge, caps: hwCaps, durationMs: 300, stepMs: 100 });
  assert.equal(r.refused, true); assert.match(r.reason, /^at frame edge: left has 0.0128 of the frame left and this pan needs 0.0672$/);
  assert.equal(r.travel, 0); assert.equal(r.travelRequested, 0.0672); assert.deepEqual(r.steps, []); assert.equal(r.to, null); assert.deepEqual(r.from, atEdge);
  // the way back is open
  assert.equal(panPlan({ direction: 'right', shot: atEdge, caps: hwCaps, durationMs: 300, stepMs: 100 }).refused, false);
  // on a gpu/cpu source a pan can also be refused by the digital cap: device zoom is centred, so a far off-centre window needs more crop than 1.2x
  const far = panPlan({ direction: 'left', degree: 0.5, shot: { zoom: 2, cx: 0.5, cy: 0.5 }, caps: gpuCaps, durationMs: 300, stepMs: 100 });
  assert.equal(far.refused, true); assert.match(far.reason, /past the 1.2x cap/);
  // and without device zoom a 2x shot cannot even be held
  assert.match(panPlan({ direction: 'left', shot: { zoom: 2, cx: 0.5, cy: 0.5 }, caps: cpuNoZoom, durationMs: 300, stepMs: 100 }).reason, /no device zoom/);
});

test('pan defaults are clearly visible and the same share of the picture at every zoom', () => {
  assert.equal(PAN_DEFAULTS.degree, 0.08); assert.equal(PAN_DEFAULTS.window, 0.84);
  const one = panPlan({ direction: 'left', shot: SHOT_HOME, caps: hwCaps });
  assert.ok(one.travel >= 0.06, 'default travel at 1x is at least 6% of the frame');
  assert.ok(one.travel / one.window > 0.079 && one.travel / one.window < 0.081, 'eight percent of the visible frame');
  const two = panPlan({ direction: 'left', shot: { zoom: 2, cx: 0.5, cy: 0.5 }, caps: hwCaps });
  assert.ok(Math.abs(two.travel * 2 - 0.08) < 1e-3, 'eight percent of the visible frame at 2x too');
});

test('tightness is the fraction of the wide reference field of view', () => {
  assert.equal(tightnessFor(2), 0.5); assert.equal(tightnessFor(2, 2), 1);
});

test('commands and acks round-trip through the wire format with every timestamp', () => {
  const cmd = zoomCommand({ target: 2, durationMs: 1500, decidedAt: 1000 });
  cmd.sentAt = 1002;
  const bytes = encode(cmd);
  assert.ok(bytes instanceof Uint8Array);
  const back = decode(bytes);
  assert.equal(back.type, 'zoom'); assert.equal(back.target, 2); assert.equal(back.id, cmd.id); assert.equal(back.decisionId, cmd.decisionId);
  const reply = ack({ command: back, receivedAt: 1050, startedAt: 1052, completedAt: 2552, result: { mode: 'device', requested: 2, achieved: 2, clamped: false, reason: null, lens: '2', lensSwitch: true, droppedFrames: 0, actualDurationMs: 1500 } });
  assert.deepEqual(reply.timestamps, { decided: 1000, sent: 1002, received: 1050, started: 1052, completed: 2552 });
  assert.equal(decode(encode(reply)).forType, 'zoom');
  const pan = panCommand({ direction: 'up', decidedAt: 5 });
  assert.equal(pan.type, 'pan'); assert.equal(pan.window, PAN_DEFAULTS.window); assert.equal(pan.degree, PAN_DEFAULTS.degree);
  assert.throws(() => decode(encode({ v: 99, type: 'zoom' })));
  assert.equal(roundTripMs(100, 130), 30); assert.equal(roundTripMs(100, 90), 0);
  assert.equal(TOPIC, 'loud.camera');
});

test('clock offset picks the lowest-RTT sample and bounds the error by half of it', () => {
  const o = pickOffset([
    { sentMs: 1000, receivedMs: 1400, rttMs: 400, serverMs: 9000 },
    { sentMs: 2000, receivedMs: 2040, rttMs: 40, serverMs: 9020 + 1000 },
    { sentMs: 3000, receivedMs: 3100, rttMs: 100, serverMs: 11050 },
  ]);
  assert.equal(o.offsetMs, 10020 - 2020); assert.equal(o.errorBoundMs, 20); assert.equal(o.rttMs, 40); assert.equal(o.samples, 3);
  assert.equal(pickOffset([]), null);
  assert.equal(toServerMs(100, o), 100 + o.offsetMs); assert.equal(toServerMs(100, null), null);
});

test('measureOffset survives failed samples and uses the injected fetch', async () => {
  let t = 0; const now = () => (t += 10);
  let calls = 0;
  const fetchImpl = async () => { calls += 1; if (calls === 2) throw new Error('net'); return { ok: true, json: async () => ({ serverMs: 50_000 + calls }) }; };
  const o = await measureOffset({ base: 'http://x', fetchImpl, now, samples: 3 });
  assert.equal(calls, 3); assert.ok(o); assert.equal(o.samples, 2); assert.equal(o.errorBoundMs, 5);
});

test('capture buffer: state on change or every 500 ms, decisions as intent+result, bounded, drains to NDJSON', () => {
  let t = 1000; const now = () => t;
  const b = new CaptureBuffer({ deviceId: 'dev-1', sessionId: 'ses-1', now, offset: { offsetMs: 7, errorBoundMs: 3 } });
  assert.ok(b.profile({ make: 'x' }));
  assert.ok(b.state({ zoom: 1 }));
  t += 100; assert.equal(b.state({ zoom: 1 }), null);           // unchanged, not due
  t += 100; assert.ok(b.state({ zoom: 1.1 }));                  // changed
  t += STATE_SAMPLE_MS; assert.equal(b.state({ zoom: 1.1 }).reason, 'sample');
  b.intent('dec-1', { type: 'zoom', target: 2 }); b.result('dec-1', { kind: 'zoom', mode: 'device', achieved: 2 });
  b.clock({ offsetMs: 7, errorBoundMs: 3, rttMs: 6, samples: 5 });
  const batch = b.drain();
  assert.equal(batch.records, 7); assert.equal(b.records.length, 0);
  const lines = batch.text.trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lines[0].stream, 'B2'); assert.equal(lines[0].t_server_ms, 1007); assert.equal(lines[0].clock_error_ms, 3);
  assert.deepEqual(lines.filter((l) => l.stream === 'B5').map((l) => l.kind), ['intent', 'result'], 'the native result\'s own kind never overwrites the record kind');
  assert.equal(lines[5].decision_id, 'dec-1'); assert.equal(lines[5].move_kind, 'zoom'); assert.equal(lines[5].achieved, 2);
  assert.equal(lines[6].stream, 'B12');
  assert.match(batch.name, /^dev-1-ses-1-1-7\.ndjson$/);
  assert.equal(b.drain(), null);
  b.enabled = false; assert.equal(b.state({ zoom: 9 }, { force: true }), null);
  b.enabled = true;
  for (let i = 0; i < MAX_BUFFER_RECORDS + 5; i += 1) b.cost({ i });
  assert.equal(b.records.length, MAX_BUFFER_RECORDS); assert.equal(b.dropped, 5);
});

test('upload timing: never during a move, never when off, once a minute otherwise, or forced', () => {
  const base = { now: 100_000, lastUploadAt: 100_000 - BATCH_EVERY_MS, moving: false, enabled: true, buffered: 10 };
  assert.equal(uploadDue(base), true);
  assert.equal(uploadDue({ ...base, moving: true }), false);
  assert.equal(uploadDue({ ...base, enabled: false }), false);
  assert.equal(uploadDue({ ...base, buffered: 0 }), false);
  assert.equal(uploadDue({ ...base, lastUploadAt: 100_000 - 1000 }), false);
  assert.equal(uploadDue({ ...base, lastUploadAt: 100_000 - 1000, forced: true }), true);
  assert.equal(objectPath({ userId: 'u', deviceId: 'd', batchName: 'b.ndjson', startedAt: Date.UTC(2026, 9, 12, 10) }), 'u/2026-10-12/d/b.ndjson.gz');
});

test('profile normalisation derives the active mode and a stable survey file name', () => {
  const p = normaliseProfile({ make: 'Google', model: 'Pixel 8', os: 'android', osVersion: '15', deviceZoom: { available: true, min: 0.5, max: 7.5, switchOverFactors: [2] }, lenses: [{ id: '0' }] }, { appVersion: '0.1.0' });
  assert.equal(p.activeMode, 'device'); assert.equal(p.deviceZoom.max, 7.5); assert.deepEqual(p.deviceZoom.switchOverFactors, [2]); assert.equal(p.appVersion, '0.1.0');
  assert.equal(surveyFileName(p), 'capability-google-pixel-8-android-15.json');
  const q = normaliseProfile({ make: 'X', deviceZoom: { available: true, min: 1, max: 1 } });
  assert.equal(q.activeMode, 'digital'); assert.match(q.activeModeReason, /capped at 1.2x/); assert.equal(q.deviceZoom.reason, 'zoom range is 1.0 to 1.0');
  assert.equal(normaliseProfile(null).activeMode, 'digital');
  assert.equal(normaliseProfile(null).qualityCeiling.zoom, null);
});

test('capability profile: zoom ranges say what is optical and what is sensor crop, and the 1080p ceiling follows the sensor', () => {
  // the Moto G35: one back lens, 4080 px wide active array (4:3), 1-4x all ISP crop
  const g35 = normaliseProfile({
    make: 'motorola', model: 'moto g35 5G', os: 'android', osVersion: '15', primaryCameraId: '0',
    deviceZoom: { available: true, min: 1, max: 4, switchOverFactors: [], opticalMaxZoom: 1 },
    lenses: [{ id: '0', facing: 'back', focalLengthMm: 4.7, sensor: { activeArray: { width: 4080, height: 3072 }, croppingType: 'freeform', maxDigitalZoom: 4, apertures: [1.8] }, physicalLenses: [], frameSource: { eligible: 'hardware', reason: 'FREEFORM crop region, max digital zoom 4.0' } }],
  });
  assert.deepEqual(g35.zoomRanges, [{ from: 1, to: 4, kind: 'sensor-crop', lensId: '0', sensorPx: { width: 4080, height: 3072 } }]);
  assert.equal(bandWidthPx({ width: 4080, height: 3072 }), 4080);
  assert.equal(g35.qualityCeiling.zoom, 2.1); assert.match(g35.qualityCeiling.reason, /beyond 2.1x the sensor crop feeding 1080p is narrower than 1920 px/);
  assert.deepEqual(g35.qualityCeiling.basis, [{ lensId: '0', baseZoom: 1, sensorWidthPx: 4080, bandWidthPx: 4080, ceiling: 2.1 }]);
  assert.equal(g35.frameSource.eligible, 'hardware'); assert.match(g35.activeModeReason, /ceiling 2.1x/);
  // a two-lens phone: wide 1x (4000 px) and a 2x tele (3000 px): crop on the wide to 2x, switch, crop on the tele to 8x
  const duo = { id: '0', focalLengthMm: 5, physicalLenses: [{ id: '2', focalLengthMm: 10, sensor: { activeArray: { width: 3000, height: 2250 } } }, { id: '1', focalLengthMm: 5, sensor: { activeArray: { width: 4000, height: 3000 } } }] };
  const dz = { available: true, min: 0.6, max: 8 };
  assert.deepEqual(zoomRanges(duo, dz).map((r) => [r.from, r.to, r.kind, r.lensId]), [[0.6, 1, 'sensor-crop', '1'], [1, 2, 'sensor-crop', '1'], [2, 2, 'optical-switch', '2'], [2, 8, 'sensor-crop', '2']]);
  const c = qualityCeiling(duo, dz);
  assert.equal(c.zoom, 3.1, 'the tele at 2x with a 3000 px band holds 1080p to 3.1x');
  assert.deepEqual(c.basis.map((b) => [b.lensId, b.baseZoom, b.ceiling]), [['1', 1, 2], ['2', 2, 3.1]]);
  // a tall active array: the 16:9 band is cut by the height
  assert.equal(bandWidthPx({ width: 4000, height: 1000 }), 1778);
  // no sensor size: no ceiling, the device range applies
  assert.equal(qualityCeiling({ id: '0' }, dz).zoom, null);
});

test('ack latencies: the move cycle includes the move, the two network legs come from the server-clock timestamps', () => {
  const a = { timestamps: { decided: 10_000, sent: 10_000, received: 10_030, started: 10_031, completed: 12_050 } };
  const lat = ackLatencies(a, { sentLocal: 500, arrivedLocal: 2_600, arrivedServer: 12_081 });
  assert.deepEqual(lat, { moveCycleMs: 2100, commandLatencyMs: 30, ackLegMs: 31, moveMs: 2019 });
  assert.deepEqual(ackLatencies(a, { sentLocal: 500, arrivedLocal: 2_600, arrivedServer: null }).ackLegMs, null);
  const sum = summariseLatencies([lat, { ...lat, moveCycleMs: 3100, commandLatencyMs: 40 }]);
  assert.deepEqual(sum.moveCycleMs, { n: 2, p50: 3100, p90: 3100, max: 3100 }); assert.deepEqual(sum.commandLatencyMs, { n: 2, p50: 40, p90: 40, max: 40 });
  assert.equal(summariseLatencies([]), null);
});
