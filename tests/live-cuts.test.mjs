// The artist cutting their own show: which cuts exist, which are live,
// and what happens when one is asked for that cannot be given.
//
// The rule under most of these is CLAUDE.md §4: the show must never stop.
// A refused cut leaves the picture exactly where it was.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CUTS, CUT_ROLES, DEFAULT_CUT, DIRECTOR_MODES,
  cutAvailability, availableCuts, resolveCut, shotKeyFor, onAirLabel, directorLabel,
} from '../lib/liveCuts.js';
import { DEFAULT_DIRECTION, normaliseDirection } from '../lib/direction.js';

const live = { main: { live: true }, side: { live: true }, close: { live: true } };

test('the cuts are the four the tablet console draws, in that order', () => {
  assert.deepEqual(CUT_ROLES, ['main', 'side', 'close', 'broll']);
  assert.deepEqual(CUTS.map((c) => c.label), ['Main', 'Side', 'Close', 'B-roll']);
  assert.equal(DEFAULT_CUT, 'main');
  assert.deepEqual([...DIRECTOR_MODES], ['auto', 'manual']);
});

test('every cut maps to a shot the grammar already knows', () => {
  for (const role of CUT_ROLES) {
    assert.ok(shotKeyFor(role), `${role} has no shot key, so the egress log could not name it`);
  }
});

test('a camera that is paired but not sending is not available', () => {
  const rows = cutAvailability({ cameras: { main: { live: true }, side: { live: false } } });
  const byRole = Object.fromEntries(rows.map((r) => [r.role, r]));
  assert.equal(byRole.main.available, true);
  assert.equal(byRole.side.available, false);
  assert.match(byRole.side.why, /stopped sending/i);
  // Not paired at all reads differently from paired and dead.
  assert.equal(byRole.close.available, false);
  assert.match(byRole.close.why, /Pair a phone/i);
});

test('b-roll appears only when there is a clip to play', () => {
  const without = cutAvailability({ cameras: live, brollCount: 0 }).find((c) => c.role === 'broll');
  assert.equal(without.available, false);
  assert.match(without.why, /Studio library/);
  const with1 = cutAvailability({ cameras: live, brollCount: 1 }).find((c) => c.role === 'broll');
  assert.equal(with1.available, true);
});

test('a cut the artist switched off in Direction settings is not offered', () => {
  // Close-ups off: the Close tile goes with them.
  const settings = normaliseDirection({ ...DEFAULT_DIRECTION, techniques: { ...DEFAULT_DIRECTION.techniques, closeUp: false } });
  const rows = cutAvailability({ cameras: live, brollCount: 2, settings });
  const close = rows.find((c) => c.role === 'close');
  assert.equal(close.available, false);
  assert.match(close.why, /Direction settings/);
  // And the ones they kept are still there.
  assert.ok(availableCuts({ cameras: live, brollCount: 2, settings }).includes('side'));
});

test('taking a cut by hand leaves Auto, and the picture moves', () => {
  const r = resolveCut({ current: 'main', requested: 'side', mode: 'auto', cameras: live });
  assert.equal(r.role, 'side');
  assert.equal(r.mode, 'manual');
  assert.equal(r.changed, true);
  assert.equal(r.refused, null);
  assert.equal(r.shotKey, shotKeyFor('side'));
});

test('going back to Auto hands over from wherever it was', () => {
  const r = resolveCut({ current: 'close', requested: 'auto', mode: 'manual', cameras: live });
  assert.equal(r.mode, 'auto');
  assert.equal(r.role, 'close', 'the picture does not jump just because the director took over');
  assert.equal(r.changed, false);
});

test('a cut that cannot be given is refused, and nothing on air moves', () => {
  const r = resolveCut({ current: 'main', requested: 'broll', mode: 'manual', cameras: live, brollCount: 0 });
  assert.equal(r.role, 'main', 'the audience must not see a cut to nothing');
  assert.equal(r.changed, false);
  assert.match(r.refused, /Studio library/);
  // The same for a camera that has dropped.
  const dead = resolveCut({ current: 'main', requested: 'side', cameras: { main: { live: true }, side: { live: false } } });
  assert.equal(dead.role, 'main');
  assert.match(dead.refused, /stopped sending/i);
  // And for nonsense.
  const junk = resolveCut({ current: 'main', requested: 'telephoto', cameras: live });
  assert.equal(junk.role, 'main');
  assert.match(junk.refused, /not a camera/i);
});

test('when what is on air drops, the show falls back rather than holding a dead feed', () => {
  const r = resolveCut({ current: 'side', requested: null, mode: 'manual', cameras: { main: { live: true }, side: { live: false } } });
  assert.equal(r.role, 'main');
  assert.equal(r.changed, true);
  assert.equal(r.refused, null, 'a camera dropping is not something to tell the artist off about');
  assert.equal(r.mode, 'manual', 'a dropped camera does not hand the show back to the director');
});

test('with nothing available at all the show still names a cut', () => {
  // Everything off. The layout still needs a source, and main is the one
  // the frame falls back to, so this must never return nothing.
  const r = resolveCut({ current: 'side', cameras: {}, brollCount: 0 });
  assert.ok(CUT_ROLES.includes(r.role));
  assert.equal(r.role, DEFAULT_CUT);
});

test('the labels are the ones the boards print', () => {
  assert.equal(onAirLabel('main'), 'ON AIR · MAIN');
  assert.equal(onAirLabel('broll'), 'ON AIR · B-ROLL');
  assert.equal(directorLabel('auto'), 'Director: Auto');
  assert.equal(directorLabel('manual'), 'Director: Manual');
});

// ── The cut reaches the composed frame ───────────────────────────────────
import { composeLayout } from '../lib/pipeline/compositor.js';

test('the camera on air rides on slot A, in every layout', () => {
  const solo = composeLayout({ mode: 'solo', cut: 'close' });
  assert.equal(solo.layers[0].slot, 'a');
  assert.equal(solo.layers[0].source, 'close');

  // Versus, split: only A carries the cut; B is the other artist's own feed.
  const split = composeLayout({ mode: 'versus', view: 'conversation', cut: 'side' });
  const a = split.layers.find((l) => l.slot === 'a');
  const b = split.layers.find((l) => l.slot === 'b');
  assert.equal(a.source, 'side');
  assert.equal(b.source, undefined);

  // Versus, A performing: A is the big layer and still carries it.
  const perf = composeLayout({ mode: 'versus', view: 'a_performing', cut: 'main' });
  assert.equal(perf.layers.find((l) => l.slot === 'a').source, 'main');

  // Versus, B performing: A is the corner window, and still carries it.
  const mirror = composeLayout({ mode: 'versus', view: 'b_performing', cut: 'broll' });
  const corner = mirror.layers.find((l) => l.slot === 'a');
  assert.equal(corner.role, 'corner');
  assert.equal(corner.source, 'broll');
});

test('a layout composed without a cut is exactly what it was before', () => {
  // The cut is additive: every existing caller (the console preview, the
  // fixture player, the geometry tests) must see the same shape as before.
  const before = composeLayout({ mode: 'versus', view: 'conversation' });
  for (const layer of before.layers) {
    assert.ok(!('source' in layer), 'no caller asked for a cut, so none should appear');
  }
  const solo = composeLayout({ mode: 'solo' });
  assert.ok(!('source' in solo.layers[0]));
});

test('a degraded Versus frame still names the camera on air', () => {
  // One artist's connection fails and the healthy one fills the frame.
  const aDown = composeLayout({ mode: 'versus', cut: 'main', healthy: { a: false, b: true } });
  assert.equal(aDown.degraded, 'a_unhealthy');
  assert.equal(aDown.layers[0].slot, 'b');
  assert.equal(aDown.layers[0].source, undefined, "B's feed is not the cutting artist's camera");

  const bDown = composeLayout({ mode: 'versus', cut: 'close', healthy: { a: true, b: false } });
  assert.equal(bDown.layers[0].slot, 'a');
  assert.equal(bDown.layers[0].source, 'close');
});
