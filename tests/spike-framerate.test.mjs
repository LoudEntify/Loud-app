// Frame-rate choice, the platform-free part (native/src/spike/frameRate.js):
// which of 24/25/30/60 a lens can hold, how a request resolves against the
// ranges the HAL advertises, and the warnings.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FRAME_RATE_CHOICES, cleanRanges, frameRateSupport, frameRateOptions, resolveFrameRate, frameRateWarnings } from '../native/src/spike/frameRate.js';

// Samsung-like: fixed 24, 30 and 60, plus variable ranges. Moto-like: 30 fixed, 15–30 variable. Bare: nothing reported.
const samsung = [[7, 30], [15, 30], [24, 24], [30, 30], [8, 60], [60, 60]];
const moto = [[15, 30], [30, 30]];

test('cleanRanges accepts pairs and {lower,upper} objects and drops junk', () => {
  assert.deepEqual(cleanRanges([[15, 30], { lower: 30, upper: 30 }, [0, 30], [30, 15], null, 'x']), [[15, 30], [30, 30]]);
  assert.deepEqual(cleanRanges(undefined), []);
});

test('frameRateSupport: exact when [f, f] is advertised; inside a range otherwise; refused beyond the top', () => {
  assert.deepEqual(frameRateSupport(30, samsung), { fps: 30, supported: true, exact: true, range: [30, 30], reason: null });
  assert.deepEqual(frameRateSupport(60, samsung).range, [60, 60]);
  const twentyfive = frameRateSupport(25, samsung);
  assert.equal(twentyfive.supported, true); assert.equal(twentyfive.exact, false); assert.deepEqual(twentyfive.range, [15, 30]);
  assert.match(twentyfive.reason, /only inside 15–30/);
  const sixtyOnMoto = frameRateSupport(60, moto);
  assert.equal(sixtyOnMoto.supported, false); assert.match(sixtyOnMoto.reason, /tops out at 30/);
  const twentyfourOnMoto = frameRateSupport(24, moto);
  assert.equal(twentyfourOnMoto.exact, false); assert.deepEqual(twentyfourOnMoto.range, [15, 30]);
});

test('frameRateSupport with no ranges: 30 assumed, anything else waits for the survey', () => {
  assert.equal(frameRateSupport(30, []).supported, true);
  assert.equal(frameRateSupport(60, null).supported, false);
});

test('frameRateOptions lists the four choices in order with their support', () => {
  const o = frameRateOptions(samsung);
  assert.deepEqual(o.map((x) => x.fps), FRAME_RATE_CHOICES);
  assert.deepEqual(o.map((x) => x.supported), [true, true, true, true]);
  assert.deepEqual(frameRateOptions(moto).map((x) => x.supported), [true, true, true, false]);
});

test('resolveFrameRate: a listed rate is itself; 24.5 and 28 land on the nearest rate the HAL can hold, with the reason', () => {
  assert.equal(resolveFrameRate(60, samsung).changed, false);
  const half = resolveFrameRate(24.5, samsung);
  assert.equal(half.fps, 24); assert.equal(half.changed, true); assert.match(half.reason, /whole-number/);
  const twentyEight = resolveFrameRate(28, samsung);
  assert.equal(twentyEight.fps, 30); assert.match(twentyEight.reason, /not a rate this camera advertises/);
  // 60 asked of a 30-fps camera: 30 (nearest supported), range [30, 30]
  const sixtyOnMoto = resolveFrameRate(60, moto);
  assert.equal(sixtyOnMoto.fps, 30); assert.deepEqual(sixtyOnMoto.range, [30, 30]); assert.equal(sixtyOnMoto.changed, true);
  // garbage → the default
  assert.equal(resolveFrameRate('x', samsung).fps, 30);
  assert.equal(resolveFrameRate(0, samsung).fps, 30);
});

test('resolveFrameRate with nothing reported keeps 30 and says so', () => {
  const r = resolveFrameRate(60, []);
  assert.equal(r.fps, 30); assert.deepEqual(r.range, [30, 30]); assert.match(r.reason, /no frame-rate ranges reported/);
});

test('frameRateWarnings: 60 on a converting path warns about dropped frames; a film rate about choppiness; variable about floating', () => {
  assert.equal(frameRateWarnings(30, { frameSource: 'hardware' }).length, 0);
  const gpu = frameRateWarnings(60, { frameSource: 'gpu', convertMsPerFrame: 12 });
  assert.ok(gpu.some((w) => /expect dropped frames/.test(w)));
  assert.ok(gpu.some((w) => /halves the longest shutter to 16.7 ms/.test(w)));
  const hw = frameRateWarnings(60, { frameSource: 'hardware' });
  assert.ok(!hw.some((w) => /dropped/.test(w)));
  assert.ok(frameRateWarnings(24, {}).some((w) => /film rate/.test(w)));
  assert.ok(frameRateWarnings(25, { exact: false }).some((w) => /float/.test(w)));
});
