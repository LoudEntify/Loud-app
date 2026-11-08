// Keeping a viewer watching without asking them anything
// (lib/player/continuity.js). The pilot's "tap to reconnect audio" button is
// the thing these rules exist to retire.
import test from 'node:test';
import assert from 'node:assert/strict';
import { soundPolicy, watchdogStep, LIVE_DRIFT_MS, STALL_MS, ACTION_GAP_MS, GIVE_UP_AFTER, GIVE_UP_MESSAGE } from '../lib/player/continuity.js';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

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

// ── The pre-show loop, 8 Nov ──────────────────────────────────
// PreshowAudio was one of the seven capability panels behind the pilot
// journey and used by nothing in the new one, so the new arrival screen
// was silent where the pilot had atmosphere. It is on the viewer's
// countdown card now, and these pin the two things that must not slip.

test('the pre-show loop is on the countdown card and never over the player', () => {
  const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');
  const show = read('components/viewer/ShowScreen.jsx');

  assert.match(show, /import PreshowAudio from '\.\.\/PreshowAudio'/);
  assert.match(show, /<PreshowAudio msToShowtime=\{countdown\}/);

  // docs/CLAUDE.md §6 is absolute: nothing may ever overlay the YouTube
  // player frame. So the control sits inside the countdown <section>,
  // which only renders while the show is not live — and the e2e suite
  // asserts "nothing over the player" at three viewport sizes.
  const card = show.indexOf('const waitingCard = !live ?');
  const panel = show.indexOf('<PreshowAudio');
  const cardEnd = show.indexOf(') : null;', card);
  assert.ok(card > 0 && panel > card && panel < cardEnd, 'it renders inside the not-live countdown card');

  // No absolute positioning introduced around it: that is how something
  // ends up over the frame without anyone intending it.
  assert.ok(!/position: 'absolute'[^}]*\}\s*\}>\s*<PreshowAudio/.test(show));
});

test('the pre-show loop plays only inside its window, and nothing at all when it cannot', () => {
  const src = readFileSync(resolve(ROOT, 'components/PreshowAudio.jsx'), 'utf8');

  // Not past showtime: at showtime the room's own audio takes over, and
  // two sources at once is worse than neither.
  assert.match(src, /msToShowtime > 0 && msToShowtime <= PRESHOW_AUDIO_LEAD_MS/);

  // Muted first, because every browser refuses autoplay with sound until
  // the viewer has interacted — a player that assumes otherwise fails
  // silently and looks like it is working.
  assert.match(src, /useState\(true\)/, 'muted by default');

  // And every failure path leaves no CONTROL rather than a broken one:
  // a missing track costs atmosphere, a dead button costs the arrival.
  //
  // The gate is on the button, not on the whole component — the <audio>
  // element has to exist and load for `onCanPlay` to ever fire, so a
  // `return null` before it would mean the control could never appear.
  // (My first version of this assertion looked for that return and was
  // simply wrong about the mechanism.)
  assert.match(src, /\{ready && \(/, 'the control appears only once the file can play');
  assert.match(src, /onError=\{\(\) => setReady\(false\)\}/, 'and a bad file takes it away again');
});
