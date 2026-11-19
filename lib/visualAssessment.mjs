export const CAMERA_FEATURE_SCHEMA_VERSION = 'exp-vd-001.v1';

export const DEFAULT_VISION_CONFIG = Object.freeze({
  sampleWidth: 256,
  sampleHeight: 144,
  sampleIntervalMs: 2000,
  staleAfterMs: 5000,
  maxInferenceMs: 250,
  cpuBackoffMultiplier: 2,
  minPoseConfidence: 0.45,
  wasmRoot: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm',
  modelUrl: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
});

function clamp(value, min = 0, max = 1) { return Math.min(max, Math.max(min, value)); }
function mean(values) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }

export function imageQuality(rgba, width, height, previousLuma = null) {
  const luma = new Float32Array(width * height);
  let dark = 0; let bright = 0;
  for (let p = 0, i = 0; p < luma.length; p += 1, i += 4) {
    const y = (0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2]) / 255;
    luma[p] = y;
    if (y < 0.08) dark += 1;
    if (y > 0.92) bright += 1;
  }
  const averageLuma = mean(luma);
  let lapSum = 0; let lapSq = 0; let lapCount = 0;
  for (let y = 1; y < height - 1; y += 2) {
    for (let x = 1; x < width - 1; x += 2) {
      const i = y * width + x;
      const lap = luma[i - 1] + luma[i + 1] + luma[i - width] + luma[i + width] - 4 * luma[i];
      lapSum += lap; lapSq += lap * lap; lapCount += 1;
    }
  }
  const lapMean = lapCount ? lapSum / lapCount : 0;
  const blurScore = lapCount ? Math.max(0, lapSq / lapCount - lapMean * lapMean) : 0;
  let frameDelta = null;
  if (previousLuma?.length === luma.length) {
    let delta = 0;
    for (let i = 0; i < luma.length; i += 4) delta += Math.abs(luma[i] - previousLuma[i]);
    frameDelta = delta / Math.ceil(luma.length / 4);
  }
  return {
    averageLuma,
    underexposedRatio: dark / luma.length,
    overexposedRatio: bright / luma.length,
    exposureQuality: clamp(1 - Math.abs(averageLuma - 0.5) * 1.6 - (dark + bright) / luma.length),
    laplacianVariance: blurScore,
    sharpnessQuality: clamp(blurScore / 0.015),
    frameDelta,
    luma,
  };
}

export function poseFeatures(landmarks = [], minConfidence = 0.45) {
  const visible = landmarks.filter(point => (point.visibility ?? point.presence ?? 1) >= minConfidence);
  if (!visible.length) return { detected: false, confidence: 0, visibleLandmarkRatio: 0, boundingBox: null, coverage: 0, centerOffset: null, headroom: null, framing: 'unknown', compositionQuality: 0 };
  const xs = visible.map(point => point.x); const ys = visible.map(point => point.y);
  const minX = clamp(Math.min(...xs)); const maxX = clamp(Math.max(...xs));
  const minY = clamp(Math.min(...ys)); const maxY = clamp(Math.max(...ys));
  const width = Math.max(0, maxX - minX); const height = Math.max(0, maxY - minY);
  const centerX = minX + width / 2; const centerY = minY + height / 2;
  const coverage = width * height;
  const confidence = mean(visible.map(point => point.visibility ?? point.presence ?? 1));
  const centerOffset = Math.hypot(centerX - 0.5, centerY - 0.48);
  const headroom = minY;
  const framing = height > 0.72 ? 'close' : height > 0.42 ? 'medium' : 'wide';
  const compositionQuality = clamp(1 - centerOffset * 1.5 - Math.abs(headroom - 0.08) * 0.8 - (visible.length < landmarks.length * 0.55 ? 0.25 : 0));
  return { detected: true, confidence, visibleLandmarkRatio: visible.length / landmarks.length, boundingBox: { x: minX, y: minY, width, height }, coverage, centerOffset, headroom, framing, compositionQuality };
}

export function stabilityFeatures(currentPose, previousPose, frameDelta) {
  if (!currentPose?.detected || !previousPose?.detected) return { measurable: frameDelta !== null, poseCenterMovement: null, frameDelta, stabilityQuality: frameDelta === null ? null : clamp(1 - frameDelta * 5) };
  const a = currentPose.boundingBox; const b = previousPose.boundingBox;
  const movement = Math.hypot((a.x + a.width / 2) - (b.x + b.width / 2), (a.y + a.height / 2) - (b.y + b.height / 2));
  return { measurable: true, poseCenterMovement: movement, frameDelta, stabilityQuality: clamp(1 - movement * 5 - (frameDelta || 0) * 2) };
}

export function unavailableFeature({ cameraId, sampledAt, frameTimestampMs, reason, stale = false }) {
  return { schemaVersion: CAMERA_FEATURE_SCHEMA_VERSION, experiment: 'EXP-VD-001', cameraId, sampledAt, frameTimestampMs, available: false, stale, unavailableReason: reason, pose: null, image: null, stability: null, costs: null };
}
