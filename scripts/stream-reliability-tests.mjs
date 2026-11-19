import assert from 'node:assert/strict';
import { RELIABILITY_SCENARIOS, runReliabilityScenario, summarizeMeasurements } from '../lib/streamReliabilityHarness.mjs';

const results = [];
for (const scenario of RELIABILITY_SCENARIOS) results.push(await runReliabilityScenario(scenario, { showCount: scenario === 'multiple_concurrent_shows' ? 5 : 1 }));
assert.equal(results.length, 12);
assert.ok(results.every(result => result.passed), JSON.stringify(results.filter(result => !result.passed)));
const repeated = results.find(result => result.scenario === 'repeated_show_start'); assert.equal(repeated.passed, true);
const concurrent = results.find(result => result.scenario === 'concurrent_show_start'); assert.equal(concurrent.passed, true);
const summary = summarizeMeasurements(results); assert.equal(summary.attempts, 12); assert.equal(summary.errorRate, 0); assert.ok(summary.youtubeApiCalls > 0);
console.log('stream reliability: all 12 synthetic fault and lifecycle scenarios passed');
