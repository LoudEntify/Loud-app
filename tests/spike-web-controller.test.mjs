// The laptop Controller (lib/spike/controllerSession.js) driven end to end
// in node: a fake room, a fake API, a fake clock. What it proves: the
// commands on the wire are the phone's (same module, same fields), acks
// are matched and timed the same way, the report has the phone's keys,
// and the batch upload goes through the same signed-URL route.
import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync, gunzipSync } from 'node:zlib';
import { WebControllerSession, browserDeviceId, browserProfile, absoluteUploadUrl, EVENTS, ROLE } from '../lib/spike/controllerSession.js';
import { TOPIC, decode, encode, ack } from '../native/src/spike/commands.js';
import { clockUpstreamBase, fetchUpstreamClock } from '../lib/spike/clockUpstream.js';

const UA_MAC_CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const UA_WIN_FIREFOX = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0';
const UA_SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
const DEVICE_RE = /^[a-z0-9][a-z0-9-]{3,63}$/; // what /api/spike/upload-url accepts

function fakeRoom() {
  const handlers = new Map();
  const published = [];
  const room = {
    connected: null, disconnected: false,
    on(event, fn) { handlers.set(event, fn); return room; },
    emit(event, ...args) { handlers.get(event)?.(...args); },
    async connect(url, token) { room.connected = { url, token }; },
    async disconnect() { room.disconnected = true; },
    localParticipant: { async publishData(bytes, opts) { published.push({ bytes, opts }); } },
  };
  return { room, published };
}

function fakeApi({ serverSkewMs = 1000, now }) {
  const calls = [];
  const json = (status, body) => ({ ok: status < 300, status, json: async () => body });
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.endsWith('/api/spike/clock')) return json(200, { serverMs: now() + serverSkewMs });
    if (url.endsWith('/api/spike/token')) {
      assert.equal(init.method, 'POST');
      assert.equal(init.headers.authorization, 'Bearer tok-artist');
      assert.deepEqual(JSON.parse(init.body), { role: 'controller' });
      return json(200, { token: 'lk-jwt', url: 'wss://lk.example', room: 'rehearsal-u1', identity: 'spike-controller-ab12', role: 'controller', ttl: '30m' });
    }
    if (url.endsWith('/api/spike/upload-url')) {
      const body = JSON.parse(init.body);
      assert.match(body.name, /\.(ndjson\.gz|json)$/); // what /api/spike/upload-url accepts: a batch or a report
      assert.match(body.deviceId, DEVICE_RE);
      return json(200, { bucket: 'director-spike', path: `u1/2026-10-12/${body.deviceId}/${body.name}`, signedUrl: `/object/upload/sign/director-spike/u1/${body.name}?token=x` });
    }
    if (init.method === 'PUT') return json(200, { Key: 'ok' });
    return json(404, { error: `unexpected ${url}` });
  };
  return { fetchImpl, calls };
}

function makeSession({ ua = UA_MAC_CHROME, onEvent } = {}) {
  let t = 100_000; const now = () => t; const advance = (ms) => { t += ms; };
  const { room, published } = fakeRoom();
  const { fetchImpl, calls } = fakeApi({ now });
  const timers = [];
  const s = new WebControllerSession({
    accessToken: 'tok-artist', userId: 'u1', onEvent,
    supabaseUrl: 'https://proj.supabase.co', appVersion: 'web-test', userAgent: ua,
    createRoom: () => room, fetchImpl, gzip: async (text) => new Uint8Array(gzipSync(Buffer.from(text, 'utf8'))), now,
    setIntervalImpl: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearIntervalImpl: () => {},
  });
  return { s, room, published, calls, now, advance, timers };
}

test('deviceId and profile come from the user agent and fit the upload route', () => {
  assert.equal(browserDeviceId(UA_MAC_CHROME), 'web-chrome-141-mac-10-15');
  assert.equal(browserDeviceId(UA_WIN_FIREFOX), 'web-firefox-132-windows-10');
  assert.equal(browserDeviceId(UA_SAFARI), 'web-safari-17-mac-14-5');
  assert.equal(browserDeviceId(''), 'web-browser-os');
  for (const ua of [UA_MAC_CHROME, UA_WIN_FIREFOX, UA_SAFARI, '']) assert.match(browserDeviceId(ua), DEVICE_RE);
  const p = browserProfile(UA_MAC_CHROME, 'web-abc');
  assert.equal(p.platform, 'web'); assert.equal(p.make, 'chrome'); assert.equal(p.model, 'chrome 141'); assert.equal(p.os, 'mac'); assert.equal(p.osVersion, '10.15');
  assert.equal(p.deviceZoom.available, false); assert.equal(p.appVersion, 'web-abc');
});

test('absoluteUploadUrl matches the phone runtime', () => {
  assert.equal(absoluteUploadUrl('https://x/y'), 'https://x/y');
  assert.equal(absoluteUploadUrl('/object/upload/sign/a', 'https://p.supabase.co/'), 'https://p.supabase.co/storage/v1/object/upload/sign/a');
  assert.equal(absoluteUploadUrl('/storage/v1/object/x', 'https://p.supabase.co'), 'https://p.supabase.co/storage/v1/object/x');
  assert.equal(absoluteUploadUrl(null), null);
});

test('session needs a room factory and a token', () => {
  assert.throws(() => new WebControllerSession({ accessToken: 't' }), /createRoom/);
  assert.throws(() => new WebControllerSession({ createRoom: () => ({}) }), /accessToken/);
});

test('connect: clock first, then the controller token, then the room; events reach the screen', async () => {
  const events = [];
  const { s, room, calls } = makeSession({ onEvent: (k, p) => events.push([k, p]) });
  await s.connect();
  assert.equal(s.role, ROLE);
  assert.ok(s.offset); assert.equal(s.offset.offsetMs, 1000); // fake clock: server is 1 s ahead, zero rtt
  assert.deepEqual(room.connected, { url: 'wss://lk.example', token: 'lk-jwt' });
  assert.deepEqual(s.connected, { room: 'rehearsal-u1', identity: 'spike-controller-ab12' });
  const kinds = events.map(([k]) => k);
  assert.deepEqual(kinds.slice(0, 2), ['profile', 'clock']);
  assert.ok(kinds.includes('connected'));
  const clockCalls = calls.filter((c) => c.url.endsWith('/api/spike/clock')).length;
  assert.equal(clockCalls, 5);
  assert.ok(calls.findIndex((c) => c.url.endsWith('/api/spike/clock')) < calls.findIndex((c) => c.url.endsWith('/api/spike/token')));
  // the remote camera track is surfaced; audio is not
  room.emit(EVENTS.TrackSubscribed, { kind: 'audio' }, { source: 'microphone' }, { identity: 'spike-camera-1' });
  assert.equal(s.remoteTrack, null);
  room.emit(EVENTS.TrackSubscribed, { kind: 'video' }, { source: 'camera' }, { identity: 'spike-camera-1' });
  assert.equal(s.remoteTrack.participant.identity, 'spike-camera-1');
  room.emit(EVENTS.TrackUnsubscribed, { kind: 'video' });
  assert.equal(s.remoteTrack, null);
  await s.stop();
  assert.equal(room.disconnected, true);
});

test('connect fails cleanly when the token route refuses', async () => {
  const { s } = makeSession();
  s.fetch = async (url) => (url.endsWith('/api/spike/clock') ? { ok: true, status: 200, json: async () => ({ serverMs: 1 }) } : { ok: false, status: 403, json: async () => ({ error: 'The spike token route is only available where the dev harness is allowed.' }) });
  await assert.rejects(s.connect(), /dev harness/);
  assert.equal(s.room, null);
});

test('zoom and pan go out as the phone protocol with server-clock timestamps; acks are matched and timed', async () => {
  const events = [];
  const { s, room, published, now, advance } = makeSession({ onEvent: (k, p) => events.push([k, p]) });
  await s.connect();
  const cmd = await s.zoom(2, 2000);
  assert.equal(published.length, 1);
  assert.deepEqual(published[0].opts, { reliable: true, topic: TOPIC });
  const wire = decode(published[0].bytes);
  assert.equal(wire.v, 1); assert.equal(wire.type, 'zoom'); assert.equal(wire.target, 2); assert.equal(wire.durationMs, 2000); assert.equal(wire.easing, 'ease-in-out');
  assert.equal(wire.source, 'main-device'); assert.equal(wire.id, cmd.id); assert.equal(wire.decisionId, cmd.decisionId);
  assert.equal(wire.sentAt, now() + 1000); assert.equal(wire.decidedAt, now() + 1000); // server clock, not Date.now()
  assert.ok(s.pending.has(cmd.id));

  // the camera phone replies 180 ms later
  advance(180);
  const reply = ack({ command: wire, receivedAt: wire.sentAt + 60, startedAt: wire.sentAt + 62, completedAt: wire.sentAt + 2062, result: { mode: 'device', requested: 2, achieved: 2, clamped: false, reason: null, lens: '0', lensSwitch: false, droppedFrames: 0, actualDurationMs: 2000 } });
  room.emit(EVENTS.DataReceived, encode(reply), { identity: 'spike-camera-9' }, undefined, TOPIC);
  assert.equal(s.pending.size, 0);
  const got = events.find(([k]) => k === 'ack')[1];
  assert.equal(got.moveCycleMs, 180, 'the whole cycle, move included'); assert.equal(got.command.id, cmd.id); assert.equal(got.ack.timestamps.completed - got.ack.timestamps.decided, 2062);
  assert.equal(got.commandLatencyMs, got.ack.timestamps.received - got.ack.timestamps.sent, 'the network leg out, server clock');
  assert.deepEqual(s.latencySummary().moveCycleMs, { n: 1, p50: 180, p90: 180, max: 180 });

  const pan = await s.pan('left');
  const pw = decode(published[1].bytes);
  assert.equal(pw.type, 'pan'); assert.equal(pw.direction, 'left'); assert.equal(pw.degree, 0.08); assert.equal(pw.window, 0.84); assert.equal(pw.durationMs, 3000); assert.equal(pw.id, pan.id);
  const fast = await s.zoom(1, 400, 'ease-out');
  assert.equal(decode(published[2].bytes).easing, 'ease-out'); assert.equal(fast.durationMs, 400);

  // noise is ignored: another topic, a command (not an ack), an ack nobody sent, garbage
  room.emit(EVENTS.DataReceived, encode(reply), { identity: 'x' }, undefined, 'other.topic');
  room.emit(EVENTS.DataReceived, published[1].bytes, { identity: 'x' }, undefined, TOPIC);
  room.emit(EVENTS.DataReceived, encode({ ...reply, id: 'cmd-unknown' }), { identity: 'x' }, undefined, TOPIC);
  room.emit(EVENTS.DataReceived, new Uint8Array([1, 2, 3]), { identity: 'x' }, undefined, TOPIC);
  assert.equal(s.pending.size, 2); assert.equal(s.latencies.length, 1);
  await s.stop();
});

test('the soak alternates zoom in, pan, zoom out, pan like the phone and stops at the end', async () => {
  const { s, published, advance, timers } = makeSession();
  await s.connect();
  s.startSoak(20);
  const soakTimer = timers.find((t) => t.ms === 30000);
  assert.ok(soakTimer);
  for (let i = 0; i < 3; i += 1) { advance(30000); soakTimer.fn(); }
  await Promise.resolve();
  const types = published.map((p) => decode(p.bytes)).map((m) => (m.type === 'zoom' ? `zoom${m.target}` : `pan-${m.direction}`));
  assert.deepEqual(types, ['zoom2', 'pan-left', 'zoom1', 'pan-up']);
  advance(21 * 60000); soakTimer.fn();
  assert.equal(s.soak, null);
  assert.equal(published.length, 4);
  await s.stop();
});

test('report has the phone report keys; stop uploads the controller batch through the signed URL', async () => {
  const { s, room, calls, advance } = makeSession();
  await s.connect();
  const cmd = await s.zoom(5, 2000);
  advance(90);
  room.emit(EVENTS.DataReceived, encode(ack({ command: { ...cmd }, receivedAt: 1, startedAt: 2, completedAt: 3, result: { kind: 'zoom', mode: 'device', requested: 5, achieved: 5, clamped: false, reason: null, droppedFrames: 1, actualDurationMs: 2000 } })), { identity: 'spike-camera-2' }, undefined, TOPIC);
  await s.stop();
  const put = calls.find((c) => c.init.method === 'PUT');
  assert.ok(put, 'the last batch was uploaded on stop');
  assert.equal(put.url, 'https://proj.supabase.co/storage/v1/object/upload/sign/director-spike/u1/' + put.url.split('/').pop());
  assert.equal(put.init.headers['content-type'], 'application/gzip');
  const lines = gunzipSync(Buffer.from(put.init.body)).toString('utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(lines.map((l) => l.stream), ['B2', 'B12', 'B5', 'B5']);
  assert.equal(lines[2].kind, 'intent'); assert.equal(lines[2].decision_id, cmd.decisionId); assert.equal(lines[2].tightness, 0.2);
  assert.equal(lines[3].kind, 'result'); assert.equal(lines[3].move_cycle_ms, 90); assert.equal(lines[3].move_kind, 'zoom'); assert.equal(lines[3].from, 'spike-camera-2');
  // B2 is recorded before the first clock sync (same order as the phone), so only it lacks a server timestamp
  assert.equal(lines[0].t_server_ms, null);
  assert.ok(lines.slice(1).every((l) => Number.isFinite(l.t_server_ms)));

  const r = s.report();
  assert.deepEqual(Object.keys(r), ['role', 'deviceId', 'sessionId', 'appVersion', 'frameSource', 'profile', 'clock', 'latency', 'shots', 'cost', 'storage', 'uploads', 'lastState', 'writtenAt', 'reportUpload']);
  assert.equal(r.role, 'controller'); assert.equal(r.deviceId, 'web-chrome-141-mac-10-15'); assert.equal(r.appVersion, 'web-test');
  assert.equal(r.latency.moveCycleMs.n, 1); assert.deepEqual(r.cost, { on: null, off: null, samples: 0 });
  assert.equal(r.storage.batches, 1); assert.equal(r.storage.failed, 0); assert.equal(r.storage.records, 4);
  assert.equal(r.uploads[0].ok, true); assert.equal(r.lastState, null);
  assert.match(s.reportFileName(), /^spike-report-controller-web-chrome-141-mac-10-15-\d+\.json$/);
});

test('a refused upload is recorded, not thrown', async () => {
  const events = [];
  const { s } = makeSession({ onEvent: (k, p) => events.push([k, p]) });
  await s.connect();
  const base = s.fetch;
  s.fetch = async (url, init) => (url.endsWith('/api/spike/upload-url') ? { ok: false, status: 503, json: async () => ({ error: 'Bucket "director-spike" does not exist on this project.' }) } : base(url, init));
  await s.zoom(2);
  await s.stop();
  const up = events.find(([k]) => k === 'upload')[1];
  assert.equal(up.ok, false); assert.match(up.error, /director-spike/);
  assert.equal(s.report().storage.failed, 1);
});

test('clock relay: local only, absolute URL, trailing slash stripped, empty means off', () => {
  assert.equal(clockUpstreamBase({}), null);
  assert.equal(clockUpstreamBase({ NEXT_PUBLIC_SPIKE_CLOCK_BASE: '  ' }), null);
  assert.equal(clockUpstreamBase({ NEXT_PUBLIC_SPIKE_CLOCK_BASE: 'https://staging.example/' }), 'https://staging.example');
  assert.equal(clockUpstreamBase({ NEXT_PUBLIC_SPIKE_CLOCK_BASE: 'https://staging.example', VERCEL: '1' }), null);
  assert.equal(clockUpstreamBase({ NEXT_PUBLIC_SPIKE_CLOCK_BASE: 'https://staging.example', VERCEL_ENV: 'preview' }), null);
  assert.throws(() => clockUpstreamBase({ NEXT_PUBLIC_SPIKE_CLOCK_BASE: 'staging.example' }), /absolute/);
});

test('clock relay: passes serverMs through and turns every failure into a dropped sample, never a throw', async () => {
  const ok = await fetchUpstreamClock('https://s', { fetchImpl: async (url, init) => { assert.equal(url, 'https://s/api/spike/clock'); assert.equal(init.cache, 'no-store'); return { ok: true, status: 200, json: async () => ({ serverMs: 123 }) }; } });
  assert.deepEqual(ok, { ok: true, serverMs: 123 });
  const limited = await fetchUpstreamClock('https://s', { fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({ error: 'Too many requests' }) }) });
  assert.equal(limited.ok, false); assert.equal(limited.status, 429); assert.match(limited.error, /Too many/);
  const html = await fetchUpstreamClock('https://s', { fetchImpl: async () => ({ ok: true, status: 200, json: async () => { throw new Error('not json'); } }) });
  assert.equal(html.ok, false); assert.match(html.error, /answered 200/);
  const net = await fetchUpstreamClock('https://s', { fetchImpl: async () => { throw new Error('ENOTFOUND'); } });
  assert.equal(net.ok, false); assert.equal(net.status, 502); assert.match(net.error, /ENOTFOUND/);
});

test('a relayed clock still yields a correct offset on the laptop: the round trip brackets the whole relay', async () => {
  // The laptop's clock.js only sees the local route; the local route awaits staging. Simulate both.
  let t = 0; const now = () => t;
  const staging = async () => { t += 40; return { ok: true, status: 200, json: async () => ({ serverMs: 5_000_000 + t }) }; }; // staging is 5,000 s ahead
  const localRoute = async () => { t += 5; const r = await fetchUpstreamClock('https://s', { fetchImpl: staging }); t += 5; return { ok: r.ok, status: 200, json: async () => ({ serverMs: r.serverMs, via: 'https://s' }) }; };
  const { measureOffset } = await import('../native/src/spike/clock.js');
  const o = await measureOffset({ base: '', fetchImpl: localRoute, now, samples: 3 });
  assert.equal(o.rttMs, 50);                 // 5 + 40 + 5, the whole trip
  assert.equal(o.errorBoundMs, 25);
  assert.ok(Math.abs(o.offsetMs - 5_000_000) <= 25); // within the bound of the true 5,000 s
});

test('the controller report is also uploaded to the bucket as JSON, and a refusal is recorded', async () => {
  const events = [];
  const { s, calls } = makeSession({ onEvent: (k, p) => events.push([k, p]) });
  await s.connect();
  await s.stop();
  const name = s.reportFileName();
  const up = await s.uploadReport(name);
  assert.equal(up.ok, true); assert.equal(up.name, name); assert.match(up.path, /spike-report-controller-web-chrome-141-mac-10-15-\d+\.json$/);
  const put = calls.filter((c) => c.init.method === 'PUT').pop();
  assert.equal(put.init.headers['content-type'], 'application/json');
  const body = JSON.parse(put.init.body);
  assert.equal(body.role, 'controller'); assert.equal(body.deviceId, 'web-chrome-141-mac-10-15');
  assert.equal(s.report().reportUpload.ok, true);
  assert.equal(events.filter(([k]) => k === 'reportUpload').length, 1);
  const base = s.fetch;
  s.fetch = async (url, init) => (url.endsWith('/api/spike/upload-url') ? { ok: false, status: 503, json: async () => ({ error: 'Bucket "director-spike" does not exist on this project.' }) } : base(url, init));
  const refused = await s.uploadReport();
  assert.equal(refused.ok, false); assert.match(refused.error, /director-spike/);
});
