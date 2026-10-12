// Unit tests for the platform-free spike modules in native/src/spike.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseZoomMode, rampSchedule, panPlan, ease, tightnessFor, DIGITAL_ZOOM_MAX, PAN_DEFAULTS } from '../native/src/spike/zoomPlan.js';
import { zoomCommand, panCommand, ack, encode, decode, roundTripMs, TOPIC } from '../native/src/spike/commands.js';
import { pickOffset, measureOffset, toServerMs } from '../native/src/spike/clock.js';
import { CaptureBuffer, uploadDue, objectPath, BATCH_EVERY_MS, STATE_SAMPLE_MS, MAX_BUFFER_RECORDS } from '../native/src/spike/capture.js';
import { normaliseProfile, surveyFileName } from '../native/src/spike/survey.js';

const deviceProfile = { deviceZoom: { available: true, min: 0.6, max: 8 } };
const fixedProfile = { deviceZoom: { available: false, min: 1, max: 1, reason: 'zoom range is 1 to 1' } };

test('zoom mode: device first, clamped to the device range', () => {
  assert.deepEqual(chooseZoomMode(deviceProfile, 2), { mode: 'device', target: 2, clamped: false, reason: null });
  const over = chooseZoomMode(deviceProfile, 20);
  assert.equal(over.mode, 'device'); assert.equal(over.target, 8); assert.equal(over.clamped, true);
});

test('zoom mode: digital fallback only when device zoom is unavailable, capped at 1.2x', () => {
  const r = chooseZoomMode(fixedProfile, 3);
  assert.equal(r.mode, 'digital'); assert.equal(r.target, DIGITAL_ZOOM_MAX); assert.equal(r.clamped, true);
  assert.match(r.reason, /capped at 1.2x/);
  const small = chooseZoomMode(fixedProfile, 1.1);
  assert.equal(small.target, 1.1); assert.equal(small.clamped, false);
  assert.equal(chooseZoomMode(null, 2).mode, 'digital');
});

test('ramp schedule is monotonic, ends exactly on target, eased in log space', () => {
  const s = rampSchedule({ from: 1, to: 4, durationMs: 1000, stepMs: 100 });
  assert.equal(s.length, 10);
  assert.equal(s[s.length - 1].zoom, 4); assert.equal(s[s.length - 1].atMs, 1000);
  for (let i = 1; i < s.length; i += 1) assert.ok(s[i].zoom >= s[i - 1].zoom);
  const mid = rampSchedule({ from: 1, to: 4, durationMs: 1000, easing: 'linear', stepMs: 500 })[0].zoom;
  assert.equal(mid, 2); // halfway in log space between 1x and 4x is 2x
  assert.equal(ease('ease-in-out', 0.5), 0.5); assert.equal(ease('linear', 0.25), 0.25); assert.equal(ease('ease-out', 1), 1);
});

const inFrame = (st) => st.x >= -1e-4 && st.y >= -1e-4 && st.x + st.w <= 1.0001 && st.y + st.h <= 1.0001;

test('pan with zoom headroom: device zoom ramps out while the window ramps in, framing unchanged, then the window moves', () => {
  const p = panPlan({ direction: 'left', zoomNow: 2, zoomMin: 1, zoomMax: 8, durationMs: 3000, stepMs: 100 });
  assert.equal(p.path, 'pull-back'); assert.equal(p.window, 0.84); assert.equal(p.deviceZoom, 1.68); assert.equal(p.leadInMs, 700);
  assert.equal(p.steps.length, 30);
  const lead = p.steps.filter((st) => st.atMs <= 700);
  assert.ok(lead.length >= 6);
  for (const st of lead) {
    assert.ok(st.deviceZoom != null, 'every lead-in step carries a device zoom');
    assert.ok(Math.abs(st.deviceZoom / st.w - 2) < 0.01, `field of view constant during the lead-in: ${st.deviceZoom}/${st.w}`);
    assert.ok(Math.abs(st.x + st.w / 2 - 0.5) < 1e-3, 'window stays centred until it starts to move');
  }
  const lastLead = lead[lead.length - 1];
  assert.equal(lastLead.w, 0.84); assert.equal(lastLead.deviceZoom, 1.68);
  // the first step was not a snap: the window is still almost the full frame
  assert.ok(p.steps[0].w > 0.99 && p.steps[0].deviceZoom > 1.98);
  const move = p.steps.filter((st) => st.atMs > 700);
  for (let i = 1; i < move.length; i += 1) { assert.ok(move[i].x <= move[i - 1].x + 1e-9, 'moves left monotonically'); assert.equal(move[i].w, 0.84); }
  const last = p.steps[p.steps.length - 1];
  assert.equal(last.atMs, 3000); assert.equal(last.x, 0); assert.equal(p.travel, 0.08); assert.equal(p.travelRequested, 0.08);
  assert.ok(p.steps.every(inFrame));
});

test('pan without headroom (1x, no wider lens): the window eases in as part of the move, nothing snaps', () => {
  const p = panPlan({ direction: 'right', zoomNow: 1, zoomMin: 1, zoomMax: 8, durationMs: 3000, stepMs: 100 });
  assert.equal(p.path, 'crop-ease'); assert.equal(p.deviceZoom, null); assert.equal(p.leadInMs, 0);
  assert.ok(p.steps.every((st) => st.deviceZoom == null));
  assert.ok(p.steps[0].w > 0.99, 'first step is almost the full frame');
  for (let i = 1; i < p.steps.length; i += 1) {
    assert.ok(p.steps[i].w <= p.steps[i - 1].w + 1e-9, 'window only shrinks');
    assert.ok(p.steps[i].x + p.steps[i].w / 2 >= p.steps[i - 1].x + p.steps[i - 1].w / 2 - 1e-9, 'centre only moves right');
    assert.ok(Math.abs(p.steps[i].w - p.steps[i - 1].w) < 0.03, 'no step changes the window by more than a few percent');
  }
  const last = p.steps[p.steps.length - 1];
  assert.equal(last.w, 0.84); assert.equal(+(last.x + last.w / 2).toFixed(4), 0.58); assert.equal(p.travel, 0.08);
  assert.ok(p.steps.every(inFrame));
  // no device zoom at all (digital fallback profile) takes the same path
  assert.equal(panPlan({ direction: 'up', zoomNow: 1, zoomMin: null, durationMs: 300, stepMs: 100 }).path, 'crop-ease');
  // an ultrawide lens below 1x IS headroom at 1x
  assert.equal(panPlan({ direction: 'up', zoomNow: 1, zoomMin: 0.6, zoomMax: 8, durationMs: 300, stepMs: 100 }).path, 'pull-back');
});

test('a second pan starts from the framing the first one left and just moves', () => {
  const first = panPlan({ direction: 'left', zoomNow: 2, zoomMin: 1, zoomMax: 8, durationMs: 300, stepMs: 100 });
  const left = first.steps[first.steps.length - 1];
  const second = panPlan({ direction: 'up', zoomNow: first.deviceZoom, zoomMin: 1, zoomMax: 8, durationMs: 300, stepMs: 100, cropNow: { x: left.x, y: left.y, w: left.w, h: left.h } });
  assert.equal(second.path, 'pan-only'); assert.equal(second.deviceZoom, null);
  assert.equal(second.steps[0].x, left.x, 'starts where the first pan ended'); assert.equal(second.travel, 0.08);
  // and a pan into the edge it already sits on is clamped to zero travel, not thrown
  const again = panPlan({ direction: 'left', zoomNow: first.deviceZoom, zoomMin: 1, zoomMax: 8, durationMs: 300, stepMs: 100, cropNow: { x: left.x, y: left.y, w: left.w, h: left.h } });
  assert.equal(again.travel, 0); assert.equal(again.travelRequested, 0.08);
});

test('pan defaults are clearly visible and never crop past the digital cap', () => {
  assert.equal(PAN_DEFAULTS.degree, 1); assert.equal(PAN_DEFAULTS.window, 0.84);
  assert.ok(panPlan({ direction: 'left', zoomMin: 1 }).travel >= 0.07, 'default travel is at least 7% of the frame');
  const tight = panPlan({ direction: 'down', window: 0.5, zoomNow: 4, zoomMin: 1, zoomMax: 8, durationMs: 300, stepMs: 100 });
  assert.equal(tight.window, +(1 / DIGITAL_ZOOM_MAX).toFixed(4)); assert.ok(tight.digitalFactor <= DIGITAL_ZOOM_MAX + 1e-4);
  assert.equal(panPlan({ direction: 'down', degree: 0.5, window: 0.9, zoomMin: 1, durationMs: 100, stepMs: 100 }).travel, 0.025);
  assert.throws(() => panPlan({ direction: 'sideways', durationMs: 100 }));
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
  b.intent('dec-1', { type: 'zoom', target: 2 }); b.result('dec-1', { mode: 'device', achieved: 2 });
  b.clock({ offsetMs: 7, errorBoundMs: 3, rttMs: 6, samples: 5 });
  const batch = b.drain();
  assert.equal(batch.records, 7); assert.equal(b.records.length, 0);
  const lines = batch.text.trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lines[0].stream, 'B2'); assert.equal(lines[0].t_server_ms, 1007); assert.equal(lines[0].clock_error_ms, 3);
  assert.deepEqual(lines.filter((l) => l.stream === 'B5').map((l) => l.kind), ['intent', 'result']);
  assert.equal(lines[5].decision_id, 'dec-1');
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
});
