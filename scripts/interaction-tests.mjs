import assert from 'node:assert/strict';
import { boundedLatency, hashInteractionToken, voterKey, votingWindow } from '../lib/interactions.mjs';

const prompt = { opens_at: '2026-01-01T12:00:00Z', closes_at: '2026-01-01T12:01:00Z', latency_allowance_ms: 30000 };
assert.deepEqual(votingWindow(prompt, Date.parse('2026-01-01T11:59:59Z')).reason, 'NOT_OPEN');
assert.deepEqual(votingWindow(prompt, Date.parse('2026-01-01T12:00:30Z')).reason, 'OPEN');
assert.deepEqual(votingWindow(prompt, Date.parse('2026-01-01T12:01:20Z')).reason, 'LATENCY_GRACE');
assert.deepEqual(votingWindow(prompt, Date.parse('2026-01-01T12:01:31Z')).reason, 'CLOSED');
assert.equal(voterKey({ userId: 'user-a', sessionId: 'session-a' }), 'user:user-a');
assert.equal(voterKey({ sessionId: 'session-a' }), 'session:session-a');
assert.throws(() => voterKey({}));
assert.equal(hashInteractionToken('secret'), hashInteractionToken('secret'));
assert.notEqual(hashInteractionToken('secret'), hashInteractionToken('other'));
assert.equal(boundedLatency(-10), 0);
assert.equal(boundedLatency(999999), 120000);
assert.equal(boundedLatency('unknown'), null);
console.log('interactions: identity, duplicate keying and latency windows passed');
