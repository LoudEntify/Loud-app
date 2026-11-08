// tests/audio-sync.test.mjs
// ─────────────────────────────────────────────────────────────
// Headphone delay: the rejection rules, which are the whole safety of
// the feature.
//
// A bad measurement applied is worse than none. Over- or
// under-compensating puts an artist further behind the track than
// leaving them alone, and they would not know why, so every one of these
// tests is about refusing rather than measuring.
// ─────────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  median, medianAbsoluteDeviation, summariseCalibration, describeCalibration,
  REP_COUNT, DISCARD_COUNT, TOTAL_COUNTED, MIN_VALID_ONSETS, MAD_REJECT_MS,
  MAX_COMPENSATION_MS, LARGE_DELAY_WARNING_MS,
} from '../lib/audio/sync.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** A run of `n` answers around `ms`, with the lead-in reps in front. */
const run = (ms, n = TOTAL_COUNTED, spread = 0) => [
  ...Array(DISCARD_COUNT).fill(ms + 200),          // the lead-in: deliberately wild
  ...Array.from({ length: n }, (_, i) => ms + (i % 2 ? spread : -spread)),
  ...Array(TOTAL_COUNTED - n).fill(null),
];

test('the middle is a median, so one missed answer cannot drag it', () => {
  assert.equal(median([10, 12, 14]), 12);
  assert.equal(median([10, 12, 14, 16]), 13);
  // The case the mean would fail: one wild value among good ones.
  assert.equal(median([40, 42, 44, 43, 900]), 43);
  assert.equal(median([]), null);
  assert.equal(median([null, undefined, NaN]), null, 'nothing measured is not a number');

  assert.equal(medianAbsoluteDeviation([50, 50, 50]), 0);
  assert.equal(medianAbsoluteDeviation([40, 50, 60]), 10);
  assert.equal(medianAbsoluteDeviation([]), null);
});

test('the lead-in reps are dropped here, so no platform can forget to drop them', () => {
  // The first two are 200ms out, which is the artist finding the tempo.
  // If they counted, the median would be dragged and the spread would
  // reject the whole run.
  const r = summariseCalibration(run(60));
  assert.equal(r.accepted, true);
  assert.equal(r.medianMs, 60, 'the lead-in did not reach the median');
  assert.equal(r.rawOffsetsMs.length, TOTAL_COUNTED);
  assert.equal(r.totalCounted, TOTAL_COUNTED);
  assert.equal(REP_COUNT - DISCARD_COUNT, TOTAL_COUNTED);
});

test('too few answers heard is a refusal, not a guess from what there is', () => {
  const r = summariseCalibration(run(60, MIN_VALID_ONSETS - 1));
  assert.equal(r.accepted, false);
  assert.equal(r.reason, 'too_few_onsets');
  assert.equal(r.compensationMs, null, 'nothing is applied');
  assert.equal(r.medianMs, null, 'and no median is reported, because it would look like an answer');

  // One more answer and the same run is trusted: the gate is the count.
  assert.equal(summariseCalibration(run(60, MIN_VALID_ONSETS)).accepted, true);
});

test('answers that disagree with each other are refused, however many there are', () => {
  // A full set of answers, spread far too wide: someone guessing rather
  // than answering. The median would look perfectly reasonable.
  const noisy = summariseCalibration(run(60, TOTAL_COUNTED, MAD_REJECT_MS + 10));
  assert.equal(noisy.accepted, false);
  assert.equal(noisy.reason, 'too_noisy');
  assert.equal(noisy.compensationMs, null);
  assert.ok(noisy.madMs > MAD_REJECT_MS);
  // The median IS reported here, because the screen shows what was
  // measured alongside the refusal — the artist can see it was close.
  assert.equal(noisy.medianMs, 60);

  const tight = summariseCalibration(run(60, TOTAL_COUNTED, 5));
  assert.equal(tight.accepted, true);
  assert.ok(tight.madMs <= MAD_REJECT_MS);
});

test('a cancelled run applies nothing, even when its numbers were good', () => {
  const r = summariseCalibration(run(60), { cancelled: true });
  assert.equal(r.accepted, false);
  assert.equal(r.reason, 'cancelled');
  assert.equal(r.compensationMs, null);
});

test('compensation is clamped, because no correction can be longer than the delay line', () => {
  const huge = summariseCalibration(run(5000));
  assert.equal(huge.accepted, true);
  assert.equal(huge.compensationMs, MAX_COMPENSATION_MS);

  // A negative measurement means the artist answered before the click,
  // which is a timing error rather than a negative delay.
  const early = summariseCalibration(run(-80));
  assert.equal(early.compensationMs, 0);
});

test('every outcome ends in a result or an action', () => {
  const outcomes = [
    describeCalibration(null),
    describeCalibration(summariseCalibration(run(60), { cancelled: true })),
    describeCalibration(summariseCalibration(run(60, 2))),
    describeCalibration(summariseCalibration(run(60, TOTAL_COUNTED, MAD_REJECT_MS + 10))),
    describeCalibration(summariseCalibration(run(60))),
    describeCalibration(summariseCalibration(run(5))),
    describeCalibration(summariseCalibration(run(LARGE_DELAY_WARNING_MS + 50))),
  ];
  for (const o of outcomes) {
    assert.ok(o.line && o.line.length > 0, 'every outcome says something');
    assert.ok(o.action === null || o.action.length > 0, 'and either acts or is finished');
  }
});

test('a delay too large to sing through says so, and still corrects what it can', () => {
  const big = describeCalibration(summariseCalibration(run(LARGE_DELAY_WARNING_MS + 50)));
  assert.equal(big.wired, true);
  assert.match(big.action, /[Ww]ire/);
  assert.equal(big.applied, LARGE_DELAY_WARNING_MS + 50, 'the correction is still applied');

  const normal = describeCalibration(summariseCalibration(run(60)));
  assert.equal(normal.wired, false);
  assert.equal(normal.action, null);
  assert.match(normal.line, /60 ms/);
  // The floor it cannot beat is stated, so an artist does not re-run it
  // expecting perfection.
  assert.ok(normal.note && normal.note.length > 0);

  // Near zero: nothing to correct, and it says that rather than
  // reporting a 3ms triumph.
  const wired = describeCalibration(summariseCalibration(run(4)));
  assert.match(wired.line, /Almost no delay/);
  assert.equal(wired.action, null);
});

test('the web measurement holds no copy of these numbers', () => {
  // The vocal chain's mistake was two copies of the same seven numbers.
  // This is the same module relationship: the measurement is platform
  // work, the thresholds are not.
  const web = readFileSync(resolve(ROOT, 'lib/audioSyncCalibration.js'), 'utf8');
  const code = web.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

  assert.match(code, /from '\.\/audio\/sync\.js'/, 'it reads the shared module');
  assert.match(code, /summariseCalibration\(offsetsMs/, 'and the verdict is the shared one');
  // No second definition of the statistics or the gates.
  assert.ok(!/function median\b/.test(code), 'median is not defined twice');
  assert.ok(!/function medianAbsoluteDeviation\b/.test(code), 'MAD is not defined twice');
  assert.ok(!/MAD_REJECT_MS = \d/.test(code), 'the rejection threshold is not a literal here');
  assert.ok(!/REP_COUNT = \d/.test(code), 'the rep count is not a literal here');
});

test('lib/audio/sync.js names no platform', () => {
  const src = readFileSync(resolve(ROOT, 'lib/audio/sync.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  for (const word of ['AudioContext', 'Analyser', 'react', 'expo-', 'window.', 'document.']) {
    assert.ok(!src.toLowerCase().includes(word.toLowerCase()), `lib/audio/sync.js names ${word}`);
  }
  assert.ok(!/from\s+'/.test(src), 'it imports nothing');
});

test('the shared ceiling matches the delay line the web actually builds', () => {
  // MAX_COMPENSATION_MS replaced SYNC_DELAY_MAX_S * 1000 in the web's
  // clamp. If the two ever drift apart, the web would try to set a delay
  // longer than the node it created, which Web Audio silently clamps —
  // so the artist would be told 600ms was corrected while 500 was.
  const proc = readFileSync(resolve(ROOT, 'lib/audioProcessing.js'), 'utf8');
  const m = proc.match(/SYNC_DELAY_MAX_S\s*=\s*([\d.]+)/);
  assert.ok(m, 'lib/audioProcessing.js still declares the delay line length');
  assert.equal(Number(m[1]) * 1000, MAX_COMPENSATION_MS);
});

// ── Hearing the answer ───────────────────────────────────────────
// The detector has to tell a sung "bah" from the click it is answering,
// including the click bleeding into a shared earbud microphone. These
// tests feed it synthetic frames, which is the only way to be sure the
// gates do what their names say before any of it reaches a phone.

const { newOnsetState, onsetStep, onsetThreshold, updateFloor, soundsLikeVoice,
        ONSET_BLANKING_MS, ONSET_SUSTAIN_MS, ONSET_MIN_ABSOLUTE_RMS,
        ONSET_LOW_HIGH_RATIO_MIN } = await import('../lib/audio/sync.js');

/** Frames every 10ms from `from` to `to`, all identical. */
function feed(state, from, to, frame, stepMs = 10) {
  let s = state;
  for (let t = from; t <= to; t += stepMs) s = onsetStep(s, { sinceClickMs: t, ...frame });
  return s;
}

const VOICE = { rms: 0.3, lowEnergy: 10, highEnergy: 1 };   // vowel energy well above the click band
const CLICK = { rms: 0.4, lowEnergy: 1, highEnergy: 10 };   // the click, or its leakage
const QUIET = { rms: 0.004, lowEnergy: 0.01, highEnergy: 0.01 };

test('the trigger sits above the room, and never below the absolute floor', () => {
  // A silent room must not become hypersensitive: the floor is a floor.
  // A dead-silent room: the absolute floor wins, so the detector does
  // not start hearing its own hiss.
  assert.equal(onsetThreshold(0), ONSET_MIN_ABSOLUTE_RMS);
  // No floor learned yet means the DEFAULT floor, which still gets the
  // margin — so the first frames of a run are not hypersensitive
  // either. 14 dB above 0.02 is about 0.10.
  assert.ok(Math.abs(onsetThreshold(undefined) - 0.1002) < 0.001);
  // A noisy room raises it: 14 dB above the floor is about 5x.
  assert.ok(onsetThreshold(0.1) > 0.4);

  // The floor follows the room slowly, and only moves toward it.
  const risen = updateFloor(0.01, 0.2);
  assert.ok(risen > 0.01 && risen < 0.2, 'it eases rather than jumps');
  assert.equal(updateFloor(0.01, undefined), 0.01, 'an unreadable frame moves nothing');
});

test('the click coming back is not mistaken for the answer', () => {
  // Energy in the click's own band, loud, sustained — and still refused,
  // because it is in the wrong band. This is the leakage case on shared
  // earbuds, which is the one that would otherwise measure near zero
  // delay and "correct" nothing while reporting success.
  const s = feed(newOnsetState(), ONSET_BLANKING_MS, 400, CLICK);
  assert.equal(s.phase, 'idle');
  assert.equal(s.onsetMs, null);

  assert.equal(soundsLikeVoice(10, 1), true);
  assert.equal(soundsLikeVoice(1, 10), false);
  assert.equal(soundsLikeVoice(ONSET_LOW_HIGH_RATIO_MIN, 1), true, 'the ratio is inclusive at its edge');
  assert.equal(soundsLikeVoice(undefined, 1), false);
});

test('the click\'s own moment is ignored outright', () => {
  // Even a perfect voice frame inside the blanking window is dropped: at
  // that distance it cannot be an answer to a click that has only just
  // left.
  const s = feed(newOnsetState(), 0, ONSET_BLANKING_MS - 1, VOICE);
  assert.equal(s.phase, 'idle');
});

test('a sustained voice is confirmed, and timed from where it started', () => {
  let s = newOnsetState();
  // Quiet first, so the floor is learned from the room.
  s = feed(s, ONSET_BLANKING_MS, 50, QUIET);
  assert.equal(s.phase, 'idle');

  // Then the answer, held past the sustain gate.
  s = feed(s, 60, 60 + ONSET_SUSTAIN_MS + 20, VOICE);
  assert.equal(s.phase, 'confirmed');
  // The measurement is where the voice STARTED, not where it was
  // confirmed — otherwise every reading would be 40ms too long and the
  // correction would overshoot by the length of its own gate.
  assert.equal(s.onsetMs, 60);
});

test('a short burst is not an answer, however loud', () => {
  // A tap on the mic stand, a chair, a door: loud, in the voice band,
  // and gone before the sustain gate. The pilot's own reason for having
  // the gate.
  let s = newOnsetState();
  s = feed(s, ONSET_BLANKING_MS, 50, QUIET);
  s = feed(s, 60, 60 + ONSET_SUSTAIN_MS - 20, VOICE);   // too short
  assert.equal(s.phase, 'pending', 'it is a candidate');
  s = onsetStep(s, { sinceClickMs: 100, ...QUIET });     // and then it stops
  assert.equal(s.phase, 'idle');
  assert.equal(s.onsetMs, null, 'nothing is reported');
});

test('once confirmed, nothing later changes the answer', () => {
  let s = newOnsetState();
  s = feed(s, ONSET_BLANKING_MS, 50, QUIET);
  s = feed(s, 60, 60 + ONSET_SUSTAIN_MS + 10, VOICE);
  assert.equal(s.phase, 'confirmed');
  const after = feed(s, 200, 500, VOICE);
  assert.equal(after.onsetMs, 60, 'the rest of the syllable is not a second onset');
});

test('the loud frames do not teach the floor that a voice is the room', () => {
  let s = newOnsetState();
  s = feed(s, ONSET_BLANKING_MS, 50, QUIET);
  const floorBefore = s.floorRms;
  s = feed(s, 60, 120, VOICE);
  assert.equal(s.floorRms, floorBefore, 'the floor only learns while nothing is happening');
});

test('the band-pass passes its own band and rejects the other', async () => {
  const { bandpassCoefficients, biquadStep, newBiquadState } = await import('../lib/audio/dsp.js');
  const { ONSET_LOW_BAND_HZ, ONSET_HIGH_BAND_HZ } = await import('../lib/audio/sync.js');
  const RATE = 48000;

  // The same measurement the high-pass tests use: push a real sine wave
  // through the difference equation and see what comes out.
  const responseAt = (hz, c) => {
    const state = newBiquadState();
    let peak = 0;
    const n = Math.ceil(RATE / 4);
    for (let i = 0; i < n; i += 1) {
      const y = biquadStep(c, Math.sin((2 * Math.PI * hz * i) / RATE), state);
      if (i > n / 2 && Math.abs(y) > peak) peak = Math.abs(y);   // after it settles
    }
    return peak;
  };

  const low = bandpassCoefficients(...ONSET_LOW_BAND_HZ, RATE);
  const high = bandpassCoefficients(...ONSET_HIGH_BAND_HZ, RATE);

  // Measured, then judged by the gate that actually uses these numbers
  // rather than by a round figure I picked. The vowel band is wide
  // (Q 0.35), so its skirt is shallow and 4 kHz still leaks through it
  // at about a third — which does not matter, because the decision is a
  // RATIO between the two bands, and that is what is asserted.
  const vowel = { low: responseAt(500, low), high: responseAt(500, high) };
  const click = { low: responseAt(4000, low), high: responseAt(4000, high) };

  assert.ok(vowel.low > 0.9, 'a vowel passes the vowel band');
  assert.ok(click.high > 0.9, 'the click passes the click band');
  assert.ok(click.low < 0.5, 'and the vowel band attenuates the click');
  assert.ok(vowel.high < 0.2, 'and the click band attenuates the vowel');

  // The separation is the whole mechanism by which leakage is refused:
  // a sung vowel reads as voice, the click coming back does not.
  assert.equal(soundsLikeVoice(vowel.low, vowel.high), true, 'a vowel is heard as voice');
  assert.equal(soundsLikeVoice(click.low, click.high), false, 'the click is not');

  // Centre is the geometric mean, which is the centre a log ear hears.
  assert.ok(Math.abs(low.centreHz - Math.sqrt(150 * 1500)) < 1);
  // And every coefficient is finite at an impossible ask.
  for (const v of Object.values(bandpassCoefficients(1, 1, 8000))) assert.ok(Number.isFinite(v));
});

test('the Kotlin detector is a transcription, and can be read against its reference', () => {
  const kt = readFileSync(resolve(ROOT, 'native/modules/loud-camera/android/src/main/java/app/loudentify/loudcamera/LoudSyncCalibration.kt'), 'utf8');
  const code = kt.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

  // It computes no thresholds. Every gate arrives in the config, so the
  // phone and the browser cannot come to different conclusions — the
  // mistake lib/audio/chain.js exists to prevent.
  for (const [name, literal] of [
    ['ratioMin', /val ratioMin: Float = 1\.5f/],
    ['sustainMs', /val sustainMs: Float = 40f/],
  ]) {
    assert.ok(literal.test(code), `${name} has a default on Config`);
  }
  // ...but they are only DEFAULTS on the data class, never recomputed in
  // the loop: the loop reads them off cfg.
  assert.match(code, /c\.ratioMin/);
  assert.match(code, /c\.sustainMs/);
  assert.match(code, /c\.blankingMs/);
  assert.match(code, /c\.floorAlpha/);

  // The three gates, in the order the reference applies them.
  const blanking = code.indexOf('c.blankingMs');
  const ratio = code.indexOf('c.ratioMin');
  const sustain = code.indexOf('c.sustainMs');
  assert.ok(blanking < ratio && ratio < sustain, 'blanking, then the band ratio, then sustain');

  // The measurement is the candidate, not the confirmation. Getting
  // this wrong would make every reading one sustain gate too long and
  // overshoot every correction by 40ms.
  assert.match(code, /offsets\[rep\] = candidateMs/);
  assert.ok(!/offsets\[rep\] = sinceClickMs/.test(code), 'never the confirmation time');

  // The floor learns only from quiet frames.
  assert.match(code, /if \(!loud\) \{ floorRms \+=/);

  // The measurement sees unprocessed audio: an input trim the artist
  // set for a show must not change how loud their answer appears.
  const chain = readFileSync(resolve(ROOT, 'native/modules/loud-camera/android/src/main/java/app/loudentify/loudcamera/LoudVocalChain.kt'), 'utf8');
  const chainCode = chain.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.match(chainCode, /calibrationBuffer\[i\] = pcm\.get\(i\) \/ 32768f/, 'the raw sample, not the trimmed one');
  const offer = chainCode.indexOf('cal.offer(');
  const trim = chainCode.indexOf('val trimmed = input \* c.inputGain');
  assert.ok(offer > 0 && (trim < 0 || offer < trim), 'and offered before the chain touches it');

  // A run that cannot start resolves rather than throws, and is never
  // mistaken for a measurement of zero.
  //
  // Read as CODE, with comments stripped. The previous version of this
  // assertion looked for the words "the audio chain is not running yet"
  // anywhere in the file; when that refusal was replaced on 8 November
  // the words survived in the comment explaining why, and the test went
  // on passing about behaviour that no longer existed. That is the
  // fourth time a test here has asserted against prose.
  const mod = readFileSync(resolve(ROOT, 'native/modules/loud-camera/android/src/main/java/app/loudentify/loudcamera/LoudCameraModule.kt'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.match(mod, /startSyncCalibration/);
  assert.match(mod, /syncConfig\(config\)/, 'the config is mapped, not invented');

  // The check no longer needs a broadcast. It listens on whichever path
  // holds the microphone: the chain while a show is up, and the
  // standalone capture otherwise — which is where an artist actually
  // runs it, in Settings and in Kit Check.
  const broadcast = mod.indexOf('MicOwner.broadcastHasMic()');
  const chainSink = mod.indexOf('chain.setCalibration(cal)');
  const meterSink = mod.indexOf('meter.setCalibration(cal)');
  assert.ok(broadcast > 0 && chainSink > broadcast, 'a running show feeds the detector from the real path');
  assert.ok(meterSink > broadcast, 'and otherwise the standalone capture does');
  // Only ever one of them, so two sources cannot both be offering frames.
  assert.match(mod, /inputMeter\?\.setCalibration\(null\)/);
  assert.match(mod, /vocalChain\?\.setCalibration\(null\)/);
  // And a microphone it cannot open is still reported rather than thrown.
  assert.match(mod, /started\["ok"\] != true/);
});

test('the orchestration asks the shared module for the verdict', () => {
  const js = readFileSync(resolve(ROOT, 'native/src/syncCalibration.js'), 'utf8');
  assert.match(js, /nativeSyncConfig\(sampleRate, bandpassCoefficients\)/, 'coefficients come from dsp.js');
  assert.match(js, /summariseCalibration\(/, 'and the verdict from sync.js');
  // A stalled run is reported as cancelled rather than measured: the
  // offsets collected so far are not a measurement, and applying them
  // would correct from a run that did not finish.
  assert.match(js, /cancelled: true/);
  assert.ok(!/MAD_REJECT|ratioMin\s*[:=]\s*\d/.test(js), 'and it holds no thresholds of its own');
});
