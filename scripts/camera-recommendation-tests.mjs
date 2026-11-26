import assert from 'node:assert/strict';
import { recommendCamera, scoreCamera, selectDirectorCamera } from '../lib/cameraRecommendation.mjs';

const now = 100_000;
const feature = (cameraId, quality = 0.8) => ({ cameraId, sampledAt: now - 100, available: true, stale: false, pose: { detected: true, confidence: quality, visibleLandmarkRatio: quality, compositionQuality: quality }, image: { exposureQuality: quality, sharpnessQuality: quality }, stability: { stabilityQuality: quality } });
assert.equal(scoreCamera(feature('a'), { now }).eligible, true);
assert.equal(scoreCamera({ ...feature('a'), stale: true }, { now }).eligible, false);
assert.equal(scoreCamera(feature('a'), { now, health: 'degraded' }).eligible, false);
const held = recommendCamera({ features: [feature('a', 0.5), feature('b', 0.95)], currentCameraId: 'a', lastSwitchAt: now - 1000, now });
assert.equal(held.action, 'HOLD'); assert.equal(held.cameraId, 'a');
const switched = recommendCamera({ features: [feature('a', 0.5), feature('b', 0.95)], currentCameraId: 'a', lastSwitchAt: now - 20_000, now });
assert.equal(switched.action, 'SWITCH'); assert.equal(switched.cameraId, 'b');
assert.equal(selectDirectorCamera({ rulesCameraId: 'a', recommendation: switched, mode: 'shadow' }).cameraId, 'a');
assert.equal(selectDirectorCamera({ rulesCameraId: 'a', recommendation: switched, mode: 'active' }).cameraId, 'b');
assert.equal(selectDirectorCamera({ rulesCameraId: 'a', recommendation: switched, mode: 'active', humanOverride: true }).cameraId, 'a');
assert.equal(selectDirectorCamera({ rulesCameraId: 'a', recommendation: { action: 'NO_ELIGIBLE' }, mode: 'active' }).source, 'rules-fallback');
console.log('camera recommendation tests passed');
