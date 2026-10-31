// Keeping a viewer watching without asking them anything
// (lib/player/continuity.js). The pilot's "tap to reconnect audio" button is
// the thing these rules exist to retire.
import test from 'node:test';
import assert from 'node:assert/strict';
import { soundPolicy, watchdogStep, LIVE_DRIFT_MS, STALL_MS, ACTION_GAP_MS, GIVE_UP_AFTER, GIVE_UP_MESSAGE } from '../lib/player/continuity.js';

test('soundPolicy: the picture never waits for a decision about sound', () => {
  for (const activation of [true, false]) assert.equal(soundPolicy({ hasUserActivation: activation }).startMuted, true);
});

test('soundPolicy: a viewer who tapped their way in gets sound with no prompt', () => {
  const p = soundPolicy({ hasUserActivation: true });
  assert.equal(p.unmuteNow, true);
  assert.equal(p.prompt, false);
});

test('soundPolicy: a cold link still tries, and only then asks for a touch', () => {
  const p = soundPolicy({ hasUserActivation: false });
  assert.equal(p.unmuteNow, true, 'try anyway: some browsers allow it');
  assert.equal(p.prompt, true, 'and be ready to ask, because most will not');
});

test('soundPolicy: a viewer who chose muted is left muted', () => {
  const p = soundPolicy({ hasUserActivation: true, prefersMuted: true });
  assert.equal(p.unmuteNow, false);
  assert.equal(p.prompt, false);
});

const base = { state: 'playing', positionMs: 10_000, liveEdgeMs: 10_000, atMs: 1_000_000, visible: true, userPaused: false };

test('a playing viewer at the live edge is left alone', () => {
  assert.equal(watchdogStep(base, {}).action, 'none');
});

test('drifting behind live is pulled back', () => {
  const r = watchdogStep({ ...base, positionMs: 10_000, liveEdgeMs: 10_000 + LIVE_DRIFT_MS + 1 }, {});
  assert.equal(r.action, 'seekLive');
  assert.match(r.reason, /behind live/);
  // just inside the allowance: leave them be
  assert.equal(watchdogStep({ ...base, liveEdgeMs: 10_000 + LIVE_DRIFT_MS - 1 }, {}).action, 'none');
});

test('a short buffer is given its grace; a stall is not', () => {
  const start = watchdogStep({ ...base, state: 'buffering' }, {});
  assert.equal(start.action, 'none');
  assert.equal(start.memory.bufferingSince, base.atMs);
  const later = watchdogStep({ ...base, state: 'buffering', atMs: base.atMs + STALL_MS + 100 }, start.memory);
  assert.equal(later.action, 'seekLive');
});

test('a pause nobody asked for is undone; a pause the viewer asked for is theirs', () => {
  assert.equal(watchdogStep({ ...base, state: 'paused' }, {}).action, 'play');
  assert.equal(watchdogStep({ ...base, state: 'paused', userPaused: true }, {}).action, 'none');
});

test('a backgrounded tab is left alone, and resumed at the live edge when it returns', () => {
  const hidden = watchdogStep({ ...base, visible: false }, {});
  assert.equal(hidden.action, 'none');
  assert.equal(hidden.memory.wasHidden, true);
  const back = watchdogStep({ ...base, atMs: base.atMs + 60_000 }, hidden.memory);
  assert.equal(back.action, 'seekLive');
  assert.equal(back.memory.wasHidden, false);
});

test('the watchdog does not fight the player: one action, then a gap', () => {
  const first = watchdogStep({ ...base, state: 'paused' }, {});
  assert.equal(first.action, 'play');
  const tooSoon = watchdogStep({ ...base, state: 'paused', atMs: base.atMs + ACTION_GAP_MS - 1 }, first.memory);
  assert.equal(tooSoon.action, 'none');
  const later = watchdogStep({ ...base, state: 'paused', atMs: base.atMs + ACTION_GAP_MS + 1 }, first.memory);
  assert.equal(later.action, 'play');
});

test('when nudging stops working it reloads once, then says so instead of thrashing', () => {
  let memory = {};
  let at = base.atMs;
  for (let i = 0; i < GIVE_UP_AFTER; i++) {
    const r = watchdogStep({ ...base, state: 'paused', atMs: at }, memory);
    assert.equal(r.action, 'play');
    memory = r.memory; at += ACTION_GAP_MS + 1;
  }
  const giveUp = watchdogStep({ ...base, state: 'paused', atMs: at }, memory);
  assert.equal(giveUp.action, 'reload');
  assert.equal(giveUp.memory.gaveUp, true);
  const after = watchdogStep({ ...base, state: 'paused', atMs: at + 60_000 }, giveUp.memory);
  assert.equal(after.action, 'none', 'no endless reload loop');
  assert.match(GIVE_UP_MESSAGE, /still running/);
});

test('an error reloads the player', () => {
  assert.equal(watchdogStep({ ...base, state: 'error' }, {}).action, 'reload');
});
