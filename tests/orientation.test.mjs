// A show is portrait or landscape (lib/orientation.js), and everything
// downstream follows it: the composed frame, the player's box, the advice
// given to a phone that is held the wrong way.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ORIENTATIONS, DEFAULT_ORIENTATION, FRAME, ORIENTATION_CHOICES, normaliseOrientation, showOrientation, frameFor, aspectRatioOf, mountAdvice, describeOrientation } from '../lib/orientation.js';
import { composeLayout } from '../lib/pipeline/compositor.js';
import { computeShowLayout } from '../lib/player/layout.js';
import { validateBooking } from '../lib/schedule.js';

test('the two shapes are the two YouTube wants, and portrait is the default', () => {
  assert.deepEqual(ORIENTATIONS, ['portrait', 'landscape']);
  assert.equal(DEFAULT_ORIENTATION, 'portrait');
  assert.deepEqual(FRAME.portrait, { w: 1080, h: 1920 });
  assert.deepEqual(FRAME.landscape, { w: 1920, h: 1080 });
  assert.equal(normaliseOrientation('sideways'), 'portrait');
  assert.equal(showOrientation({ orientation: 'landscape' }), 'landscape');
  assert.equal(showOrientation(null), 'portrait');
  assert.equal(ORIENTATION_CHOICES.length, 2);
  assert.match(describeOrientation('landscape'), /16:9/);
});

test('frameFor and aspectRatioOf give the frame and the box', () => {
  assert.deepEqual(frameFor({ orientation: 'landscape' }), { orientation: 'landscape', w: 1920, h: 1080, aspect: 1920 / 1080 });
  assert.equal(aspectRatioOf('portrait'), 1920 / 1080);      // taller than wide
  assert.equal(aspectRatioOf('landscape'), 1080 / 1920);     // wider than tall
});

test('the composed frame takes the shows shape, solo and versus', () => {
  const solo = composeLayout({ mode: 'solo', orientation: 'landscape' });
  assert.equal(solo.w, 1920); assert.equal(solo.h, 1080);
  assert.deepEqual(solo.layers[0].rect, { x: 0, y: 0, w: 1920, h: 1080 });
  const portrait = composeLayout({ mode: 'solo' });
  assert.equal(portrait.w, 1080); assert.equal(portrait.h, 1920);
});

test('two artists split the long side: stacked in portrait, side by side in landscape', () => {
  const p = composeLayout({ mode: 'versus', view: 'conversation' });
  assert.equal(p.layers[0].rect.w, p.w, 'portrait: full width each');
  assert.ok(p.layers[0].rect.h < p.h, 'portrait: half the height each');
  assert.ok(Number.isFinite(p.divider.y));
  const l = composeLayout({ mode: 'versus', view: 'conversation', orientation: 'landscape' });
  assert.equal(l.layers[0].rect.h, l.h, 'landscape: full height each');
  assert.ok(l.layers[0].rect.w < l.w, 'landscape: half the width each');
  assert.ok(Number.isFinite(l.divider.x));
  // neither artist is ever given a letterbox of the other's shape
  assert.ok(l.layers[0].rect.w / l.layers[0].rect.h > 0.5);
});

test('the corner window stays inside the frame and keeps a sensible size either way round', () => {
  for (const orientation of ORIENTATIONS) {
    const o = composeLayout({ mode: 'versus', view: 'a_performing', orientation });
    const corner = o.layers.find((x) => x.role === 'corner').rect;
    assert.ok(corner.x >= 0 && corner.y >= 0, `${orientation}: inside the frame`);
    assert.ok(corner.x + corner.w <= o.w, `${orientation}: not past the right edge`);
    assert.ok(corner.y + corner.h <= o.h, `${orientation}: not past the bottom`);
    assert.ok(corner.w * corner.h < o.w * o.h / 9, `${orientation}: never a third of the picture`);
  }
});

test('explicit sizes still win, so the console preview canvas is unaffected', () => {
  const l = composeLayout({ mode: 'solo', orientation: 'landscape', w: 540, h: 960 });
  assert.equal(l.w, 540); assert.equal(l.h, 960);
});

test('the player box is tall for a portrait show and wide for a landscape one', () => {
  const env = { width: 390, height: 844, mode: 'default' };
  const p = computeShowLayout({ ...env, orientation: 'portrait' });
  const l = computeShowLayout({ ...env, orientation: 'landscape' });
  assert.ok(p.player.h > p.player.w, 'portrait is taller than wide');
  assert.ok(l.player.w > l.player.h, 'landscape is wider than tall');
  // and neither escapes the viewport
  for (const r of [p.player, l.player]) {
    assert.ok(r.x >= 0 && r.y >= 0);
    assert.ok(r.x + r.w <= env.width + 1, `${r.x} + ${r.w} fits ${env.width}`);
  }
});

test('booking carries the shape, and a nonsense value falls back rather than failing', () => {
  const at = new Date(Date.now() + 3600_000).toISOString();
  const base = { mode: 'solo', startAt: at, minutes: 30, title: 'Tuesday set' };
  assert.equal(validateBooking({ ...base, orientation: 'landscape' }).values.orientation, 'landscape');
  assert.equal(validateBooking(base).values.orientation, 'portrait');
  assert.equal(validateBooking({ ...base, orientation: 'diagonal' }).values.orientation, 'portrait');
});

test('mountAdvice tells a phone held the wrong way, and says nothing when it is right', () => {
  assert.equal(mountAdvice('landscape', 'landscape').ok, true);
  assert.equal(mountAdvice('landscape', 'landscape').message, null);
  const wrong = mountAdvice('landscape', 'portrait');
  assert.equal(wrong.ok, false);
  assert.match(wrong.message, /turn the phone on its side/);
  assert.match(mountAdvice('portrait', 'landscape').message, /stand the phone up tall/);
  assert.equal(mountAdvice('portrait', 'unknown').ok, true, 'no reading, no nagging');
});
