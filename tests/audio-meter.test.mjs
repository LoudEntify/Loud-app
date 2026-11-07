// tests/audio-meter.test.mjs
// ─────────────────────────────────────────────────────────────
// "There is no audio signal indicator." — Korey, 5 Nov.
//
// There is now, on both platforms, and these tests pin the part that
// must not differ between them: what a given level MEANS. A meter
// reading "good" on a laptop and "quiet" on a phone for the same voice
// is worse than no meter, because the artist would trust whichever they
// saw last.
// ─────────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  levelDb, meterFraction, describeLevel, describeReduction,
  LEVEL_BANDS, FLOOR_DB, CEILING_DB, REDUCTION_CEILING_DB, METER_POLL_MS,
} from '../lib/audio/meter.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('amplitude becomes dB the way the arithmetic says, and silence does not become a number', () => {
  assert.equal(levelDb(1), 0);
  // Half the amplitude is 6 dB down, which is the whole reason the meter
  // is logarithmic: on a raw 0..1 bar this would look like half volume.
  assert.ok(Math.abs(levelDb(0.5) + 6.02) < 0.01);
  assert.ok(Math.abs(levelDb(0.25) + 12.04) < 0.01);
  assert.equal(levelDb(0), -Infinity);
  assert.equal(levelDb(-0.5), levelDb(0.5), 'a negative sample is the same loudness');
  assert.equal(levelDb('nonsense'), -Infinity);
  assert.equal(levelDb(5), 0, 'nothing reads above full scale');
});

test('the bar covers floor to ceiling and clamps outside it', () => {
  assert.equal(meterFraction(CEILING_DB), 1);
  assert.equal(meterFraction(FLOOR_DB), 0);
  assert.equal(meterFraction(FLOOR_DB - 40), 0);
  assert.equal(meterFraction(CEILING_DB + 10), 1);
  assert.equal(meterFraction(-Infinity), 0, 'silence is the bottom of the bar, not a crash');
  const mid = meterFraction((FLOOR_DB + CEILING_DB) / 2);
  assert.ok(Math.abs(mid - 0.5) < 1e-9);
});

test('the verdict is judged on the peak, because an artist clips on their loudest word', () => {
  // An average that looks healthy with a peak at full scale is exactly
  // the case a meter has to catch.
  const hidden = describeLevel({ peak: 1, rms: 0.08 });
  assert.equal(hidden.band, 'clipping');
  assert.equal(hidden.ok, false);
  assert.ok(hidden.action, 'a problem band must carry the action that fixes it');

  const good = describeLevel({ peak: 0.25, rms: 0.08 });   // -12 dB peak
  assert.equal(good.band, 'good');
  assert.equal(good.ok, true);
  assert.equal(good.action, null, 'when the answer is yes there is nothing to do');

  assert.equal(describeLevel({ peak: 0.6, rms: 0.3 }).band, 'hot');
  assert.equal(describeLevel({ peak: 0.03, rms: 0.02 }).band, 'quiet');   // -30 dB peak
  assert.equal(describeLevel({ peak: 0.003, rms: 0.002 }).band, 'silent'); // -50 dB: room noise, not a person
  assert.equal(describeLevel({ peak: 0, rms: 0 }).band, 'silent');
  assert.equal(describeLevel().band, 'silent', 'no reading at all is silence, not an error');
});

test('every band is reachable, ordered, and says something', () => {
  // Loudest first, so the first match wins; an out-of-order band would
  // silently shadow the ones below it.
  for (let i = 1; i < LEVEL_BANDS.length; i += 1) {
    assert.ok(LEVEL_BANDS[i].from < LEVEL_BANDS[i - 1].from, `${LEVEL_BANDS[i].key} is out of order`);
  }
  assert.equal(LEVEL_BANDS[LEVEL_BANDS.length - 1].from, -Infinity, 'the last band must catch everything');
  for (const b of LEVEL_BANDS) {
    assert.ok(b.line && b.line.length > 0, `${b.key} has no line`);
    assert.equal(b.key === 'good', b.action === null, `${b.key}: only "good" has no action`);
  }
  // And each band is actually produced by some reading.
  const seen = new Set([1, 0.6, 0.25, 0.03, 0].map((p) => describeLevel({ peak: p }).band));
  for (const b of LEVEL_BANDS) assert.ok(seen.has(b.key), `${b.key} is unreachable`);
});

test('the bar follows the average and the notch marks the peak', () => {
  const m = describeLevel({ peak: 0.5, rms: 0.1 });
  assert.ok(m.peakFraction > m.fraction, 'the peak sits above the bar');
  assert.ok(Math.abs(m.peakDb + 6.02) < 0.01);
  assert.ok(Math.abs(m.rmsDb + 20) < 0.01);
});

test('compression is shown by what it is doing, not by its settings', () => {
  const idle = describeReduction(0);
  assert.equal(idle.working, false);
  assert.equal(idle.fraction, 0);
  assert.match(idle.line, /Not compressing/);

  const working = describeReduction(3);
  assert.equal(working.working, true);
  assert.ok(Math.abs(working.fraction - 3 / REDUCTION_CEILING_DB) < 1e-9);
  assert.match(working.line, /3\.0 dB/);

  // Past the ceiling the bar stops but the number keeps telling the truth.
  const heavy = describeReduction(30);
  assert.equal(heavy.fraction, 1);
  assert.match(heavy.line, /more than a voice usually needs/);

  assert.equal(describeReduction(-5).db, 0, 'negative reduction is not a thing');
  assert.equal(describeReduction(undefined).db, 0);
});

test('the poll rate is slower than the audio and that costs nothing', () => {
  // The native loop runs at 100 frames a second and HOLDS its peak until
  // read, so a slower poll reports the loudest frame since last time
  // rather than whichever one it landed on.
  assert.ok(METER_POLL_MS >= 50 && METER_POLL_MS <= 200);

  const kt = readFileSync(resolve(ROOT, 'native/modules/loud-camera/android/src/main/java/app/loudentify/loudcamera/LoudVocalChain.kt'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

  // The peak is held and cleared by the read, which is what makes the
  // slow poll lossless.
  assert.match(kt, /fun meter\(\)/);
  assert.match(kt, /levelPeak = 0f/);
  assert.match(kt, /if \(framePeak > levelPeak\)/);

  // And the loop runs on `configured`, never on the effects switch, so
  // the meter works with effects off. An `enabled` field here would mean
  // a level the artist can only see after switching processing on.
  assert.match(kt, /if \(!configured \|\| numBands != 1\) return/);
  assert.ok(!/private var enabled\b/.test(kt), 'the effects switch is the crossfade, not a flag');
});

test('lib/audio/meter.js names no platform', () => {
  const src = readFileSync(resolve(ROOT, 'lib/audio/meter.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  for (const word of ['AudioContext', 'react', 'expo-', 'livekit', 'window.', 'document.', 'require(']) {
    assert.ok(!src.toLowerCase().includes(word.toLowerCase()), `lib/audio/meter.js names ${word}`);
  }
  assert.ok(!/from\s+'/.test(src), 'it imports nothing');
});
