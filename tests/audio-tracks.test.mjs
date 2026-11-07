// tests/audio-tracks.test.mjs
// ─────────────────────────────────────────────────────────────
// Cueing a backing track: the transport and the identity rule.
//
// The identity rule is the one that matters. A cue sheet is a list of
// times, and times only mean anything against one recording — a
// different mix of the same song, one bar longer at the top, moves every
// cue in the set. So the rule refuses rather than warns, and it refuses
// the unknown case too.
// ─────────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  newTransport, loadTrack, unloadTrack, togglePlay, seekTo, reportPosition,
  setVolume, canDropCue, playheadMs, balanceGains, describeTransport,
  trackIdentityOk, describeIdentity, formatClock, formatCueTime,
  TRACK_DEFAULTS, NUDGE_STEPS_MS, TRANSPORT_STATES,
} from '../lib/audio/tracks.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const loaded = (durationS = 180, positionS = 0) => loadTrack(newTransport(), { trackId: 't1', durationS, positionS });

test('a loaded track arrives paused, never playing', () => {
  // The pilot's behaviour, and the reason is stronger on a phone: the
  // track will be mixed into the published audio, so a track that began
  // on load would go out.
  const t = loaded();
  assert.equal(t.state, 'paused');
  assert.equal(t.trackId, 't1');
  assert.equal(t.positionS, 0);
  assert.ok(TRANSPORT_STATES.includes(t.state));

  // Loading at an offset keeps the offset, still paused.
  assert.equal(loadTrack(newTransport(), { trackId: 't1', durationS: 180, positionS: 42 }).state, 'paused');
  assert.equal(loadTrack(newTransport(), { trackId: 't1', durationS: 180, positionS: 42 }).positionS, 42);
  // And an offset past the end is clamped rather than accepted.
  assert.equal(loadTrack(newTransport(), { trackId: 't1', durationS: 180, positionS: 9999 }).positionS, 180);
});

test('an empty transport cannot play, and nothing about it can be nudged into playing', () => {
  const empty = newTransport();
  assert.equal(empty.state, 'empty');
  assert.equal(togglePlay(empty).state, 'empty');
  assert.equal(seekTo(empty, 30).state, 'empty');
  assert.equal(reportPosition(empty, 30).state, 'empty');
  assert.equal(canDropCue(empty), false);
});

test('play, pause, and a finished track plays from the start', () => {
  let t = loaded();
  t = togglePlay(t);
  assert.equal(t.state, 'playing');
  t = togglePlay(t);
  assert.equal(t.state, 'paused');

  // Reaching the end is 'ended', not 'paused': to a cue sheet those are
  // different, because one has more cues coming and the other does not.
  t = reportPosition(togglePlay(t), 180);
  assert.equal(t.state, 'ended');
  assert.equal(t.positionS, 180);

  // Pressing play on a finished track is what an artist means by "again".
  t = togglePlay(t);
  assert.equal(t.state, 'playing');
  assert.equal(t.positionS, 0);
});

test('seeking moves the playhead and does not start or stop playback', () => {
  let t = loaded();
  t = seekTo(t, 90);
  assert.equal(t.positionS, 90);
  assert.equal(t.state, 'paused', 'a seek while paused stays paused');

  t = seekTo(togglePlay(t), 30);
  assert.equal(t.state, 'playing', 'and a seek while playing keeps playing');
  assert.equal(t.positionS, 30);

  // Clamped at both ends.
  assert.equal(seekTo(t, -50).positionS, 0);
  assert.equal(seekTo(t, 9999).positionS, 180);

  // Seeking back from the end makes it playable again rather than
  // leaving it 'ended' with the playhead somewhere in the middle.
  const finished = reportPosition(loaded(), 180);
  assert.equal(finished.state, 'ended');
  assert.equal(seekTo(finished, 10).state, 'paused');
});

test('a cue can be dropped paused or playing, and its time is the playhead', () => {
  const paused = seekTo(loaded(), 65.4);
  assert.equal(canDropCue(paused), true);
  assert.equal(playheadMs(paused), 65400);
  assert.equal(canDropCue(togglePlay(paused)), true);
  assert.equal(playheadMs(newTransport()), 0);
});

test('the balance never silences the voice', () => {
  // One slider, two gains. An artist pushing the balance to the track
  // end is asking for more track, not for their voice to disappear —
  // and on a live broadcast that distinction is the whole show.
  for (const v of [0, 0.3, TRACK_DEFAULTS.volume, 1]) {
    const g = balanceGains(v);
    assert.equal(g.voiceGain, 1, `voice stays at unity at volume ${v}`);
    assert.equal(g.trackGain, v);
  }
  assert.equal(balanceGains(5).trackGain, 1, 'clamped');
  assert.equal(balanceGains(-1).trackGain, 0);
  assert.equal(balanceGains(undefined).trackGain, TRACK_DEFAULTS.volume);

  // Volume survives unloading: it is the artist's preference, not a
  // property of the file.
  const t = setVolume(loaded(), 0.4);
  assert.equal(unloadTrack(t).volume, 0.4);
  assert.equal(unloadTrack(t).state, 'empty');
  assert.equal(unloadTrack(t).trackId, null);
});

test('a file that is not the one the cue sheet was written against is refused', () => {
  assert.deepEqual(trackIdentityOk({ rowHash: 'abc', fileHash: 'abc' }), { ok: true, reason: null });

  const mismatch = trackIdentityOk({ rowHash: 'abc', fileHash: 'def' });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.reason, 'mismatch');
  assert.match(describeIdentity(mismatch), /wrong places/);

  // The unknown case is refused too: no hash on either side is not
  // evidence that they match, and a cue sheet silently landing in the
  // wrong places is worse than a refusal an artist can act on.
  for (const args of [{ rowHash: 'abc' }, { fileHash: 'abc' }, {}, undefined]) {
    const r = trackIdentityOk(args);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'unverified');
    assert.ok(describeIdentity(r).length > 0);
  }
  assert.equal(describeIdentity({ ok: true }), null, 'a good file says nothing');
});

test('one time formatter each, and they agree about padding', () => {
  // Both of these lived in a panel each and disagreed: a cue at 1:05.00
  // read as 1:5.00 in one of them.
  assert.equal(formatClock(0), '0:00');
  assert.equal(formatClock(5), '0:05');
  assert.equal(formatClock(65), '1:05');
  assert.equal(formatClock(3600), '60:00');
  assert.equal(formatClock(-5), '0:00');
  assert.equal(formatClock('nonsense'), '0:00');

  assert.equal(formatCueTime(0), '0:00.00');
  assert.equal(formatCueTime(65000), '1:05.00', 'the padding bug, pinned');
  assert.equal(formatCueTime(5430), '0:05.43');
  assert.equal(formatCueTime(-1), '0:00.00');
  assert.equal(formatCueTime(undefined), '0:00.00');

  assert.deepEqual([...NUDGE_STEPS_MS], [-1000, -100, 100, 1000]);
});

test('the transport line says which of the four states it is in', () => {
  assert.match(describeTransport(newTransport()), /No track/);
  assert.match(describeTransport(loaded()), /^Ready/);
  assert.match(describeTransport(togglePlay(loaded())), /^Playing/);
  assert.match(describeTransport(reportPosition(loaded(), 180)), /^Finished/);
  assert.match(describeTransport(seekTo(loaded(), 65)), /1:05 \/ 3:00/);
});

test('every step returns a new frozen state, so a screen cannot mutate the transport', () => {
  const t = loaded();
  assert.ok(Object.isFrozen(t));
  const played = togglePlay(t);
  assert.notEqual(played, t, 'a step is a new object');
  assert.equal(t.state, 'paused', 'and the old one is untouched');
  assert.ok(Object.isFrozen(played));
});

test('lib/audio/tracks.js names no platform', () => {
  const src = readFileSync(resolve(ROOT, 'lib/audio/tracks.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  for (const word of ['AudioContext', 'Audio(', 'react', 'expo-', 'window.', 'document.', 'livekit']) {
    assert.ok(!src.toLowerCase().includes(word.toLowerCase()), `it names ${word}`);
  }
  assert.ok(!/from\s+'/.test(src), 'it imports nothing');
});
