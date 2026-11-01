import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LiveKitEgress, rtmpUrls, fileOutputFor, toHttpUrl } from '../lib/pipeline/livekitEgress.js';
import { goLive } from '../lib/pipeline/lifecycle.js';
import { MockYouTubeApi } from '../lib/youtube/api.js';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// The compositor is the step that was missing: everything around it was
// real — phones publishing into a room, a YouTube broadcast created,
// bound and transitioned live — so a viewer got a player, a LIVE badge
// and a show that never carried a frame. These tests exist because that
// is not a failure any test could have caught: nothing was wrong, there
// was simply nothing sending.

const ENV = {
  LIVEKIT_API_KEY: 'k', LIVEKIT_API_SECRET: 's', LIVEKIT_URL: 'wss://lk.example',
  EGRESS_TEMPLATE_BASE_URL: 'https://loudentify.app/',
};

function fakeClient(calls = []) {
  return {
    calls,
    async listEgress(q) { calls.push(['list', q]); return q.egressId ? [{ egressId: q.egressId, status: 2, error: '' }] : []; },
    async startRoomCompositeEgress(room, outputs, opts) { calls.push(['start', room, outputs, opts]); return { egressId: 'EG_1' }; },
    async updateStream(id, add, remove) { calls.push(['updateStream', id, add, remove]); return {}; },
    async stopEgress(id) { calls.push(['stop', id]); return {}; },
  };
}

test('an ingest url and a key become one RTMP url, joined by exactly one slash', () => {
  // YouTube hands these back separately and rejects a double slash with
  // an error that reads like a bad key.
  assert.deepEqual(rtmpUrls([{ ingestUrl: 'rtmp://a.rtmp.youtube.com/live2', streamKey: 'abcd-1234' }]), ['rtmp://a.rtmp.youtube.com/live2/abcd-1234']);
  assert.deepEqual(rtmpUrls([{ ingestUrl: 'rtmp://a/live2/', streamKey: 'k' }]), ['rtmp://a/live2/k']);
  // A target with no key is dropped, not sent as half a url.
  assert.deepEqual(rtmpUrls([{ ingestUrl: 'rtmp://a/live2' }, { streamKey: 'k' }, null]), []);
});

test('the composite goes out over RTMP, portrait, through our own template', async () => {
  const calls = [];
  const e = new LiveKitEgress({ env: ENV, clientFactory: () => fakeClient(calls) });
  const r = await e.start({ room: 'show-1', performanceMode: 'versus', targets: [{ broadcastId: 'b1', ingestUrl: 'rtmp://a/live2', streamKey: 'key1' }] });
  assert.equal(r.ok, true);
  assert.equal(r.egressId, 'EG_1');
  const [, room, outputs, opts] = calls.find((c) => c[0] === 'start');
  assert.equal(room, 'show-1');
  assert.deepEqual(outputs.stream.urls, ['rtmp://a/live2/key1'], 'the picture is pushed to YouTube — the step that did not exist');
  assert.equal(opts.layout, 'versus');
  assert.equal(opts.customBaseUrl, 'https://loudentify.app/egress', 'our template, not LiveKit\'s stock grid, and no double slash');
  assert.equal(opts.encodingOptions.width, 1080);
  assert.equal(opts.encodingOptions.height, 1920, 'portrait: the shape a phone is held in');
  assert.equal(outputs.file, undefined, 'and no S3 file when storage is not configured, rather than refusing to broadcast');
});

test('a show with nothing to send to does not start a billed composite', async () => {
  // The lifecycle starts a show whether or not YouTube is ready. A
  // composite with no outputs is a headless browser rendering to nowhere.
  const calls = [];
  const e = new LiveKitEgress({ env: ENV, clientFactory: () => fakeClient(calls) });
  const r = await e.start({ room: 'show-1', targets: [] });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no_targets');
  assert.equal(calls.filter((c) => c[0] === 'start').length, 0);
});

test('one composite per room, however many devices ask', async () => {
  // A versus show has two performer devices and either may arrive first;
  // a retry after a slow response is the same situation. Two composites
  // is two bills and two pictures on one key.
  const calls = [];
  const client = fakeClient(calls);
  client.listEgress = async (q) => { calls.push(['list', q]); return [{ egressId: 'EG_EXISTING', status: 2 }]; };
  const e = new LiveKitEgress({ env: ENV, clientFactory: () => client });
  const r = await e.start({ room: 'show-1', targets: [{ ingestUrl: 'rtmp://a/live2', streamKey: 'k' }] });
  assert.equal(r.alreadyActive, true);
  assert.equal(r.egressId, 'EG_EXISTING');
  assert.equal(calls.filter((c) => c[0] === 'start').length, 0);
});

test('a replacement broadcast is added without blanking the picture', async () => {
  // deliveryTick creates a new broadcast when one is abandoned. A
  // restart here would cut off everyone watching the broadcast that is
  // still fine.
  const calls = [];
  const e = new LiveKitEgress({ env: ENV, clientFactory: () => fakeClient(calls) });
  await e.start({ room: 'show-1', targets: [{ ingestUrl: 'rtmp://a/live2', streamKey: 'k1' }] });
  await e.retarget('b2', { ingestUrl: 'rtmp://a/live2', streamKey: 'k2' });
  const [, id, add] = calls.find((c) => c[0] === 'updateStream');
  assert.equal(id, 'EG_1');
  assert.deepEqual(add, ['rtmp://a/live2/k2']);
  assert.equal(calls.filter((c) => c[0] === 'start').length, 1, 'the composite is never restarted');
});

test('an unconfigured server says what is missing, and the show still starts', async () => {
  const e = new LiveKitEgress({ env: {}, clientFactory: () => fakeClient() });
  await assert.rejects(() => e.start({ room: 'r', targets: [{ ingestUrl: 'rtmp://a', streamKey: 'k' }] }), /not configured/);
  assert.equal(e.health().state, 'unconfigured');

  // goLive catches it: a compositor that cannot start must not take the
  // show down with it (ARCHITECTURE §1).
  const api = new MockYouTubeApi();
  const shows = new Map([['s1', { id: 's1', artist_id: 'A', room_name: 'room-1', slated_at: '2026-11-01T20:40:00Z' }]]);
  const broadcasts = [];
  const store = {
    now: () => Date.parse('2026-11-01T20:45:00Z'),
    async loadShow(id) { return shows.get(id) || null; },
    async updateShow(id, patch) { shows.set(id, { ...shows.get(id), ...patch }); },
    async listBroadcasts() { return broadcasts; },
    async insertBroadcast(row) { const r = { id: `b${broadcasts.length + 1}`, ...row }; broadcasts.push(r); return r; },
    async updateBroadcast(id, patch) { Object.assign(broadcasts.find((b) => b.id === id), patch); },
    apiFor: async () => ({ api, provider: 'mock' }),
    async storeStreamKey() {},
    async readStreamKey() { return { key_enc: 'k', ingest_url: 'rtmp://a/live2' }; },
    async rotateStreamKey() { return 1; },
    async audit() {},
  };
  const r = await goLive(store, e, { showId: 's1' });
  assert.equal(r.ok, true, 'the show starts');
  assert.equal(r.recording, false, 'and says plainly that nothing is being sent');
  assert.match(r.recordingError, /not configured/);
  assert.equal(shows.get('s1').state, 'live');
});

test('goLive hands the compositor the room and the layout', async () => {
  // The fake egress ignores both; the real one cannot work without them,
  // and for weeks goLive passed neither.
  const seen = [];
  const egress = { state: 'idle', async start(args) { seen.push(args); return { ok: true, recordingPath: null }; }, pushFrame() {}, health: () => ({}), async stop() { return {}; } };
  const api = new MockYouTubeApi();
  const shows = new Map([['s1', { id: 's1', artist_id: 'A', room_name: 'room-7', performance_mode: 'versus' }]]);
  const broadcasts = [];
  const store = {
    now: () => Date.now(),
    async loadShow(id) { return shows.get(id) || null; },
    async updateShow(id, patch) { shows.set(id, { ...shows.get(id), ...patch }); },
    async listBroadcasts() { return broadcasts; },
    async insertBroadcast(row) { const r = { id: `b${broadcasts.length + 1}`, ...row }; broadcasts.push(r); return r; },
    async updateBroadcast(id, patch) { Object.assign(broadcasts.find((b) => b.id === id), patch); },
    apiFor: async () => ({ api, provider: 'mock' }),
    async storeStreamKey() {},
    async readStreamKey() { return { key_enc: 'k', ingest_url: 'rtmp://a/live2' }; },
    async rotateStreamKey() { return 1; },
    async audit() {},
  };
  await goLive(store, egress, { showId: 's1' });
  assert.equal(seen[0].room, 'room-7');
  assert.equal(seen[0].performanceMode, 'versus');
});

test('the LiveKit websocket url becomes the https url the API wants', () => {
  assert.equal(toHttpUrl('wss://x.livekit.cloud'), 'https://x.livekit.cloud');
  assert.equal(toHttpUrl('ws://localhost:7880'), 'http://localhost:7880');
});

test('the S3 file is optional, and configured storage is used', () => {
  assert.equal(fileOutputFor('room-1', {}), null, 'a show that cannot be archived still goes out');
  const f = fileOutputFor('room-1', { LIVEKIT_S3_ACCESS_KEY: 'a', LIVEKIT_S3_SECRET: 'b', LIVEKIT_S3_ENDPOINT: 'https://s3.example/', LIVEKIT_S3_REGION: 'eu', LIVEKIT_S3_BUCKET: 'rec' });
  assert.match(f.filepath, /^recordings\/room-1-\d+\.mp4$/);
  assert.equal(f.output.value.endpoint, 'https://s3.example', 'a trailing slash pasted from the console does not break path-style buckets');
});

test('the refusal says which window it compared against', () => {
  // "Your show can only start inside its booked window" and nothing else
  // left an artist refused at 20:45 for a 20:40 show — comfortably
  // inside it — with no way to tell whether the clock, the booking or
  // the rule was wrong. Neither had we.
  const src = readFileSync(resolve(ROOT, 'app/api/artist/shows/[id]/go-live/route.js'), 'utf8');
  assert.match(src, /This one runs \$\{at\(opens\)\}/, 'the window is in the sentence');
  assert.match(src, /it is \$\{at\(now\)\} UTC now/, 'and so is the server clock it was compared against');
  assert.match(src, /slatedAt: show\.slated_at/, 'with the booked time alongside, for a mismatch we cannot see from here');
});

test('a show reaching nobody says so, rather than only mentioning the recording', () => {
  const src = readFileSync(resolve(ROOT, 'native/app/artist/console/[id].js'), 'utf8');
  assert.match(src, /nothing is reaching YouTube/, 'no targets is a different failure from no recording');
  assert.match(src, /not being recorded/, 'and both are still said');
});
