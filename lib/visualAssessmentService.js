'use client';

import { CAMERA_FEATURE_SCHEMA_VERSION, DEFAULT_VISION_CONFIG, unavailableFeature } from './visualAssessment.mjs';

export function createVisualAssessmentService({ config: overrides = {}, onFeature = () => {} } = {}) {
  const config = { ...DEFAULT_VISION_CONFIG, ...overrides };
  let worker = null; let ready = false; let stopped = false;
  const cameras = new Map();

  function emit(feature) {
    onFeature({ schemaVersion: CAMERA_FEATURE_SCHEMA_VERSION, experiment: 'EXP-VD-001', ...feature });
  }

  try {
    worker = new Worker(new URL('../workers/visualAssessment.worker.js', import.meta.url), { type: 'module', name: 'exp-vd-001' });
    worker.onmessage = ({ data }) => {
      if (data.type === 'ready') { ready = true; return; }
      if (data.type === 'init_error') { emit(unavailableFeature({ cameraId: '*', sampledAt: new Date().toISOString(), frameTimestampMs: null, reason: 'MODEL_INIT_FAILED' })); return; }
      const state = cameras.get(data.feature?.cameraId || data.cameraId);
      if (state) state.inFlight = false;
      if (data.type === 'feature') {
        if (state) state.backoff = data.feature.costs.totalMs > config.maxInferenceMs ? Math.min(8, state.backoff * config.cpuBackoffMultiplier) : Math.max(1, state.backoff / config.cpuBackoffMultiplier);
        emit(data.feature);
      } else if (data.type === 'frame_error') emit(unavailableFeature({ cameraId: data.cameraId, sampledAt: data.sampledAt, frameTimestampMs: data.frameTimestampMs, reason: 'INFERENCE_FAILED' }));
    };
    worker.onerror = () => { ready = false; emit(unavailableFeature({ cameraId: '*', sampledAt: new Date().toISOString(), frameTimestampMs: null, reason: 'WORKER_FAILED' })); };
    worker.postMessage({ type: 'init', config });
  } catch {
    emit(unavailableFeature({ cameraId: '*', sampledAt: new Date().toISOString(), frameTimestampMs: null, reason: 'WORKER_UNAVAILABLE' }));
  }

  function schedule(cameraId) {
    const state = cameras.get(cameraId);
    if (!state || stopped) return;
    clearTimeout(state.timer);
    state.timer = setTimeout(() => sample(cameraId), config.sampleIntervalMs * state.backoff);
  }

  async function sample(cameraId) {
    const state = cameras.get(cameraId);
    if (!state || stopped) return;
    const video = state.video;
    const sampledAt = new Date().toISOString();
    const frameTimestampMs = Math.round((video.currentTime || 0) * 1000);
    if (!ready || state.inFlight || document.hidden || navigator.scheduling?.isInputPending?.()) { schedule(cameraId); return; }
    if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
      emit(unavailableFeature({ cameraId, sampledAt, frameTimestampMs, reason: 'FRAME_UNAVAILABLE' })); schedule(cameraId); return;
    }
    if (frameTimestampMs === state.lastFrameTimestampMs) {
      if (!state.unchangedSince) state.unchangedSince = Date.now();
      if (Date.now() - state.unchangedSince >= config.staleAfterMs) emit(unavailableFeature({ cameraId, sampledAt, frameTimestampMs, reason: 'STALE_FRAME', stale: true }));
      schedule(cameraId); return;
    }
    state.lastFrameTimestampMs = frameTimestampMs; state.unchangedSince = 0; state.inFlight = true;
    const sampleStarted = performance.now();
    try {
      const bitmap = await createImageBitmap(video, { resizeWidth: config.sampleWidth, resizeHeight: config.sampleHeight, resizeQuality: 'low' });
      worker.postMessage({ type: 'frame', cameraId, bitmap, sampledAt, frameTimestampMs, sampleCostMs: performance.now() - sampleStarted }, [bitmap]);
    } catch {
      state.inFlight = false;
      emit(unavailableFeature({ cameraId, sampledAt, frameTimestampMs, reason: 'FRAME_COPY_FAILED' }));
    }
    schedule(cameraId);
  }

  return {
    observe(cameraId, video) {
      if (!cameraId || !video || cameras.has(cameraId)) return;
      cameras.set(cameraId, { video, timer: null, inFlight: false, backoff: 1, lastFrameTimestampMs: null, unchangedSince: 0 });
      schedule(cameraId);
    },
    unobserve(cameraId) { const state = cameras.get(cameraId); if (state) clearTimeout(state.timer); cameras.delete(cameraId); },
    stop() { stopped = true; for (const state of cameras.values()) clearTimeout(state.timer); cameras.clear(); worker?.terminate(); worker = null; },
  };
}
