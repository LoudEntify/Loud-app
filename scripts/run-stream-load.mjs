import fs from 'node:fs'; import { performance } from 'node:perf_hooks';
import { RELIABILITY_SCENARIOS, runReliabilityScenario, summarizeMeasurements } from '../lib/streamReliabilityHarness.mjs';
import { imageQuality } from '../lib/visualAssessment.mjs';

const targets = (process.env.LOAD_TARGETS || '5,10,25,50').split(',').map(Number).filter(value => [5, 10, 25, 50].includes(value));
const iterations = Math.max(1, Math.min(100, Number(process.env.LOAD_ITERATIONS || 3))); const profiles = [];
for (const showCount of targets) {
  const beforeMemory = process.memoryUsage().rss; const beforeCpu = process.cpuUsage(); const begun = performance.now(); const samples = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) for (const scenario of RELIABILITY_SCENARIOS) samples.push(await runReliabilityScenario(scenario, { showCount: scenario === 'multiple_concurrent_shows' ? showCount : 1 }));
  const rgba = new Uint8ClampedArray(256 * 144 * 4); for (let i = 0; i < rgba.length; i += 4) { const value = (i / 4) % 251; rgba[i] = value; rgba[i + 1] = (value * 3) % 255; rgba[i + 2] = (value * 7) % 255; rgba[i + 3] = 255; }
  const visionLatencies = []; const visionStarted = performance.now();
  for (let sample = 0; sample < showCount * iterations * 4; sample += 1) { const sampleStarted = performance.now(); imageQuality(rgba, 256, 144); visionLatencies.push(performance.now() - sampleStarted); }
  const visionElapsedMs = performance.now() - visionStarted; const sortedVision = [...visionLatencies].sort((a, b) => a - b); const visionAt = p => sortedVision[Math.min(sortedVision.length - 1, Math.floor((sortedVision.length - 1) * p))];
  const elapsedMs = performance.now() - begun; const cpu = process.cpuUsage(beforeCpu); const afterMemory = process.memoryUsage().rss;
  profiles.push({ targetConcurrentShows: showCount, testType: 'local-synthetic-control-plane', iterations, elapsedMs, cpuMs: (cpu.user + cpu.system) / 1000, cpuUtilizationOneCore: elapsedMs ? (cpu.user + cpu.system) / 1000 / elapsedMs : null, rssBytes: { before: beforeMemory, after: afterMemory, delta: afterMemory - beforeMemory }, measurements: summarizeMeasurements(samples), visualAssessmentBenchmark: { frameSize: '256x144', samples: visionLatencies.length, throughputFramesPerSecond: visionElapsedMs ? visionLatencies.length * 1000 / visionElapsedMs : null, imageMetricLatencyMs: { p50: visionAt(0.5), p95: visionAt(0.95), max: Math.max(...visionLatencies) }, scope: 'Task 09 image metrics only; pose-model inference is not included.' }, mediaProcessingCostPerShowHour: null, mediaCostReason: 'No encoder or billable cloud media service is invoked by the safe local harness.' });
}
const report = { schemaVersion: 'stream-reliability.v1', generatedAt: new Date().toISOString(), approvedExternalTraffic: false, environment: { node: process.version, platform: process.platform, architecture: process.arch }, profiles, conclusions: { productionCapacityProven: false, note: 'Targets are exercised as synthetic orchestration workloads only. Real media stability, bandwidth, encoder saturation, cloud recovery time, and cost require an approved staging test.' } };
fs.mkdirSync('artifacts', { recursive: true }); fs.writeFileSync('artifacts/stream-reliability-report.json', `${JSON.stringify(report, null, 2)}\n`); console.log(JSON.stringify(report, null, 2));
