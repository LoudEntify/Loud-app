import { recommendCamera, selectDirectorCamera } from './cameraRecommendation.mjs';
import { logHealthEvent } from './healthLog';

const snapshots = new Map();
let currentCameraId = null;
let lastSwitchAt = 0;
const mode = process.env.NEXT_PUBLIC_EXP_VD_002_MODE || 'off';

export function recordCameraFeature(feature) {
  if (feature?.cameraId) snapshots.set(feature.cameraId, feature);
}

export function cameraRecommendationForRules(rulesCameraId, { decisionSource = 'auto', now = Date.now() } = {}) {
  if (mode === 'off' || decisionSource === 'human') return { cameraId: rulesCameraId, source: decisionSource === 'human' ? 'human-override' : 'rules', recommendation: null };
  const recommendation = recommendCamera({ features: [...snapshots.values()], currentCameraId: currentCameraId || rulesCameraId, lastSwitchAt, now });
  const selected = selectDirectorCamera({ rulesCameraId, recommendation, mode, humanOverride: decisionSource === 'human' });
  logHealthEvent('camera_recommendation', { version: recommendation.version, mode, rulesCameraId, recommendedCameraId: recommendation.cameraId, selectedCameraId: selected.cameraId, action: recommendation.action, confidence: recommendation.confidence, reasons: recommendation.reasons, fallback: selected.fallback });
  if (selected.cameraId && selected.cameraId !== currentCameraId) { currentCameraId = selected.cameraId; lastSwitchAt = now; }
  return { ...selected, recommendation };
}

export function cameraRecommendationMode() { return mode; }
