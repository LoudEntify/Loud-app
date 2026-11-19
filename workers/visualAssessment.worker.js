import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import { imageQuality, poseFeatures, stabilityFeatures } from '../lib/visualAssessment.mjs';

let landmarker = null;
let config = null;
const history = new Map();

async function initialize(nextConfig) {
  config = nextConfig;
  const vision = await FilesetResolver.forVisionTasks(config.wasmRoot);
  landmarker = await PoseLandmarker.createFromOptions(vision, { baseOptions: { modelAssetPath: config.modelUrl, delegate: 'CPU' }, runningMode: 'VIDEO', numPoses: 1, minPoseDetectionConfidence: config.minPoseConfidence, minPosePresenceConfidence: config.minPoseConfidence, minTrackingConfidence: config.minPoseConfidence });
}

self.onmessage = async ({ data }) => {
  if (data.type === 'init') {
    try { await initialize(data.config); self.postMessage({ type: 'ready' }); }
    catch (error) { self.postMessage({ type: 'init_error', message: String(error?.message || error) }); }
    return;
  }
  if (data.type !== 'frame') return;
  const started = performance.now();
  const { cameraId, bitmap, sampledAt, frameTimestampMs, sampleCostMs } = data;
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    const previous = history.get(cameraId) || {};
    const qualityStarted = performance.now();
    const image = imageQuality(pixels.data, canvas.width, canvas.height, previous.luma);
    const qualityMs = performance.now() - qualityStarted;
    let result = null; let modelMs = 0; let modelError = null;
    if (landmarker) {
      const modelStarted = performance.now();
      try { result = landmarker.detectForVideo(bitmap, frameTimestampMs); } catch (error) { modelError = String(error?.message || error); }
      modelMs = performance.now() - modelStarted;
    }
    bitmap.close();
    const pose = poseFeatures(result?.landmarks?.[0] || [], config.minPoseConfidence);
    const stability = stabilityFeatures(pose, previous.pose, image.frameDelta);
    history.set(cameraId, { luma: image.luma, pose, at: frameTimestampMs });
    delete image.luma;
    self.postMessage({ type: 'feature', feature: { cameraId, sampledAt, frameTimestampMs, available: true, stale: false, dimensions: { width: canvas.width, height: canvas.height }, pose, image, stability, costs: { totalMs: performance.now() - started + (sampleCostMs || 0), frameCopyMs: sampleCostMs || 0, workerMs: performance.now() - started, modelMs, qualityMs, modelError } } });
  } catch (error) {
    try { bitmap?.close?.(); } catch { /* already closed */ }
    self.postMessage({ type: 'frame_error', cameraId, sampledAt, frameTimestampMs, message: String(error?.message || error), latencyMs: performance.now() - started });
  }
};
