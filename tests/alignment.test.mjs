import { test } from 'node:test';
import assert from 'node:assert/strict';
import { voteDecision, measuredDelayMs, attributeToPrompt, serverOffsetMs } from '../lib/alignment.js';

const T0 = Date.parse('2026-10-02T20:00:00Z');
const show = { actual_started_at: new Date(T0).toISOString() };
const iso = (ms) => new Date(T0 + ms).toISOString();

test('measured delay is server offset minus playback position', () => {
  assert.equal(measuredDelayMs(show, T0 + 60_000, 54_000), 6_000);
  assert.equal(measuredDelayMs({}, T0, 1000), null);
});

for (const delay of [3000, 5000, 8000, 10000]) {
  test(`a vote cast within ${delay / 1000}s delay after close is accepted (grace), a vote well after is not`, () => {
    const prompt = { pushed_at: iso(100_000), closed_at: iso(160_000), grace_seconds: 15 };
    // viewer sees the close `delay` ms late and taps 1s after seeing it
    const nowMs = T0 + 160_000 + delay + 1000;
    const playback = 160_000 + 1000; // what they saw: just past the close on their screen
    const d = voteDecision({ prompt, show, nowMs, playbackPositionMs: playback });
    assert.equal(d.accept, true, `delay ${delay}: ${d.reason}`);
    // 30 s after close is refused regardless of what the player says
    const late = voteDecision({ prompt, show, nowMs: T0 + 190_000 + delay, playbackPositionMs: 150_000 });
    assert.equal(late.accept, false); assert.equal(late.reason, 'closed');
  });
}

test('a viewer whose picture is already well past the close cannot vote on grace alone', () => {
  const prompt = { pushed_at: iso(100_000), closed_at: iso(160_000), grace_seconds: 15 };
  const d = voteDecision({ prompt, show, nowMs: T0 + 165_000, playbackPositionMs: 190_000 });
  assert.equal(d.accept, false); assert.equal(d.reason, 'after_close_on_screen');
});

test('open prompts accept; grace_seconds 0 means no grace', () => {
  assert.equal(voteDecision({ prompt: { closed_at: null }, show, nowMs: T0 }).accept, true);
  const strict = { pushed_at: iso(0), closed_at: iso(10_000), grace_seconds: 0 };
  assert.equal(voteDecision({ prompt: strict, show, nowMs: T0 + 10_001, playbackPositionMs: 5000 }).accept, false);
});

test('a reaction is attributed to the round the viewer was watching, not the one the server is in', () => {
  const rounds = [
    { id: 'r1', pushed_at: iso(0), closed_at: iso(60_000) },
    { id: 'r2', pushed_at: iso(60_000), closed_at: null },
  ];
  // server is 8 s into round 2, viewer (8 s behind) still sees round 1
  const nowMs = T0 + 68_000;
  assert.equal(attributeToPrompt(rounds, { show, nowMs, playbackPositionMs: 60_000 - 1 }).id, 'r1');
  assert.equal(attributeToPrompt(rounds, { show, nowMs, playbackPositionMs: null }).id, 'r2', 'no position: wall clock');
  assert.equal(serverOffsetMs(show, T0 + 5), 5);
});
