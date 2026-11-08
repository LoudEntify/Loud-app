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

// ── Mixing a track into what goes out (step 2b) ──────────────────

const { TRACK_NEEDS_HEADPHONES, trackPlaybackAllowed, resampleRatio,
        trackSamplesFor, driftMsOver, nativeTrackConfig } = await import('../lib/audio/tracks.js');

test('cueing a track on a phone requires headphones, and that is a rule not a preference', () => {
  assert.equal(TRACK_NEEDS_HEADPHONES, true);

  // Through the speaker the microphone hears the track too, so it goes
  // out twice a few milliseconds apart — a comb filter on the whole
  // show, not a quality niggle.
  const none = trackPlaybackAllowed({ headphones: null });
  assert.equal(none.ok, false);
  assert.match(none.reason, /goes out twice/);

  const wired = trackPlaybackAllowed({ headphones: 'wired' });
  assert.equal(wired.ok, true);
  assert.equal(wired.warn, null);

  // Bluetooth is allowed but warned about: it puts the artist behind
  // their own track, which is what the delay check corrects.
  const bt = trackPlaybackAllowed({ headphones: 'bluetooth' });
  assert.equal(bt.ok, true);
  assert.match(bt.warn, /behind your own track/);

  assert.equal(trackPlaybackAllowed().ok, false, 'unknown is not permission');
});

test('the resample ratio is the thing that must not be wrong', () => {
  // A phone captures at 48k; a downloaded track is usually 44.1k.
  const ratio = resampleRatio(44100, 48000);
  assert.ok(Math.abs(ratio - 0.91875) < 1e-9);
  assert.equal(resampleRatio(48000, 48000), 1);
  assert.ok(resampleRatio(96000, 48000) === 2);

  // Nonsense is 1 rather than 0 or NaN: a ratio of 0 would freeze the
  // track and a NaN would silence it, and both would look like a broken
  // player rather than a bad number.
  for (const bad of [[0, 48000], [44100, 0], [NaN, 48000], ['x', 'y'], [undefined, undefined]]) {
    assert.equal(resampleRatio(...bad), 1);
  }

  // Why it matters, as a number rather than an argument. A 44.1k file
  // played as if it were 48k is consumed 8.8% too fast, so a five-minute
  // song finishes about 24 seconds early — and nobody hears four bars of
  // it as wrong pitch, so it is found at the end of the song rather than
  // the start.
  assert.ok(Math.abs(driftMsOver(300, ratio) - 24375) < 50, 'about 24s over five minutes');
  assert.ok(Math.abs((300 - 300 * ratio) - 24.4) < 0.1, 'and that is what 8.8% of five minutes is');
  assert.equal(driftMsOver(300, 1), 0);

  // And the per-frame consumption follows the ratio.
  assert.equal(trackSamplesFor(480, 1), 480);
  assert.equal(trackSamplesFor(480, 0.91875), 441);
  assert.equal(trackSamplesFor(0, 0.91875), 0);
  assert.equal(trackSamplesFor(-10, 1), 0, 'never negative');
});

test('the native mixer is handed the ratio and both gains, and computes neither', () => {
  const t = setVolume(togglePlay(loaded(200)), 0.6);
  const c = nativeTrackConfig({ transport: t, fileRate: 44100, captureRate: 48000 });

  assert.equal(c.playing, true);
  assert.equal(c.trackGain, 0.6);
  assert.equal(c.voiceGain, 1, 'the voice is never attenuated by the balance');
  assert.ok(Math.abs(c.ratio - 0.91875) < 1e-9);
  assert.equal(c.captureRate, 48000);
  assert.equal(c.fileRate, 44100);

  // A paused transport says so, so the mixer adds silence rather than
  // the native side deciding what paused means.
  assert.equal(nativeTrackConfig({ transport: loaded(200), fileRate: 44100, captureRate: 48000 }).playing, false);
  // And no transport at all is an empty one rather than a crash.
  assert.equal(nativeTrackConfig({ fileRate: 44100, captureRate: 48000 }).playing, false);
});

test('the Kotlin mixer is handed the ratio and the gain, and works them out for nothing', () => {
  const ROOT_KT = 'native/modules/loud-camera/android/src/main/java/app/loudentify/loudcamera';
  const codeOf = (p) => readFileSync(resolve(ROOT, p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

  const track = codeOf(`${ROOT_KT}/LoudBackingTrack.kt`);
  // The ratio arrives in the config and is used as given. A rate
  // conversion computed natively would be a second definition of the
  // one number that must not be wrong.
  assert.match(track, /val ratio: Float = 1f/);
  assert.match(track, /val ratio = c\.ratio\.toDouble\(\)/);
  assert.ok(!/44100|48000\s*\/|\/\s*48000/.test(track.replace(/sourceRate = 44100/, '')), 'no rate arithmetic of its own');

  // Linear interpolation, and the playhead is fractional — an integer
  // playhead would quantise the ratio back to 1 and the track would
  // drift exactly as badly as a wrong ratio.
  assert.match(track, /pcm\[idx\] \* \(1f - frac\) \+ pcm\[idx \+ 1\] \* frac/);
  assert.match(track, /private var position = 0\.0/);

  // Decoding never happens on the audio thread, and the decoder's own
  // output rate wins over the container's.
  assert.match(track, /INFO_OUTPUT_FORMAT_CHANGED/);
  const mod = codeOf(`${ROOT_KT}/LoudCameraModule.kt`);
  assert.match(mod, /io\.execute \{/, 'the decode runs on its own thread');
  assert.match(mod, /newSingleThreadExecutor/);

  // The track joins the signal AFTER the vocal chain's crossfade: a
  // mastered recording does not want a vocal compressor over it, and
  // the pilot's graph does not give it one.
  const chain = codeOf(`${ROOT_KT}/LoudVocalChain.kt`);
  const crossfade = chain.indexOf('processedGain + trimmed');
  const mix = chain.indexOf('track.mixInto');
  assert.ok(crossfade > 0 && mix > crossfade, 'the track is mixed after the crossfade, not through the chain');
});

test('the phone orchestration holds no rules of its own', () => {
  const js = readFileSync(resolve(ROOT, 'native/src/backingTrack.js'), 'utf8');
  assert.match(js, /nativeTrackConfig\(/);
  assert.match(js, /trackIdentityOk\(/, 'the identity rule is the shared one');
  assert.match(js, /trackPlaybackAllowed\(/, 'and so is the headphone rule');
  // The native mixer owns the playhead, because it is the thing
  // consuming samples. A transport counting time itself would drift
  // against the audio exactly as a wrong resample ratio would.
  assert.match(js, /reportPosition\(t, s\.positionSeconds\)/);
  assert.ok(!/0\.91875|44100/.test(js), 'no rates written into the delivery layer');
});

test('the console drives the shared transport rather than its own', () => {
  const console_ = readFileSync(resolve(ROOT, 'native/app/artist/console/[id].js'), 'utf8');

  // The hook, and the shared describing — so the phone and the website
  // name the same four transport states identically.
  assert.match(console_, /useBackingTrack\(\)/);
  assert.match(console_, /describeTransport\(backing\.transport\)/);

  // Play/pause goes through the transport, never straight at the mixer:
  // the transport is what the screen and the native side agree on, and
  // a screen poking the mixer would make them disagree.
  assert.match(console_, /onPress=\{backing\.togglePlay\}/);
  assert.ok(
    !/setBackingTrack\(/.test(console_),
    'the console must not configure the mixer directly',
  );

  // The playhead drawn is the transport's, which is read back FROM the
  // mixer (native/src/backingTrack.js) rather than counted on screen.
  assert.match(console_, /backing\.transport\.positionS/);
  assert.match(console_, /backing\.transport\.durationS/);

  // And the headphone rule is stated where an artist meets it, in the
  // words of the reason rather than as an instruction to obey.
  assert.match(console_, /goes out twice/);
});

test('the transport outlives the screen, which is the bug the web had already fixed', async () => {
  // #58 and #62 held the transport in React state inside the hook. The
  // samples live in the native module and survive any unmount, so
  // closing the console left a track PLAYING into the broadcast while
  // the screen's transport read "no track loaded" — and reopening it
  // showed a stopped transport over audible audio.
  //
  // components/BackingTrackPanel.jsx had this exact bug and its header
  // records the fix. I read that comment while lifting these rules into
  // lib/audio/tracks.js and still put the phone's copy in a hook.
  const host = await import('../native/src/backingTrackHost.js');
  const { newTransport: fresh, loadTrack: load, togglePlay: play } = await import('../lib/audio/tracks.js');

  host.resetBackingTrackHost();
  // The host starts holding NO transport rather than its own idea of an
  // empty one: it imports nothing, so there is exactly one definition
  // of "no track loaded" and it lives in lib/audio/tracks.js.
  assert.equal(host.getBackingTrackHost().transport, null);

  // A "screen" loads and plays.
  host.setTransport(load(fresh(), { trackId: 't1', durationS: 200 }));
  host.setLoadedTrack({ trackId: 't1', fileRate: 44100 });
  host.setTransport(play);
  assert.equal(host.getBackingTrackHost().transport.state, 'playing');

  // That "screen" goes away. Nothing unmounts the host, so a second
  // screen sees the same playing track rather than an empty transport.
  assert.equal(host.getBackingTrackHost().transport.state, 'playing');
  assert.equal(host.getBackingTrackHost().trackId, 't1');
  assert.equal(host.getBackingTrackHost().fileRate, 44100);

  // Subscribers are told, and the version moves, so a view re-renders
  // without deep-comparing — the same mechanism as lib/audioHost.js.
  let told = 0;
  const stop = host.subscribeBackingTrack(() => { told += 1; });
  const before = host.getBackingTrackVersion();
  host.setTransport((t) => play(t));
  assert.equal(told, 1);
  assert.ok(host.getBackingTrackVersion() > before);

  // A thrown subscriber must never break audio.
  const stopBad = host.subscribeBackingTrack(() => { throw new Error('bad view'); });
  host.setTransport((t) => play(t));
  stopBad(); stop();

  host.resetBackingTrackHost();
  assert.equal(host.getBackingTrackHost().transport, null, 'reset clears it, for sign-out');
});

test('the hook is a view of the host rather than an owner of the transport', () => {
  const hook = readFileSync(resolve(ROOT, 'native/src/backingTrack.js'), 'utf8');
  assert.match(hook, /useSyncExternalStore\(subscribeBackingTrack/, 'it subscribes');
  assert.ok(
    !/useState\(newTransport/.test(hook),
    'and never holds the transport in component state',
  );
  assert.ok(!/useRef/.test(hook), 'nor the file rate in a ref that dies with the screen');
});

test('the loader verifies the bytes it fetched, and refuses rather than plays', () => {
  const loader = readFileSync(resolve(ROOT, 'native/src/trackLoader.js'), 'utf8');

  // The identity check is the point of this module, not a flourish: a
  // cue sheet is a list of times against one recording.
  assert.match(loader, /trackIdentityOk\(\{ rowHash, fileHash/);
  assert.match(loader, /describeIdentity\(ident\)/, 'and a refusal carries its sentence');

  // A cached file is re-verified rather than trusted, so a half-written
  // file from an interrupted download is never played as the track.
  assert.match(loader, /if \(existing\?\.exists\)/);
  assert.match(loader, /sha256OfFile\(path\)/, 'the cached file is hashed too');

  // Downloaded to a .part and moved only once whole, which is what makes
  // the cache trustworthy in the first place.
  assert.match(loader, /\$\{path\}\.part/);
  assert.match(loader, /moveAsync\(\{ from: partial, to: path \}\)/);

  // Every failure path deletes the partial file. A failed cue must not
  // leave something behind that the next cue mistakes for the track.
  const deletes = loader.match(/deleteAsync\(partial/g) || [];
  assert.ok(deletes.length >= 2, 'the partial is cleaned up on refusal and on error');
});

test('the studio asks about headphones rather than guessing, and only for tracks', () => {
  const studio = readFileSync(resolve(ROOT, 'native/app/settings/studio.js'), 'utf8');

  // The capturer reports no audio routes, so this is the artist's own
  // answer — the same way Kit Check asks it, for the same reason.
  assert.match(studio, /cueTrack\(options, 'wired'\)/);
  assert.match(studio, /cueTrack\(options, 'bluetooth'\)/);
  assert.ok(!/headphones: *(true|'unknown')/.test(studio), 'never assumed');

  // The reason is given, not the rule.
  assert.match(studio, /go out twice/);

  // A cue sheet or a set list is not something the mixer can play.
  assert.match(studio, /options\.kind === 'tracks' \? \(/);

  // And the transport it reads is the host's, so leaving this screen
  // does not unload the track the console is about to play.
  assert.match(studio, /useBackingTrack\(\)/);
  assert.match(studio, /backing\.transport\.trackId === options\.id/);
});
