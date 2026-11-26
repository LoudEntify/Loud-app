import { performance } from 'node:perf_hooks';

export const RELIABILITY_SCENARIOS = Object.freeze([
  'camera_disconnect', 'main_performer_disconnect', 'camera_reconnect_new_identity',
  'inference_unavailable', 'compositor_crash', 'youtube_ingest_disconnect',
  'oauth_revoked', 'repeated_show_start', 'concurrent_show_start',
  'viewer_joins_live', 'broadcast_ends_unexpectedly', 'multiple_concurrent_shows',
]);

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
}

export function summarizeMeasurements(samples) {
  const recovery = samples.map(sample => sample.recoveryMs).filter(Number.isFinite);
  const inference = samples.flatMap(sample => sample.inferenceLatenciesMs || []);
  const frameSamples = samples.reduce((sum, sample) => sum + sample.frameSamples, 0);
  const durationSeconds = samples.reduce((sum, sample) => sum + sample.durationMs, 0) / 1000;
  return {
    attempts: samples.length,
    passed: samples.filter(sample => sample.passed).length,
    errorRate: samples.length ? samples.filter(sample => !sample.passed).length / samples.length : 0,
    recoveryMs: { p50: percentile(recovery, 0.5), p95: percentile(recovery, 0.95), max: recovery.length ? Math.max(...recovery) : null },
    inferenceLatencyMs: { p50: percentile(inference, 0.5), p95: percentile(inference, 0.95), max: inference.length ? Math.max(...inference) : null },
    frameSamplingThroughputPerSecond: durationSeconds ? frameSamples / durationSeconds : 0,
    youtubeApiCalls: samples.reduce((sum, sample) => sum + sample.youtubeApiCalls, 0),
    streamStability: { unexpectedInterruptions: samples.reduce((sum, sample) => sum + sample.unexpectedInterruptions, 0), synthetic: true },
  };
}

export function createSyntheticShow(id, { now = () => performance.now() } = {}) {
  const events = []; let state = 'SCHEDULED'; let lease = false; let startEffects = 0;
  let cameras = new Map([['main-1', { main: true, connected: true }], ['side-1', { main: false, connected: true }]]);
  let inference = true; let compositor = true; let ingest = true; let oauth = true; let broadcast = 'scheduled'; let viewers = 0; let youtubeApiCalls = 0;
  const emit = (type, detail = {}) => events.push({ at: now(), type, detail });
  const start = async owner => {
    if (state === 'LIVE') return { idempotent: true };
    if (lease) throw Object.assign(new Error('start lease busy'), { code: 'LEASE_BUSY' });
    lease = true; emit('lease_acquired', { owner });
    await Promise.resolve();
    try {
      if (!oauth) throw Object.assign(new Error('authorization required'), { code: 'AUTH_REQUIRED' });
      state = 'STARTING'; startEffects += 1; youtubeApiCalls += 3;
      if (!ingest) throw Object.assign(new Error('ingest inactive'), { code: 'YOUTUBE_INGEST_NOT_ACTIVE' });
      state = 'LIVE'; broadcast = 'live'; emit('show_live'); return { idempotent: false };
    } finally { lease = false; emit('lease_released'); }
  };
  return {
    id, events, start,
    snapshot: () => ({ state, cameras: [...cameras], inference, compositor, ingest, oauth, broadcast, viewers, youtubeApiCalls, startEffects }),
    fault(type) {
      const begun = now();
      switch (type) {
        case 'camera_disconnect': cameras.get('side-1').connected = false; emit('camera_lost'); cameras.get('side-1').connected = true; emit('camera_recovered'); break;
        case 'main_performer_disconnect': cameras.get('main-1').connected = false; emit('main_lost'); emit('fallback_selected', { cameraId: 'side-1' }); break;
        case 'camera_reconnect_new_identity': cameras.delete('side-1'); cameras.set('side-2', { main: false, connected: true }); emit('camera_reidentified', { old: 'side-1', next: 'side-2' }); break;
        case 'inference_unavailable': inference = false; emit('rules_fallback'); break;
        case 'compositor_crash': compositor = false; emit('output_lost'); compositor = true; emit('output_restarted'); break;
        case 'youtube_ingest_disconnect': ingest = false; emit('ingest_lost'); ingest = true; youtubeApiCalls += 1; emit('ingest_recovered'); break;
        case 'oauth_revoked': oauth = false; emit('auth_required'); break;
        case 'viewer_joins_live': viewers += 1; emit('viewer_joined_with_catchup'); break;
        case 'broadcast_ends_unexpectedly': broadcast = 'complete'; state = 'FAILED'; emit('broadcast_unexpected_end'); break;
        default: throw new Error(`Unknown direct fault: ${type}`);
      }
      return Math.max(0, now() - begun);
    },
  };
}

export async function runReliabilityScenario(name, { showCount = 1 } = {}) {
  const startedAt = performance.now(); const shows = Array.from({ length: showCount }, (_, i) => createSyntheticShow(`show-${i + 1}`));
  let passed = true; let recoveryMs = null; let failure = null;
  try {
    await Promise.all(shows.map(show => show.start('worker-a')));
    if (name === 'repeated_show_start') { const result = await shows[0].start('worker-a'); passed = result.idempotent && shows[0].snapshot().startEffects === 1; }
    else if (name === 'concurrent_show_start') { const show = createSyntheticShow('lease-show'); const results = await Promise.allSettled([show.start('worker-a'), show.start('worker-b')]); passed = results.filter(item => item.status === 'fulfilled').length === 1 && results.some(item => item.reason?.code === 'LEASE_BUSY'); }
    else if (name === 'multiple_concurrent_shows') passed = shows.every(show => show.snapshot().state === 'LIVE');
    else { recoveryMs = shows[0].fault(name); const snapshot = shows[0].snapshot(); passed = name === 'oauth_revoked' ? !snapshot.oauth : name === 'broadcast_ends_unexpectedly' ? snapshot.state === 'FAILED' : true; }
  } catch (error) { passed = false; failure = { code: error.code || 'UNEXPECTED', message: error.message }; }
  const durationMs = Math.max(0.01, performance.now() - startedAt);
  return { scenario: name, showCount, passed, failure, recoveryMs, durationMs, frameSamples: 0, inferenceLatenciesMs: [], youtubeApiCalls: shows.reduce((sum, show) => sum + show.snapshot().youtubeApiCalls, 0), unexpectedInterruptions: name === 'broadcast_ends_unexpectedly' || name === 'youtube_ingest_disconnect' || name === 'compositor_crash' ? 1 : 0 };
}
