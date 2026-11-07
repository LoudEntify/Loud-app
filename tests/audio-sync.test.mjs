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
