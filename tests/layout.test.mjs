import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeShowLayout, layoutViolations, MODES } from '../lib/player/layout.js';
import { playerFrame } from '../lib/design/tokens.js';

// The frames the designs specify, the phones people actually hold, and the
// awkward sizes in between (a browser with its chrome, a landscape Fold).
const VIEWPORTS = [
  [390, 844], [375, 667], [360, 740], [414, 896], [430, 932],   // phones
  [320, 568],                                                     // the smallest phone still sold second-hand
  [600, 900], [768, 844], [768, 1024], [820, 1180], [1024, 768], // Fold open, tablets, landscape
  [1280, 720], [1366, 768], [1440, 900], [1920, 1080],           // computers
];

test('the player is never under 200x200 and nothing overlaps it, at every width and in every mode', () => {
  for (const [width, height] of VIEWPORTS) {
    for (const mode of MODES) {
      const layout = computeShowLayout({ width, height, mode });
      const v = layoutViolations(layout);
      assert.deepEqual(v, [], `${width}x${height} ${mode}: ${v.join('; ')}`);
      // and everything stays inside the viewport
      const all = [layout.player, ...Object.values(layout.regions)];
      for (const r of all) {
        assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= width + 0.5 && r.y + r.h <= height + 0.5, `${width}x${height} ${mode}: a region leaves the viewport ${JSON.stringify(r)}`);
      }
    }
  }
});

test('the design frames are reproduced at the design sizes', () => {
  const phone = computeShowLayout({ width: 390, height: 844, mode: 'default' });
  assert.deepEqual({ w: phone.player.w, h: phone.player.h }, playerFrame.phone);
  assert.equal(phone.player.x, 12); assert.equal(phone.player.y, 104);
  const bigger = computeShowLayout({ width: 390, height: 844, mode: 'bigger' });
  assert.deepEqual({ w: bigger.player.w, h: bigger.player.h }, playerFrame.bigger);
  assert.equal(bigger.chatCollapsed, true);
  const vote = computeShowLayout({ width: 390, height: 844, mode: 'vote' });
  assert.equal(vote.player.w, 270);
  const guest = computeShowLayout({ width: 390, height: 844, mode: 'guest' });
  assert.deepEqual({ w: guest.player.w, h: guest.player.h }, playerFrame.guest);
  const fold = computeShowLayout({ width: 768, height: 844, mode: 'default' });
  assert.deepEqual({ w: fold.player.w, h: fold.player.h }, playerFrame.foldTablet);
  assert.equal(fold.player.x, 24); assert.equal(fold.player.y, 84);
  const computer = computeShowLayout({ width: 1440, height: 900, mode: 'default' });
  assert.deepEqual({ w: computer.player.w, h: computer.player.h }, playerFrame.computer);
  assert.equal(computer.regions.info.w, 440);
});

test('a vote or guest sheet on a wide screen never sits over the player', () => {
  for (const [w, h] of [[768, 844], [1440, 900]]) {
    for (const mode of ['vote', 'guest']) {
      const l = computeShowLayout({ width: w, height: h, mode });
      assert.ok(l.regions.sheet, `${w}: sheet region exists`);
      assert.deepEqual(layoutViolations(l), []);
    }
  }
});
