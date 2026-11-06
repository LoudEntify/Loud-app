import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PRESET, CONTROLS, CONTROL_KEYS, SWITCHES, REVERB,
  dbToGain, gainToDb, clampControl, normaliseChain, isPreset,
  bypassGains, reverbGains, chainSettings,
} from '../lib/audio/chain.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// The chain was already defined twice on one platform: as defaults in
// createPilotAudioTrack's signature and again as a PRESET in
// AudioDeckPanel, whose own comment admits it mirrors them. A native
// chain on the phone would have made three, and three copies of a
// compressor threshold is how an artist sounds different on their phone
// than on their laptop with nobody able to say why.

test('the preset is the values the pilot actually ran', () => {
  // Not guesses, and not to be "improved" without a show to test
  // against. Pinned here so a later edit is a deliberate one.
  assert.deepEqual({ ...PRESET }, {
    inputDb: 0, highpass: 80, threshold: -24, ratio: 3,
    gainDb: 4, reverbMix: 0.12, outputDb: 0,
  });
  assert.deepEqual({ ...REVERB }, { durationSeconds: 1.4, decay: 2.8 });
});

test('dB and linear gain convert the way every gain node expects', () => {
  assert.equal(dbToGain(0), 1);
  assert.ok(Math.abs(dbToGain(6) - 1.9953) < 0.001, '+6dB is about double');
  assert.ok(Math.abs(dbToGain(-6) - 0.5012) < 0.001, 'and -6dB about half');
  assert.ok(Math.abs(gainToDb(dbToGain(4)) - 4) < 1e-9, 'and the trip round is lossless');
  assert.equal(gainToDb(0), -Infinity, 'silence is not a number of dB');
  assert.equal(dbToGain('nonsense'), 1, 'and junk is unity, never zero: a silent show is worse than a loud one');
});

test('a knob cannot be set past what a platform can hold', () => {
  assert.equal(clampControl('ratio', 99), 12);
  assert.equal(clampControl('ratio', 0), 1);
  assert.equal(clampControl('reverbMix', 5), 0.5, 'space is subtle by design: "less dry phone mic", not a hall');
  assert.equal(clampControl('threshold', -999), -60);
  assert.equal(clampControl('highpass', NaN), PRESET.highpass, 'and an unreadable value falls back to the preset');
});

test('settings from any build normalise to one valid state', () => {
  // A stored object from an older build must not put a phone and a
  // browser into different states.
  const s = normaliseChain({ ratio: 50, unknownKnob: 7 });
  assert.equal(s.ratio, 12);
  assert.equal(s.highpass, PRESET.highpass, 'a missing key takes the preset');
  assert.equal(s.unknownKnob, undefined, 'and an unknown one is dropped');
  for (const k of CONTROL_KEYS) assert.ok(k in s);

  assert.equal(normaliseChain(null).inputDb, PRESET.inputDb);
  assert.equal(isPreset({}), true);
  assert.equal(isPreset({ ratio: 4 }), false, 'the deck can tell preset from manual');
});

test('the two safety switches are off, and stay off by default', () => {
  // effectsOn false is the pilot's own default: a safety valve because
  // the preset could not be tuned before the pilot. monitorOn false
  // every session, never persisted on — an artist who left monitoring
  // on should not discover it mid-song.
  assert.deepEqual({ ...SWITCHES }, { effectsOn: false, monitorOn: false });
  assert.equal(normaliseChain({}).effectsOn, false);
  assert.equal(normaliseChain({}).monitorOn, false);
  assert.equal(normaliseChain({ effectsOn: 'yes' }).effectsOn, false, 'and only a real boolean turns one on');
});

test('bypass is a crossfade: both paths carry a number and one is zero', () => {
  // Disconnecting a live audio node clicks. Both paths stay connected
  // and the toggle moves gain between them, so a platform applies both.
  assert.deepEqual(bypassGains(true), { processedGain: 1, bypassGain: 0 });
  assert.deepEqual(bypassGains(false), { processedGain: 0, bypassGain: 1 });
  for (const on of [true, false]) {
    const g = bypassGains(on);
    assert.equal(g.processedGain + g.bypassGain, 1, 'the pair always sums to unity: no level jump on the toggle');
  }
});

test('reverb is a parallel split, so the dry signal is never reduced away', () => {
  const g = reverbGains(0.12);
  assert.ok(Math.abs(g.dryGain - 0.88) < 1e-9);
  assert.ok(Math.abs(g.wetGain - 0.12) < 1e-9);
  assert.ok(Math.abs(g.dryGain + g.wetGain - 1) < 1e-9);
});

test('a platform is handed numbers in the units its nodes take, and computes none of them', () => {
  const s = chainSettings({ gainDb: 6, reverbMix: 0.2, effectsOn: true, monitorOn: true });
  assert.ok(Math.abs(s.makeupGain - 1.9953) < 0.001, 'dB already converted');
  assert.equal(s.highpassHz, PRESET.highpass);
  assert.deepEqual(s.compressor, { threshold: -24, ratio: 3 });
  assert.equal(s.processedGain, 1);
  assert.equal(s.bypassGain, 0);
  assert.ok(Math.abs(s.wetGain - 0.2) < 1e-9);
  assert.equal(s.monitorGain, 1);
  assert.equal(s.raw.gainDb, 6, 'with the human-facing values kept for the knobs');
});

test('every control has a label, a range and a unit a person can read', () => {
  for (const c of CONTROLS) {
    assert.ok(c.label && c.label.length < 12, `${c.key} has a short label`);
    assert.ok(c.min < c.max, `${c.key} has a real range`);
    assert.ok(c.step > 0);
    assert.ok(PRESET[c.key] >= c.min && PRESET[c.key] <= c.max, `${c.key}'s preset is inside its own range`);
  }
  assert.equal(CONTROLS.length, Object.keys(PRESET).length, 'and every preset value is a control');
});

test('the web holds no second copy of the numbers', () => {
  // The whole point: one definition, two implementations. A platform
  // that writes a threshold of its own is a platform that can drift.
  const deck = readFileSync(resolve(ROOT, 'components/AudioDeckPanel.jsx'), 'utf8');
  assert.match(deck, /from '\.\.\/lib\/audio\/chain'/, 'the deck reads the shared preset');
  assert.ok(!/const PRESET = \{/.test(deck), 'and does not write one of its own');

  const chain = readFileSync(resolve(ROOT, 'lib/audioProcessing.js'), 'utf8');
  assert.match(chain, /highpassFrequency = PRESET\.highpass/, 'and nor does the graph builder');
  assert.ok(!/compressorThreshold = -24/.test(chain), 'the old literal is gone');
  assert.ok(!/reverbDuration = 1\.4/.test(chain));

  // And the shared module stays loadable everywhere: Next, Metro, and a
  // plain Node test. One platform import and it stops being shared.
  const shared = readFileSync(resolve(ROOT, 'lib/audio/chain.js'), 'utf8');
  assert.ok(!/^import /m.test(shared), 'it imports nothing at all');
  // Checked against the code, not the prose: the header explains what
  // this file is not, and naming AudioContext in a comment is the
  // explanation, not a dependency.
  const code = shared.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  for (const forbidden of ['AudioContext', 'require(', 'window.', 'document.', 'navigator.']) {
    assert.ok(!code.includes(forbidden), `and reaches for no platform: ${forbidden}`);
  }
});
