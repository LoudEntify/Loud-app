// lib/audio/chain.js
// ─────────────────────────────────────────────────────────────
// THE vocal chain, as data. One definition, two implementations.
//
// ── WHY THIS FILE EXISTS ──────────────────────────────────────
// The chain was invented twice over: its parameters live as defaults in
// `createPilotAudioTrack`'s signature (lib/audioProcessing.js) and again
// as a PRESET object in components/AudioDeckPanel.jsx, whose own comment
// admits it "just mirrors them so the knobs display correctly". Two
// copies of the same seven numbers, already, on one platform.
//
// Korey's ruling of 6 Nov is a vocal chain on the phone written natively
// as well, which would have made three. Three copies of a compressor
// threshold is how an artist ends up sounding different on their phone
// than on their laptop and nobody can say why.
//
// So: the numbers, the ranges and the graph live here, and nothing else
// defines them. The web builds a Web Audio graph from this. The phone
// configures its native DSP from this. Neither holds a number of its
// own.
//
// ── WHAT THIS FILE IS NOT ─────────────────────────────────────
// It is not an implementation and imports nothing. No AudioContext, no
// native module, no React. It has to be loadable by the Next.js app, by
// Metro, and by a plain Node test, which is the same reasoning as
// lib/showWindow.js and lib/rig.js.
//
// ── THE GRAPH ─────────────────────────────────────────────────
// Taken from the running pilot chain, which is the specification:
//
//   mic ──▶ inputGain ──┬──────────────────── bypassGain ──┐
//                       │                                   │
//                       └─▶ highpass ─▶ compressor ─▶ makeup│
//                                                     │     │
//                                        ┌────────────┴───┐ │
//                                      dry              reverb
//                                        └────────┬───────┘ │
//                                            processedGain  │
//                                                 └─────┬───┘
//                                                       ▼
//                                                   vocalBus ──▶ outputBus ──▶ PUBLISHED
//                                                       │            ▲
//                                                       │       backingTrack
//                                                       ▼
//                                                  monitorGain ──▶ the artist's own ears only
//
// Two rules the graph exists to keep, and which both platforms must
// honour because breaking either is audible on a live show:
//
//   1. BYPASS IS A CROSSFADE, NOT A DISCONNECT. Both paths stay
//      connected and the toggle moves gain between them. Disconnecting
//      a live audio node clicks.
//   2. THE MONITOR IS NEVER PUBLISHED. It taps vocalBus and reaches the
//      artist's own ears. It cannot reach the broadcast whatever its
//      gain, because an artist monitoring themselves into the stream is
//      a feedback loop in front of an audience.
// ─────────────────────────────────────────────────────────────

/** dB to a linear gain multiplier, which is what every gain node wants. */
export function dbToGain(db) {
  const n = Number(db);
  return Number.isFinite(n) ? 10 ** (n / 20) : 1;
}

/** And back, for a meter that wants to show the number a person set. */
export function gainToDb(gain) {
  const n = Number(gain);
  return Number.isFinite(n) && n > 0 ? 20 * Math.log10(n) : -Infinity;
}

/**
 * The tested-good starting point every performer goes live with.
 *
 * These are the values the pilot ran. They are not guesses and they are
 * not to be "improved" without a show to test against.
 */
export const PRESET = Object.freeze({
  inputDb: 0,        // input trim. Everything before this is raw hardware level.
  highpass: 80,      // Hz. Removes handling rumble without thinning a voice.
  threshold: -24,    // dB. Where the compressor starts working.
  ratio: 3,          // gentle. Balances a voice against an instrument.
  gainDb: 4,         // makeup, because compression costs level.
  reverbMix: 0.12,   // 0 dry, 1 wet. Subtle: "less dry phone mic", not a hall.
  outputDb: 0,
});

/**
 * What each control may be set to, so a slider on a phone and a slider
 * in a browser cannot offer different ranges for the same knob.
 *
 * `step` is the increment a control moves in; `unit` is what to print.
 */
export const CONTROLS = Object.freeze([
  { key: 'inputDb', label: 'Input', min: -12, max: 12, step: 0.5, unit: 'dB', of: 'gain' },
  { key: 'highpass', label: 'Low cut', min: 40, max: 200, step: 5, unit: 'Hz', of: 'filter' },
  { key: 'threshold', label: 'Threshold', min: -60, max: 0, step: 1, unit: 'dB', of: 'compressor' },
  { key: 'ratio', label: 'Ratio', min: 1, max: 12, step: 0.5, unit: ':1', of: 'compressor' },
  { key: 'gainDb', label: 'Make-up', min: 0, max: 18, step: 0.5, unit: 'dB', of: 'gain' },
  { key: 'reverbMix', label: 'Space', min: 0, max: 0.5, step: 0.01, unit: '', of: 'reverb' },
  { key: 'outputDb', label: 'Output', min: -12, max: 12, step: 0.5, unit: 'dB', of: 'gain' },
]);

export const CONTROL_KEYS = CONTROLS.map((c) => c.key);
export const controlFor = (key) => CONTROLS.find((c) => c.key === key) || null;

/** The reverb's impulse, generated rather than shipped as a file. */
export const REVERB = Object.freeze({ durationSeconds: 1.4, decay: 2.8 });

/**
 * Defaults that are NOT knobs, because each is a safety position rather
 * than a taste.
 *
 * `effectsOn: false` is the pilot's own default and the comment in
 * audioProcessing.js explains it: a safety valve because the preset
 * could not be tuned before the pilot, not a verdict that processing is
 * wrong. It stays false until a show says otherwise.
 *
 * `monitorOn: false` every session, never persisted on. An artist who
 * left monitoring on from last time and plugs in a wired headset at a
 * venue should not discover it mid-song.
 */
export const SWITCHES = Object.freeze({ effectsOn: false, monitorOn: false });

/** Clamp one control to its own range, so no caller can set a value a platform cannot hold. */
export function clampControl(key, value) {
  const c = controlFor(key);
  if (!c) return value;
  const n = Number(value);
  if (!Number.isFinite(n)) return PRESET[key];
  return Math.min(c.max, Math.max(c.min, n));
}

/**
 * A full, valid settings object from whatever a caller has: missing
 * keys take the preset, out-of-range values are clamped, unknown keys
 * are dropped.
 *
 * Every platform runs its settings through this before applying them,
 * so a stored object from an older build cannot put a phone and a
 * browser into different states.
 */
export function normaliseChain(input) {
  const src = input && typeof input === 'object' ? input : {};
  const out = {};
  for (const key of CONTROL_KEYS) {
    out[key] = clampControl(key, src[key] === undefined ? PRESET[key] : src[key]);
  }
  out.effectsOn = typeof src.effectsOn === 'boolean' ? src.effectsOn : SWITCHES.effectsOn;
  out.monitorOn = typeof src.monitorOn === 'boolean' ? src.monitorOn : SWITCHES.monitorOn;
  return out;
}

/** Is this settings object the untouched preset? The deck shows "preset" rather than "manual". */
export function isPreset(settings) {
  const s = normaliseChain(settings);
  return CONTROL_KEYS.every((k) => s[k] === PRESET[k]);
}

/**
 * The gain pair the bypass toggle crossfades between.
 *
 * Returned as a pair rather than set directly, because rule 1 above is
 * that both paths stay connected: a platform applies BOTH numbers, and
 * one of them is always zero.
 */
export function bypassGains(effectsOn) {
  return effectsOn ? { processedGain: 1, bypassGain: 0 } : { processedGain: 0, bypassGain: 1 };
}

/** The dry/wet pair for the reverb's parallel split. */
export function reverbGains(reverbMix) {
  const mix = clampControl('reverbMix', reverbMix);
  return { dryGain: 1 - mix, wetGain: mix };
}

/**
 * Everything a platform needs to configure its chain, in the units the
 * nodes actually take: dB already converted to linear gain, the
 * crossfade pair resolved, the reverb split resolved.
 *
 * The web applies these to AudioParams. The phone passes them to the
 * native DSP. Neither computes any of it.
 */
export function chainSettings(input) {
  const s = normaliseChain(input);
  return {
    inputGain: dbToGain(s.inputDb),
    highpassHz: s.highpass,
    compressor: { threshold: s.threshold, ratio: s.ratio },
    makeupGain: dbToGain(s.gainDb),
    ...reverbGains(s.reverbMix),
    reverb: REVERB,
    ...bypassGains(s.effectsOn),
    outputGain: dbToGain(s.outputDb),
    // Never published, whatever this says. Rule 2.
    monitorGain: s.monitorOn ? 1 : 0,
    raw: s,
  };
}
