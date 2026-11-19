import assert from 'node:assert/strict';
import { canTransition, readinessProblems } from '../lib/showOrchestrationCore.mjs';
import { createShowOrchestrator } from '../lib/showOrchestrator.mjs';

assert.equal(canTransition('SCHEDULED', 'PREPARING'), true);
assert.equal(canTransition('SCHEDULED', 'LIVE'), false);
assert.deepEqual(readinessProblems({ cameraReady: false, audioReady: true }), ['CAMERA_NOT_READY']);

function harness({ cameraReady = true, audioReady = true, stopFails = false, ingestInactiveOnce = false } = {}) {
  const calls = [];
  const events = [];
  const show = { id: 'show-1', artist_id: 'artist-1', title: 'Test show', room_name: 'room-1', slated_at: '2030-01-01T12:00:00Z', state: 'scheduled' };
  let record = { show_id: show.id, artist_id: show.artist_id, state: 'SCHEDULED', version: 1, recovery_attempts: 0, checkpoints: {} };
  let leased = false;
  const repository = {
    async loadShow() { return show; },
    async ensure() { return { ...record }; },
    async acquireLease(_showId, _artistId, operation) {
      if (leased) return null;
      leased = true;
      record = { ...record, lease_token: `lease-${operation}`, desired_operation: operation };
      return { ...record };
    },
    async releaseLease() { leased = false; record.lease_token = null; },
    async transition(_id, version, from, to) {
      assert.equal(record.version, version);
      assert.equal(record.state, from);
      record = { ...record, state: to, version: version + 1 };
      return { ...record };
    },
    async checkpoint(_id, patch) { record = { ...record, ...patch, checkpoints: { ...record.checkpoints, ...patch } }; },
    async event(_id, type, from, to, data) { events.push({ type, from, to, data }); },
    async markShowStarted() { calls.push('show.started'); },
    async markShowEnded() { calls.push('show.ended'); },
    async markShowCancelled() { calls.push('show.cancelled'); },
  };
  const adapter = (name, methods) => Object.fromEntries(methods.map(method => [method, async ({ status } = {}) => {
    calls.push(`${name}.${method}${status ? `:${status}` : ''}`);
    return method === 'status' ? { active: true } : {};
  }]));
  const room = adapter('room', ['ensure', 'close', 'status']);
  const cameras = adapter('cameras', ['assignToRoom', 'release']);
  const director = adapter('director', ['prepare', 'start', 'stop', 'status']);
  const interactions = adapter('interactions', ['setStatus']);
  const readiness = { async check() { calls.push('readiness.check'); return { cameraReady, audioReady }; } };
  const youtube = {
    async prepare() { calls.push('youtube.prepare'); return { broadcastId: 'broadcast-1', streamId: 'stream-1' }; },
    async waitForIngest() { calls.push('youtube.waitForIngest'); if (ingestInactiveOnce) { ingestInactiveOnce = false; return { streamStatus: 'inactive' }; } return { streamStatus: 'active' }; },
    async transition({ to }) { calls.push(`youtube.transition:${to}`); return {}; },
    async status() { calls.push('youtube.status'); return { youtube: { streamStatus: 'active' } }; },
  };
  const output = {
    async start() { calls.push('output.start'); return { id: 'output-1' }; },
    async stop() { calls.push('output.stop'); if (stopFails) { stopFails = false; throw Object.assign(new Error('worker unavailable'), { code: 'OUTPUT_STOP_FAILED' }); } return {}; },
    async status() { calls.push('output.status'); return { active: true }; },
  };
  const orchestrator = createShowOrchestrator({ repository, room, readiness, youtube, output, director, interactions, cameras });
  return { orchestrator, repository, calls, events, getRecord: () => ({ ...record }), setLeased: value => { leased = value; } };
}

const happy = harness();
const started = await happy.orchestrator.start({ showId: 'show-1', artistId: 'artist-1' });
assert.equal(started.record.state, 'LIVE');
assert.ok(happy.calls.indexOf('output.start') < happy.calls.indexOf('youtube.waitForIngest'));
assert.ok(happy.calls.indexOf('youtube.waitForIngest') < happy.calls.indexOf('youtube.transition:live'));
assert.ok(happy.events.some(event => event.type === 'YOUTUBE_INGEST_CONFIRMED'));
const startCalls = happy.calls.length;
assert.equal((await happy.orchestrator.start({ showId: 'show-1', artistId: 'artist-1' })).idempotent, true);
assert.equal(happy.calls.length, startCalls);
const stopped = await happy.orchestrator.stop({ showId: 'show-1', artistId: 'artist-1' });
assert.equal(stopped.record.state, 'COMPLETED');
const stopCalls = happy.calls.length;
assert.equal((await happy.orchestrator.stop({ showId: 'show-1', artistId: 'artist-1' })).idempotent, true);
assert.equal(happy.calls.length, stopCalls);

const unready = harness({ cameraReady: false });
await assert.rejects(() => unready.orchestrator.start({ showId: 'show-1', artistId: 'artist-1' }), error => error.orchestrationFailure?.code === 'CAMERA_NOT_READY');
assert.equal(unready.getRecord().state, 'FAILED');
assert.ok(unready.events.some(event => event.type === 'OPERATION_FAILED'));

const concurrency = harness();
concurrency.setLeased(true);
await assert.rejects(() => concurrency.orchestrator.start({ showId: 'show-1', artistId: 'artist-1' }), error => error.code === 'LEASE_BUSY');

const partial = harness({ stopFails: true });
await partial.orchestrator.start({ showId: 'show-1', artistId: 'artist-1' });
await assert.rejects(() => partial.orchestrator.stop({ showId: 'show-1', artistId: 'artist-1' }), error => error.orchestrationFailure?.code === 'OUTPUT_STOP_FAILED');
assert.equal(partial.getRecord().state, 'FAILED');
const reconciled = await partial.orchestrator.reconcile({ showId: 'show-1', artistId: 'artist-1' });
assert.equal(reconciled.action, 'completed_cleanup');
assert.equal(partial.getRecord().state, 'COMPLETED');

const interruptedStart = harness({ ingestInactiveOnce: true });
await assert.rejects(() => interruptedStart.orchestrator.start({ showId: 'show-1', artistId: 'artist-1' }), error => error.orchestrationFailure?.code === 'YOUTUBE_INGEST_NOT_ACTIVE');
assert.equal(interruptedStart.getRecord().failed_phase, 'starting');
const resumed = await interruptedStart.orchestrator.reconcile({ showId: 'show-1', artistId: 'artist-1' });
assert.equal(resumed.action, 'resumed_start');
assert.equal(interruptedStart.getRecord().state, 'LIVE');

const cancelled = harness();
assert.equal((await cancelled.orchestrator.cancel({ showId: 'show-1', artistId: 'artist-1', reason: 'weather' })).record.state, 'COMPLETED');
assert.ok(cancelled.events.some(event => event.type === 'SHOW_CANCELLED'));

console.log('show orchestration: lifecycle, leases, ordering, recovery and audit scenarios passed');
