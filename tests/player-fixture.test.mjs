import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PositionClock, versusWindows, CORNER_WINDOW_SHARE } from '../lib/player/fixture.js';
import { DELIVERY_KINDS, PLAYER_STATES, makeStateReporter } from '../lib/player/PlayerSource.js';

test('position only advances while playing, and survives pause/play', () => {
  let t = 1000;
  const c = new PositionClock({ now: () => t });
  assert.equal(c.positionMs(), 0);
  c.play(); t += 5000;
  assert.equal(c.positionMs(), 5000);
  c.pause(); t += 9999;
  assert.equal(c.positionMs(), 5000, 'paused: no advance');
  c.play(); t += 1000;
  assert.equal(c.positionMs(), 6000);
  c.seek(100); assert.equal(c.positionMs(), 100);
  assert.equal(c.playing, true);
});

test('a fixture can start behind the server (delivery delay)', () => {
  let t = 0;
  const c = new PositionClock({ startMs: 0, now: () => t });
  c.play(); t = 8000;
  // server offset would be 8000 + delay; the viewer is at 8000
  assert.equal(c.positionMs(), 8000);
});

test('the three Versus views: split, corner window at ~31%, mirror', () => {
  const w = 304, h = 540;
  const conv = versusWindows('conversation', w, h);
  assert.equal(conv.a.h + conv.b.h, h);
  assert.equal(conv.a.w, w); assert.equal(conv.b.y, Math.ceil(h / 2));
  const a = versusWindows('a_performing', w, h);
  assert.deepEqual(a.a, { x: 0, y: 0, w, h });
  assert.equal(a.b.w, Math.round(w * CORNER_WINDOW_SHARE));
  assert.ok(a.b.x + a.b.w <= w && a.b.y + a.b.h <= h, 'corner window inside the frame');
  assert.ok(a.b.x > w / 2 && a.b.y > h / 2, 'corner window is lower right');
  const b = versusWindows('b_performing', w, h);
  assert.deepEqual(b.b, { x: 0, y: 0, w, h });
  assert.deepEqual(b.a, a.b, 'the mirror uses the same corner');
});

test('the PlayerSource contract names three kinds and reports states once', () => {
  assert.deepEqual(DELIVERY_KINDS, ['youtube', 'loudentify-llhls', 'fixture']);
  const seen = [];
  const report = makeStateReporter({ onState: (s) => seen.push(s) });
  report('loading'); report('loading'); report('playing'); report('nonsense'); report('paused');
  assert.deepEqual(seen, ['loading', 'playing', 'paused']);
  for (const s of seen) assert.ok(PLAYER_STATES.includes(s));
});
