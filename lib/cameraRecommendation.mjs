export const CAMERA_RECOMMENDATION_VERSION = 'exp-vd-002.baseline.v1';

export const DEFAULT_RECOMMENDATION_CONFIG = Object.freeze({
  staleAfterMs: 6000,
  minPoseConfidence: 0.45,
  minVisibility: 0.45,
  minHoldMs: 8000,
  switchCooldownMs: 5000,
  switchMargin: 0.12,
  weights: Object.freeze({ visibility: 0.28, composition: 0.22, exposure: 0.16, sharpness: 0.16, stability: 0.12, poseConfidence: 0.06 }),
});

const clamp = value => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

export function scoreCamera(feature, { now = Date.now(), health = 'healthy', config = DEFAULT_RECOMMENDATION_CONFIG } = {}) {
  const reasons = [];
  if (!feature?.cameraId) return { eligible: false, score: 0, cameraId: null, reasons: ['missing feature vector'] };
  const ageMs = Math.max(0, now - Number(feature.sampledAt || 0));
  if (!feature.available) reasons.push(`camera unavailable: ${feature.unavailableReason || 'unknown'}`);
  if (feature.stale || ageMs > config.staleAfterMs) reasons.push(`stale frame (${ageMs}ms)`);
  if (health !== 'healthy') reasons.push(`stream health is ${health}`);
  if (!feature.pose?.detected) reasons.push('performer not detected');
  if ((feature.pose?.confidence || 0) < config.minPoseConfidence) reasons.push('pose confidence below threshold');
  if ((feature.pose?.visibleLandmarkRatio || 0) < config.minVisibility) reasons.push('performer visibility below threshold');
  if (reasons.length) return { eligible: false, score: 0, cameraId: feature.cameraId, ageMs, reasons };

  const values = {
    visibility: clamp(feature.pose.visibleLandmarkRatio),
    composition: clamp(feature.pose.compositionQuality),
    exposure: clamp(feature.image?.exposureQuality),
    sharpness: clamp(feature.image?.sharpnessQuality),
    stability: clamp(feature.stability?.stabilityQuality ?? 0.5),
    poseConfidence: clamp(feature.pose.confidence),
  };
  const score = Object.entries(config.weights).reduce((sum, [key, weight]) => sum + values[key] * weight, 0);
  const strengths = Object.entries(values).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([key]) => key);
  return { eligible: true, cameraId: feature.cameraId, score: clamp(score), ageMs, values, reasons: [`strong ${strengths.join(' and ')}`] };
}

export function recommendCamera({ features = [], healthByCamera = {}, currentCameraId = null, lastSwitchAt = 0, now = Date.now(), config = DEFAULT_RECOMMENDATION_CONFIG } = {}) {
  const ranked = features.map(feature => scoreCamera(feature, { now, health: healthByCamera[feature.cameraId] || 'healthy', config })).sort((a, b) => b.score - a.score);
  const eligible = ranked.filter(item => item.eligible);
  if (!eligible.length) return { version: CAMERA_RECOMMENDATION_VERSION, action: 'NO_ELIGIBLE', cameraId: currentCameraId, confidence: 0, reasons: ['no healthy, visible, fresh camera'], ranked };
  const best = eligible[0];
  const current = eligible.find(item => item.cameraId === currentCameraId);
  const heldMs = Math.max(0, now - lastSwitchAt);
  if (current && best.cameraId !== currentCameraId && heldMs < config.minHoldMs) return { version: CAMERA_RECOMMENDATION_VERSION, action: 'HOLD', cameraId: currentCameraId, confidence: current.score, reasons: [`minimum hold has ${config.minHoldMs - heldMs}ms remaining`], ranked };
  if (current && best.cameraId !== currentCameraId && heldMs < config.switchCooldownMs) return { version: CAMERA_RECOMMENDATION_VERSION, action: 'HOLD', cameraId: currentCameraId, confidence: current.score, reasons: ['switch cooldown active'], ranked };
  if (current && best.cameraId !== currentCameraId && best.score - current.score < config.switchMargin) return { version: CAMERA_RECOMMENDATION_VERSION, action: 'HOLD', cameraId: currentCameraId, confidence: current.score, reasons: [`quality margin below ${config.switchMargin}`], ranked };
  const second = eligible[1]?.score ?? 0;
  return { version: CAMERA_RECOMMENDATION_VERSION, action: best.cameraId === currentCameraId ? 'HOLD' : 'SWITCH', cameraId: best.cameraId, confidence: clamp(best.score * (0.75 + 0.25 * Math.max(0, best.score - second))), reasons: best.reasons, ranked };
}

export function selectDirectorCamera({ rulesCameraId, recommendation, mode = 'shadow', humanOverride = false }) {
  if (humanOverride) return { cameraId: rulesCameraId, source: 'human-override', fallback: true };
  if (mode !== 'active') return { cameraId: rulesCameraId, source: 'rules', fallback: true };
  if (!recommendation || recommendation.action === 'NO_ELIGIBLE' || !recommendation.cameraId) return { cameraId: rulesCameraId, source: 'rules-fallback', fallback: true };
  return { cameraId: recommendation.cameraId, source: 'camera-recommender', fallback: false };
}
