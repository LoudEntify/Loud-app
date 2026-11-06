// lib/audio/dsp.js
// ─────────────────────────────────────────────────────────────
// The chain's arithmetic: filter coefficients, compressor constants and
// reverb delay lengths, computed from the shared parameters in
// lib/audio/chain.js.
//
// ── WHY THE MATHS LIVES IN JAVASCRIPT ─────────────────────────
// Because this is the part that can be proved. A compressor either
// sounds right or it does not, and only ears settle that; but a
// high-pass filter either attenuates below its cutoff or it does not,
// and that is arithmetic. Run here, it can be tested by pushing a sine
// wave through the difference equation and measuring what comes out —
// which tests/audio-dsp.test.mjs does.
//
// So the phone's native chain does NOT compute coefficients. It is
// handed them and runs the per-sample loop, which is the part that
// needs to be in Kotlin for speed and the part that is a transcription
// rather than a decision. A bug in the loop is a bug in twenty lines of
// arithmetic with a reference implementation beside it. A bug in the
// coefficients would be a bug nobody could see.
//
// The web does not use this: it hands the same parameters to Web Audio,
// whose nodes compute their own coefficients. Both sides therefore
// derive from lib/audio/chain.js and neither invents a number.
//
// Imports nothing, names no platform. Same rule as chain.js.
// ─────────────────────────────────────────────────────────────

import { chainSettings } from './chain.js';

/** WebKit's default, and Web Audio's own BiquadFilterNode default. Matching it keeps the two filters the same shape. */
export const DEFAULT_Q = Math.SQRT1_2; // 0.7071, Butterworth

/**
 * A second-order high-pass, from the Audio EQ Cookbook (Robert
 * Bristow-Johnson), which is what Web Audio's BiquadFilterNode
 * implements. Returned normalised by a0, so the difference equation is:
 *
 *   y[n] = b0*x[n] + b1*x[n-1] + b2*x[n-2] - a1*y[n-1] - a2*y[n-2]
 *
 * That one line is what Kotlin runs per sample. Nothing else.
 */
export function highpassCoefficients(frequencyHz, sampleRate, q = DEFAULT_Q) {
  const f = Math.min(Math.max(Number(frequencyHz) || 0, 1), sampleRate / 2 - 1);
  const w0 = (2 * Math.PI * f) / sampleRate;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);

  const b0 = (1 + cos) / 2;
  const b1 = -(1 + cos);
  const b2 = (1 + cos) / 2;
  const a0 = 1 + alpha;
  const a1 = -2 * cos;
  const a2 = 1 - alpha;

  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

/**
 * One sample through a biquad, given its two-sample history. Exported
 * so a test can run a real signal through it, and so the Kotlin loop
 * has a reference that can be read side by side with it.
 */
export function biquadStep(c, x, state) {
  const y = c.b0 * x + c.b1 * state.x1 + c.b2 * state.x2 - c.a1 * state.y1 - c.a2 * state.y2;
  state.x2 = state.x1; state.x1 = x;
  state.y2 = state.y1; state.y1 = y;
  return y;
}

export const newBiquadState = () => ({ x1: 0, x2: 0, y1: 0, y2: 0 });

/**
 * Attack and release as the pilot's compressor has them.
 *
 * Web Audio's DynamicsCompressorNode defaults to 3ms attack and 250ms
 * release, and the pilot never overrode them, so these are the values
 * that have actually been performed through.
 */
export const COMPRESSOR_TIMING = Object.freeze({ attackMs: 3, releaseMs: 250, kneeDb: 30 });

/**
 * A one-pole smoothing coefficient for a time constant, which is what
 * an envelope follower's attack and release are.
 *
 *   coef = exp(-1 / (timeSeconds * sampleRate))
 *
 * At coef 0 the envelope jumps instantly; near 1 it barely moves.
 */
export function timeConstant(ms, sampleRate) {
  const seconds = Math.max(Number(ms) || 0, 0) / 1000;
  if (seconds <= 0) return 0;
  return Math.exp(-1 / (seconds * sampleRate));
}

/**
 * What the compressor needs, in the form the loop uses.
 *
 * `slope` is (1 - 1/ratio): the fraction of every dB above the
 * threshold that gets removed. A ratio of 1 gives slope 0, which is no
 * compression, which is why a ratio below 1 is clamped away in
 * chain.js rather than inverted here.
 */
export function compressorCoefficients({ threshold, ratio }, sampleRate, timing = COMPRESSOR_TIMING) {
  const r = Math.max(Number(ratio) || 1, 1);
  return {
    thresholdDb: Number(threshold),
    slope: 1 - 1 / r,
    kneeDb: timing.kneeDb,
    attack: timeConstant(timing.attackMs, sampleRate),
    release: timeConstant(timing.releaseMs, sampleRate),
  };
}

/**
 * How many dB of gain reduction a level should get, with a soft knee.
 *
 * Below the knee: nothing. Above it: the full slope. Across it: a
 * quadratic, so the compressor eases in rather than switching on, which
 * is the difference between a voice that is being controlled and one
 * that is being grabbed.
 */
export function gainReductionDb(levelDb, c) {
  const over = levelDb - c.thresholdDb;
  const half = c.kneeDb / 2;
  if (over <= -half) return 0;
  if (over >= half) return c.slope * over;
  const x = over + half;
  return (c.slope * x * x) / (2 * c.kneeDb);
}

/**
 * A Schroeder reverb's delay lengths, in samples, scaled to the rate.
 *
 * NOT a convolution. The web generates a 1.4-second impulse response
 * and convolves it, which is thousands of multiply-accumulates per
 * sample: fine in a browser on a laptop, far too expensive inside a
 * 10ms callback on a phone that is also encoding video. Four combs and
 * two all-passes cost about six multiply-accumulates per sample and
 * give the same kind of result: "less dry phone mic", which is all the
 * preset's 0.12 mix is reaching for.
 *
 * The ratios are Schroeder's own, in prime-ish proportion so the combs
 * do not line up and ring.
 */
export const COMB_MS = Object.freeze([29.7, 37.1, 41.1, 43.7]);
export const ALLPASS_MS = Object.freeze([5.0, 1.7]);

export function reverbDelays(sampleRate, { durationSeconds, decay } = { durationSeconds: 1.4, decay: 2.8 }) {
  const samples = (ms) => Math.max(1, Math.round((ms / 1000) * sampleRate));
  // Comb feedback from the wanted decay time: the standard RT60
  // relation, g = 10^(-3 * delaySeconds / rt60).
  const rt60 = Math.max(0.1, Number(durationSeconds) || 1.4);
  const feedback = COMB_MS.map((ms) => {
    const g = 10 ** ((-3 * (ms / 1000)) / rt60);
    return Math.min(0.98, Math.max(0, g));
  });
  return {
    combs: COMB_MS.map((ms, i) => ({ delay: samples(ms), feedback: feedback[i] })),
    allpasses: ALLPASS_MS.map((ms) => ({ delay: samples(ms), feedback: 0.5 })),
    // Kept so a later change to the web's impulse can be mirrored here.
    decay: Number(decay) || 2.8,
  };
}

/**
 * Everything the native chain needs for one sample rate, from the same
 * settings object the web uses. This is what crosses into Kotlin.
 */
export function nativeChainConfig(settings, sampleRate) {
  const s = chainSettings(settings);
  return {
    sampleRate,
    inputGain: s.inputGain,
    highpass: highpassCoefficients(s.highpassHz, sampleRate),
    compressor: compressorCoefficients(s.compressor, sampleRate),
    makeupGain: s.makeupGain,
    dryGain: s.dryGain,
    wetGain: s.wetGain,
    reverb: reverbDelays(sampleRate, s.reverb),
    processedGain: s.processedGain,
    bypassGain: s.bypassGain,
    outputGain: s.outputGain,
  };
}
