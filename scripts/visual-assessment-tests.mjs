import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { CAMERA_FEATURE_SCHEMA_VERSION, imageQuality, poseFeatures, stabilityFeatures, unavailableFeature } from '../lib/visualAssessment.mjs';

const width = 256; const height = 144;
function frame(makePixel) {
  const bytes = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const [r, g, b] = makePixel(x, y); const i = (y * width + x) * 4;
    bytes[i] = r; bytes[i + 1] = g; bytes[i + 2] = b; bytes[i + 3] = 255;
  }
  return bytes;
}
const dark = imageQuality(frame(() => [5, 5, 5]), width, height);
const balanced = imageQuality(frame((x, y) => ((x + y) % 2 ? [80, 80, 80] : [180, 180, 180])), width, height);
assert.ok(dark.underexposedRatio > 0.9);
assert.ok(balanced.exposureQuality > dark.exposureQuality);
assert.ok(balanced.laplacianVariance > dark.laplacianVariance);

const landmarks = Array.from({ length: 33 }, (_, index) => ({ x: 0.35 + (index % 5) * 0.07, y: 0.08 + Math.floor(index / 5) * 0.1, visibility: 0.9 }));
const pose = poseFeatures(landmarks);
assert.equal(pose.detected, true);
assert.ok(pose.confidence > 0.8);
assert.ok(pose.visibleLandmarkRatio === 1);
assert.ok(['close', 'medium', 'wide'].includes(pose.framing));
const moved = poseFeatures(landmarks.map(point => ({ ...point, x: point.x + 0.1 })));
const stability = stabilityFeatures(moved, pose, 0.02);
assert.equal(stability.measurable, true);
assert.ok(stability.poseCenterMovement > 0.09);
const stale = unavailableFeature({ cameraId: 'camera-a', sampledAt: '2026-01-01T00:00:00Z', frameTimestampMs: 1000, reason: 'STALE_FRAME', stale: true });
assert.equal(stale.schemaVersion, CAMERA_FEATURE_SCHEMA_VERSION);
assert.equal(stale.stale, true);

const sample = frame((x, y) => [x % 256, y % 256, (x + y) % 256]);
const runs = 100; const started = performance.now();
for (let i = 0; i < runs; i += 1) imageQuality(sample, width, height);
const elapsed = performance.now() - started;
console.log(`visual assessment: unit and feature-pipeline scenarios passed; deterministic image metrics ${runs}x ${width}x${height} in ${elapsed.toFixed(1)}ms (${(elapsed / runs).toFixed(2)}ms/frame)`);
