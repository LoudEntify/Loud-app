import fs from 'node:fs'; import { performance } from 'node:perf_hooks'; import { scoreCamera } from '../lib/cameraRecommendation.mjs';
const [datasetPath, outputPath = 'artifacts/camera-ranker-report.json'] = process.argv.slice(2);
if (!datasetPath) { console.error('usage: npm run train:camera-ranker -- <dataset.json> [report.json]'); process.exit(2); }
const dataset = JSON.parse(fs.readFileSync(datasetPath, 'utf8')); const examples = dataset.examples || [];
const groups = new Set(examples.map(item => `${item.performerId}:${item.sessionId}`)); const trainGroups = new Set(examples.filter(item => item.split === 'train').map(item => `${item.performerId}:${item.sessionId}`)); const testGroups = new Set(examples.filter(item => item.split === 'test').map(item => `${item.performerId}:${item.sessionId}`)); const leakage = [...trainGroups].filter(group => testGroups.has(group));
const sufficient = examples.length >= 500 && groups.size >= 10 && testGroups.size >= 2 && leakage.length === 0;
const keys = ['visibility', 'composition', 'exposure', 'sharpness', 'stability', 'poseConfidence'];
const vector = feature => [feature.pose?.visibleLandmarkRatio, feature.pose?.compositionQuality, feature.image?.exposureQuality, feature.image?.sharpnessQuality, feature.stability?.stabilityQuality ?? 0.5, feature.pose?.confidence].map(value => Number.isFinite(value) ? value : 0);
let model = null; let metrics = null;
if (sufficient) {
  const weights = Array(keys.length).fill(0); const train = examples.filter(item => item.split === 'train');
  for (let epoch = 0; epoch < 80; epoch += 1) for (const example of train) {
    const chosen = example.candidates.find(item => item.cameraId === example.chosenCameraId); if (!chosen) continue;
    for (const other of example.candidates) { if (other.cameraId === chosen.cameraId) continue; const delta = vector(chosen).map((value, i) => value - vector(other)[i]); const probability = 1 / (1 + Math.exp(-delta.reduce((sum, value, i) => sum + value * weights[i], 0))); for (let i = 0; i < weights.length; i += 1) weights[i] += 0.03 * ((1 - probability) * delta[i] - 0.001 * weights[i]); }
  }
  const test = examples.filter(item => item.split === 'test'); const start = performance.now(); let learnedCorrect = 0; let baselineCorrect = 0;
  for (const example of test) { const learned = [...example.candidates].sort((a, b) => vector(b).reduce((sum, value, i) => sum + value * weights[i], 0) - vector(a).reduce((sum, value, i) => sum + value * weights[i], 0))[0]; const baseline = [...example.candidates].sort((a, b) => scoreCamera(b, { now: b.sampledAt }).score - scoreCamera(a, { now: a.sampledAt }).score)[0]; if (learned?.cameraId === example.chosenCameraId) learnedCorrect += 1; if (baseline?.cameraId === example.chosenCameraId) baselineCorrect += 1; }
  model = { version: 'exp-vd-002.rank.v1', featureKeys: keys, weights }; metrics = { heldOutExamples: test.length, learnedTop1Accuracy: learnedCorrect / test.length, baselineTop1Accuracy: baselineCorrect / test.length, delta: (learnedCorrect - baselineCorrect) / test.length, evaluationMs: performance.now() - start };
}
const report = { experiment: 'EXP-VD-002', configVersion: 'exp-vd-002.train.v1', datasetSchema: dataset.schemaVersion, examples: examples.length, groups: groups.size, leakageGroups: leakage, status: sufficient ? 'TRAINED_EXPERIMENTAL' : 'INSUFFICIENT_DATA', reason: sufficient ? 'Experimental pairwise logistic ranker evaluated on held-out performer/session groups; promotion still requires review.' : 'Need 500 matched human choices across 10 groups, two held-out groups, and no leakage.', modelProduced: sufficient, model, metrics };
fs.mkdirSync(new URL('../artifacts/', import.meta.url), { recursive: true }); fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`); console.log(JSON.stringify(report, null, 2));
