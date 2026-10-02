import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { composeLayout, OUTPUT, CORNER_SHARE } from '../lib/pipeline/compositor.js';
import { FakeEgress } from '../lib/pipeline/egress.js';
import { MockYouTubeApi } from '../lib/youtube/api.js';
import { createBroadcastsForShow, goLive, deliveryTick, endShow, RETRY_SAME_BROADCAST } from '../lib/pipeline/lifecycle.js';
import { decideAction, resolveRequest, REQUEST_TTL_MS } from '../lib/pipeline/stageRequests.js';
import { validateBooking, earliestStart, reminderOffsetsDue } from '../lib/schedule.js';

test('compositor: solo full frame; Versus split, corner at ~31% lower right, mirror; logo top-left', () => {
  const solo = composeLayout({ mode: 'solo' });
  assert.equal(solo.layers.length, 1); assert.deepEqual(solo.layers[0].rect, { x: 0, y: 0, w: OUTPUT.w, h: OUTPUT.h });
  const conv = composeLayout({ mode: 'versus', view: 'conversation' });
  assert.equal(conv.layers[0].rect.h + conv.layers[1].rect.h, OUTPUT.h); assert.equal(conv.layers[0].rect.w, OUTPUT.w);
  const a = composeLayout({ mode: 'versus', view: 'a_performing' });
  const corner = a.layers.find((l) => l.role === 'corner');
  assert.equal(corner.slot, 'b'); assert.equal(corner.rect.w, Math.round(OUTPUT.w * CORNER_SHARE));
  assert.ok(corner.rect.x > OUTPUT.w / 2 && corner.rect.y > OUTPUT.h / 2 && corner.rect.x + corner.rect.w <= OUTPUT.w && corner.rect.y + corner.rect.h <= OUTPUT.h);
  const b = composeLayout({ mode: 'versus', view: 'b_performing' });
  assert.deepEqual(b.layers.find((l) => l.role === 'corner').rect, corner.rect); assert.equal(b.layers[0].slot, 'b');
  assert.ok(a.logo.x < 30 && a.logo.y < 30 && a.logo.h > 0);
  // degrade: the healthy artist fills the frame
  const d = composeLayout({ mode: 'versus', view: 'conversation', healthy: { a: false, b: true } });
  assert.equal(d.layers.length, 1); assert.equal(d.layers[0].slot, 'b'); assert.equal(d.degraded, 'a_unhealthy');
});

function memoryStore({ apis }) {
  const shows = new Map(); const broadcasts = []; const keys = new Map(); const audits = [];
  let t = Date.parse('2026-10-02T20:00:00Z');
  return {
    shows, broadcasts, keys, audits,
    now: () => t, tick: (ms) => { t += ms; },
    async loadShow(id) { return shows.get(id) || null; },
    async updateShow(id, patch) { shows.set(id, { ...shows.get(id), ...patch }); },
    async listBroadcasts(showId) { return broadcasts.filter((b) => b.show_id === showId).map((b) => ({ ...b })); },
    async insertBroadcast(row) { const r = { id: `b${broadcasts.length + 1}`, attempts: 0, delivery_state: 'idle', ...row }; broadcasts.push(r); return { ...r }; },
    async updateBroadcast(id, patch) { const b = broadcasts.find((x) => x.id === id); Object.assign(b, patch); },
    async apiFor(userId) { return apis[userId] ? { api: apis[userId], provider: 'mock' } : { api: null, error: new Error('not connected') }; },
    async storeStreamKey(id, key, url) { keys.set(id, { key_enc: key, ingest_url: url }); },
    async readStreamKey(id) { return keys.get(id) || null; },
    async rotateStreamKey(id) { const had = keys.has(id); keys.delete(id); return had ? 1 : 0; },
    async audit(e) { audits.push(e); return { id: audits.length }; },
  };
}

test('lifecycle: created at schedule (two channels in Versus, chat off), live at the slot, ended with keys rotated', async () => {
  const apiA = new MockYouTubeApi(), apiB = new MockYouTubeApi({ channel: { id: 'UC_b', title: 'B' } });
  const store = memoryStore({ apis: { A: apiA, B: apiB } });
  store.shows.set('s1', { id: 's1', title: 'Versus night', slated_at: '2026-10-02T21:00:00Z', artist_id: 'A', artist_b_id: 'B', performance_mode: 'versus' });
  const { broadcasts } = await createBroadcastsForShow(store, { showId: 's1' });
  assert.equal(broadcasts.length, 2); assert.ok(broadcasts.every((b) => b.state === 'ready' && b.chat_disabled === true));
  assert.equal(store.shows.get('s1').youtube_video_id, broadcasts[0].youtube_video_id, 'the viewer embeds the primary artist\'s broadcast');
  assert.ok(store.audits.filter((a) => a.action === 'broadcast.created').length === 2);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'egress-'));
  const egress = new FakeEgress({ rootDir: dir, now: store.now });
  const r = await goLive(store, egress, { showId: 's1' });
  assert.equal(r.targets, 2); assert.equal(store.shows.get('s1').delivery_state, 'ok');
  assert.ok(apiA.calls.some((c) => c.name === 'transition' && c.args.status === 'live'));
  for (let i = 0; i < 5; i++) egress.pushFrame({ tMs: i * 1000, layout: composeLayout({ mode: 'versus', view: 'conversation' }) });
  const files = fs.readdirSync(path.join(dir, 's1'));
  assert.ok(files.includes('recording.ndjson') && files.includes('training.ndjson') && files.filter((f) => f.startsWith('youtube-')).length === 2, `one egress, three outputs: ${files}`);
  for (const f of files) assert.equal(fs.readFileSync(path.join(dir, 's1', f), 'utf8').includes('mock-key'), false, 'no stream key in any written file');
  const tick = await deliveryTick(store, egress, { showId: 's1' });
  assert.equal(tick.state, 'ok');
  store.tick(60_000);
  const end = await endShow(store, egress, { showId: 's1' });
  assert.equal(end.recording.frames, 5); assert.ok(end.training);
  assert.equal(store.keys.size, 0, 'stream keys rotated');
  assert.ok(store.broadcasts.every((b) => b.state === 'complete' && b.key_rotated_at));
  assert.ok(store.audits.some((a) => a.action === 'stream_key.rotated') && store.audits.some((a) => a.action === 'show.ended'));
});

test('failure drill: ingest drops, the same broadcast is retried, then a new one is created and the viewer embed id moves; the show never ends', async () => {
  const api = new MockYouTubeApi();
  const store = memoryStore({ apis: { A: api } });
  store.shows.set('s2', { id: 's2', title: 'Solo', slated_at: '2026-10-02T21:00:00Z', artist_id: 'A', performance_mode: 'solo' });
  await createBroadcastsForShow(store, { showId: 's2' });
  const egress = new FakeEgress({ rootDir: fs.mkdtempSync(path.join(os.tmpdir(), 'egress-')), now: store.now });
  await goLive(store, egress, { showId: 's2' });
  const firstVideo = store.shows.get('s2').youtube_video_id;
  api.fail('ingest_drop'); egress.fail('rtmp_drop');
  for (let i = 1; i <= RETRY_SAME_BROADCAST; i++) {
    const t = await deliveryTick(store, egress, { showId: 's2' });
    assert.equal(t.state, 'reconnecting', `tick ${i}`);
    assert.equal(store.shows.get('s2').delivery_state, 'reconnecting');
    egress.pushFrame({ tMs: i, layout: composeLayout({ mode: 'solo' }) }); // recording continues throughout
  }
  // the fourth failing tick abandons the broadcast and creates a new one on the same channel
  const t4 = await deliveryTick(store, egress, { showId: 's2' });
  assert.notEqual(store.shows.get('s2').youtube_video_id, firstVideo, 'a new broadcast carries the show');
  assert.ok(store.audits.some((a) => a.action === 'broadcast.abandoned'));
  api.fail('ingest_drop', false); egress.fail('rtmp_drop', false);
  const t = await deliveryTick(store, egress, { showId: 's2' });
  assert.equal(t.state, 'ok', `after recovery (was ${t4.state})`);
  assert.ok(store.audits.some((a) => a.action === 'broadcast.delivery_lost') && store.audits.some((a) => a.action === 'broadcast.recreated'));
  assert.equal(store.shows.get('s2').actual_ended_at, undefined, 'the show was never ended by delivery trouble');
  assert.equal(egress.health().recordingFrames, RETRY_SAME_BROADCAST);
});

test('failure drill: a rejected stream key and a channel without a connection do not stop the show or the recording', async () => {
  const api = new MockYouTubeApi().fail('reject_stream_key');
  const store = memoryStore({ apis: { A: api } });
  store.shows.set('s3', { id: 's3', title: 'x', slated_at: 'now', artist_id: 'A', artist_b_id: 'NOBODY', performance_mode: 'versus' });
  const { broadcasts } = await createBroadcastsForShow(store, { showId: 's3' });
  assert.equal(broadcasts.find((b) => b.channel_user_id === 'NOBODY').state, 'failed');
  const egress = new FakeEgress({ rootDir: fs.mkdtempSync(path.join(os.tmpdir(), 'egress-')), now: store.now });
  const r = await goLive(store, egress, { showId: 's3' });
  assert.ok(r.ok && r.recordingPath, 'recording started');
  assert.equal(store.broadcasts.find((b) => b.channel_user_id === 'A').state, 'failed');
  assert.equal(store.shows.get('s3').delivery_state, 'reconnecting');
  assert.ok(store.audits.some((a) => a.action === 'broadcast.start_failed'));
  const end = await endShow(store, egress, { showId: 's3' });
  assert.ok(end.ok && end.recording);
});

test('stage requests: conversation is immediate, perform needs the performer\'s confirmation, expiry and wrong answerer', () => {
  const now = Date.parse('2026-10-02T20:00:00Z');
  assert.deepEqual(decideAction({ currentView: 'a_performing', slot: 'a', action: 'conversation' }), { kind: 'set_view', view: 'conversation' });
  assert.deepEqual(decideAction({ currentView: 'conversation', slot: 'b', action: 'perform' }), { kind: 'set_view', view: 'b_performing' });
  assert.deepEqual(decideAction({ currentView: 'a_performing', slot: 'b', action: 'perform' }), { kind: 'request', from: 'b', to: 'a' });
  const pending = { state: 'pending', from_slot: 'b', to_slot: 'a', created_at: new Date(now).toISOString() };
  assert.equal(decideAction({ currentView: 'a_performing', slot: 'b', action: 'perform', pending, nowMs: now + 1000 }).kind, 'noop');
  assert.deepEqual(resolveRequest({ request: pending, by: 'a', answer: 'handover', nowMs: now + 1000 }), { state: 'accepted', view: 'b_performing' });
  assert.deepEqual(resolveRequest({ request: pending, by: 'a', answer: 'not_yet', nowMs: now + 1000 }), { state: 'declined', view: null });
  assert.equal(resolveRequest({ request: pending, by: 'b', answer: 'handover', nowMs: now }).error, 'not_yours_to_answer');
  assert.equal(resolveRequest({ request: pending, by: 'a', answer: 'handover', nowMs: now + REQUEST_TTL_MS + 1 }).state, 'expired');
});

test('booking: 30 minutes ahead, lengths, versus needs an invitee, reminders still in the future', () => {
  const now = Date.parse('2026-10-02T20:00:00Z');
  const ok = validateBooking({ mode: 'solo', startAt: new Date(now + 31 * 60000).toISOString(), minutes: 45, title: 'Set' }, { nowMs: now });
  assert.equal(ok.ok, true);
  const soon = validateBooking({ mode: 'solo', startAt: new Date(now + 29 * 60000).toISOString(), minutes: 45, title: 'Set' }, { nowMs: now });
  assert.equal(soon.errors.startAt, 'The earliest start is 30 minutes from now.');
  assert.ok(validateBooking({ mode: 'versus', startAt: new Date(now + 3600000).toISOString(), minutes: 10, title: '' }, { nowMs: now }).errors.minutes);
  assert.ok(validateBooking({ mode: 'versus', startAt: new Date(now + 3600000).toISOString(), minutes: 30, title: 'x' }, { nowMs: now }).errors.invitee);
  assert.ok(earliestStart(now) - now >= 30 * 60000 && earliestStart(now) % 300000 === 0);
  assert.deepEqual(reminderOffsetsDue(now + 31 * 60000, now), [30]);
  assert.deepEqual(reminderOffsetsDue(now + 2 * 86400000, now), [1440, 240, 60, 30]);
});
