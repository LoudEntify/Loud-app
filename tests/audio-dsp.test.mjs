import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  highpassCoefficients, biquadStep, newBiquadState, DEFAULT_Q,
  timeConstant, compressorCoefficients, gainReductionDb, COMPRESSOR_TIMING,
  reverbDelays, nativeChainConfig,
} from '../lib/audio/dsp.js';
import { PRESET } from '../lib/audio/chain.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Source with its comments removed.
 *
 * A file's header explains what it does NOT do, so searching the raw
 * text for a forbidden word finds the explanation and calls it the
 * offence. Twice now. The check belongs on the code.
 */
const codeOf = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
const RATE = 48000;

/** Push a sine through a filter and return its output amplitude, after the transient. */
function responseAt(hz, coefficients, rate = RATE) {
  const state = newBiquadState();
  const cycles = 60;
  const n = Math.round((rate / hz) * cycles);
  let peak = 0;
  for (let i = 0; i < n; i++) {
    const y = biquadStep(coefficients, Math.sin((2 * Math.PI * hz * i) / rate), state);
    // Ignore the first half: a filter settles.
    if (i > n / 2) peak = Math.max(peak, Math.abs(y));
  }
  return peak;
}

// The maths lives in JavaScript because this is the part that can be
// proved. A compressor either sounds right or it does not, and only
// ears settle that. A high-pass either attenuates below its cutoff or
// it does not, and that is arithmetic.

test('the high-pass actually passes high and stops low', () => {
  const c = highpassCoefficients(PRESET.highpass, RATE);
  assert.ok(responseAt(1000, c) > 0.99, 'a voice at 1kHz comes through untouched');
  assert.ok(responseAt(2000, c) > 0.99);
  // 80Hz is the corner, so about -3dB (0.707) by definition.
  const atCorner = responseAt(PRESET.highpass, c);
  assert.ok(atCorner > 0.6 && atCorner < 0.8, `the corner is about -3dB, got ${atCorner.toFixed(3)}`);
  // Two octaves below the corner, a second-order filter is about -24dB.
  assert.ok(responseAt(20, c) < 0.1, 'and handling rumble at 20Hz is gone');
});

test('the filter is the same shape as the browser it has to match', () => {
  // Web Audio's BiquadFilterNode defaults to Q = 1/sqrt(2). A phone
  // filtering more steeply than a laptop is the drift this whole
  // exercise exists to prevent.
  assert.ok(Math.abs(DEFAULT_Q - Math.SQRT1_2) < 1e-12);
  const c = highpassCoefficients(80, 48000);
  // Coefficients are normalised by a0, so b0 is a plain number near 1.
  assert.ok(c.b0 > 0.98 && c.b0 < 1, 'normalised by a0');
  assert.ok(Math.abs(c.b1 + 2 * c.b0) < 1e-9, 'and b1 = -2*b0 for a high-pass');
  assert.ok(Math.abs(c.b2 - c.b0) < 1e-12, 'with b2 = b0');
});

test('a filter asked for something impossible still returns a usable filter', () => {
  // Above Nyquist is not a filter, and a chain that returns NaN
  // coefficients turns a show into silence.
  for (const hz of [0, -100, RATE, RATE * 2, NaN]) {
    const c = highpassCoefficients(hz, RATE);
    for (const k of ['b0', 'b1', 'b2', 'a1', 'a2']) {
      assert.ok(Number.isFinite(c[k]), `${hz}Hz gives a finite ${k}`);
    }
  }
});

test('attack and release are time constants a loop can use', () => {
  assert.equal(timeConstant(0, RATE), 0, 'no time means jump instantly');
  const fast = timeConstant(3, RATE);
  const slow = timeConstant(250, RATE);
  assert.ok(fast > 0 && fast < 1);
  assert.ok(slow > fast, 'a slower release moves less per sample');
  assert.ok(slow > 0.99, 'and 250ms at 48kHz barely moves at all per sample');
});

test('the compressor removes the right share of what is over the threshold', () => {
  const c = compressorCoefficients({ threshold: PRESET.threshold, ratio: PRESET.ratio }, RATE);
  assert.ok(Math.abs(c.slope - (1 - 1 / 3)) < 1e-12, '3:1 removes two thirds of the excess');

  // Well below: untouched. Well above: the full slope.
  assert.equal(gainReductionDb(-60, c), 0, 'quiet passes');
  const loud = gainReductionDb(0, c);           // 24dB over the -24 threshold
  assert.ok(Math.abs(loud - c.slope * 24) < 1e-9, '24dB over gives 16dB of reduction at 3:1');

  // The knee eases in rather than switching on.
  // A soft knee is centred ON the threshold, so it is already working
  // there, and working less than a hard knee would be. With a 30dB knee
  // at 3:1 that is 2.5dB, which is a quarter of what the slope alone
  // would give at the top of the knee.
  const atThreshold = gainReductionDb(PRESET.threshold, c);
  const atKneeTop = gainReductionDb(PRESET.threshold + c.kneeDb / 2, c);
  assert.ok(atThreshold > 0, 'the knee is already easing in at the threshold');
  assert.ok(atThreshold < atKneeTop, 'and doing less there than at the top of the knee');
  assert.ok(gainReductionDb(PRESET.threshold - c.kneeDb / 2, c) === 0, 'while below the knee nothing happens at all');
  let last = -1;
  for (let db = -60; db <= 0; db += 0.5) {
    const g = gainReductionDb(db, c);
    assert.ok(g >= last - 1e-9, 'and reduction never decreases as the signal gets louder');
    last = g;
  }
});

test('a ratio of 1 is no compression, not a division trap', () => {
  const c = compressorCoefficients({ threshold: -24, ratio: 1 }, RATE);
  assert.equal(c.slope, 0);
  assert.equal(gainReductionDb(0, c), 0, 'nothing is removed at 1:1');
});

test('the reverb is cheap enough to run inside a 10ms callback', () => {
  const r = reverbDelays(RATE, { durationSeconds: 1.4, decay: 2.8 });
  assert.equal(r.combs.length, 4);
  assert.equal(r.allpasses.length, 2);
  // Four combs and two all-passes is about six multiply-accumulates per
  // sample. A 1.4s convolution, which is what the web does, is tens of
  // thousands, and the phone is encoding video at the same time.
  for (const c of r.combs) {
    assert.ok(c.delay > 0 && Number.isInteger(c.delay), 'delays are whole samples');
    assert.ok(c.feedback > 0 && c.feedback < 1, 'and feedback below 1, or it never decays');
  }
  // Longer delays decay more per pass, so they carry less feedback.
  const fb = r.combs.map((c) => c.feedback);
  for (let i = 1; i < fb.length; i++) assert.ok(fb[i] <= fb[i - 1] + 1e-9);

  // A longer tail means more feedback, which is the whole relation.
  const longer = reverbDelays(RATE, { durationSeconds: 3, decay: 2.8 });
  assert.ok(longer.combs[0].feedback > r.combs[0].feedback);
});

test('delays scale with the rate, so a phone at 16kHz sounds like one at 48', () => {
  const a = reverbDelays(48000);
  const b = reverbDelays(16000);
  for (let i = 0; i < a.combs.length; i++) {
    const ratio = a.combs[i].delay / b.combs[i].delay;
    assert.ok(Math.abs(ratio - 3) < 0.05, 'three times the rate, three times the samples');
  }
});

test('what crosses into Kotlin is complete and already in its final units', () => {
  // The native side computes nothing. A bug in the loop is a bug in
  // twenty lines with a reference beside it; a bug in the coefficients
  // would be one nobody could see.
  const cfg = nativeChainConfig({ effectsOn: true }, RATE);
  for (const k of ['sampleRate', 'inputGain', 'highpass', 'compressor', 'makeupGain', 'dryGain', 'wetGain', 'reverb', 'processedGain', 'bypassGain', 'outputGain']) {
    assert.ok(cfg[k] !== undefined, `${k} is handed over`);
  }
  assert.equal(cfg.processedGain, 1);
  assert.equal(cfg.bypassGain, 0);
  assert.ok(Math.abs(cfg.makeupGain - 10 ** (PRESET.gainDb / 20)) < 1e-12, 'dB already linear');
  assert.equal(cfg.highpass.b2, cfg.highpass.b0, 'coefficients, not a frequency');

  // And with effects off, the processed path carries nothing while both
  // paths still carry a number: the crossfade rule from chain.js.
  const off = nativeChainConfig({ effectsOn: false }, RATE);
  assert.equal(off.processedGain, 0);
  assert.equal(off.bypassGain, 1);
});

test('the Kotlin loop is a transcription, and can be read against its reference', () => {
  // The native side computes nothing. If it ever starts, the two
  // implementations can drift and only an artist's ears would notice.
  const kt = readFileSync(resolve(ROOT, 'native/modules/loud-camera/android/src/main/java/app/loudentify/loudcamera/LoudVocalChain.kt'), 'utf8');

  // The same difference equation, coefficient for coefficient.
  assert.match(kt, /c\.b0 \* trimmed \+ c\.b1 \* x1\[ch\] \+ c\.b2 \* x2\[ch\] - c\.a1 \* y1\[ch\] - c\.a2 \* y2\[ch\]/);
  // And the same soft knee.
  assert.match(kt, /\(c\.slope \* x \* x\) \/ \(2f \* c\.kneeDb\)/);

  // Rule 1 from lib/audio/chain.js: bypass is a crossfade, computed
  // every sample, never a branch that skips the chain.
  assert.match(kt, /processed \* c\.processedGain \+ trimmed \* c\.bypassGain/);
  // Rule 2: the monitor is not in this file at all. A capture
  // post-processor can only touch what is being sent.
  assert.ok(!/monitor/i.test(codeOf(kt)), 'no monitor path can exist here');

  // It implements the interface LiveKit actually calls.
  assert.match(kt, /AudioProcessorInterface/);
  assert.match(kt, /override fun processAudio/);
  // A rate change invalidates every coefficient, so the loop stops
  // rather than running yesterday's numbers. `configured` means a config
  // for THIS rate has arrived — it is not the effects switch, which is
  // the crossfade, which is why the meter can read a level with effects
  // off (lib/audio/meter.js).
  assert.match(kt, /override fun resetAudioProcessing[\s\S]{0,400}configured = false/);

  const mod = readFileSync(resolve(ROOT, 'native/modules/loud-camera/android/src/main/java/app/loudentify/loudcamera/LoudCameraModule.kt'), 'utf8');
  assert.match(mod, /capturePostProcessor = it/, 'and is installed where LiveKit calls it');
  assert.match(mod, /promise\.resolve\(mapOf\("ok" to false/, 'a chain that will not start never stops a show');

  const bridge = readFileSync(resolve(ROOT, 'native/src/vocalChain.js'), 'utf8');
  assert.match(bridge, /nativeChainConfig/, 'the phone is handed coefficients');
  assert.match(bridge, /normaliseChain/, 'from settings normalised the same way the web normalises them');
});
