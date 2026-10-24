// tests/transitions.test.mjs — transitions as pure data (lib/pipeline/transitions.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { TRANSITIONS, TRANSITION_KEYS, transitionFrame, transitionPlan, transitionAllowed, hash01, STYLE_PRESETS } from '../lib/pipeline/transitions.js';

test('every transition starts on the outgoing shot alone and ends on the incoming shot alone', () => {
  for (const k of TRANSITION_KEYS) {
    const a = transitionFrame(k, 0); const b = transitionFrame(k, 1);
    // a layer is visible when it has alpha and sits inside the frame (a swipe's incoming layer starts a whole frame away)
    const visible = (L) => L.alpha > 0.01 && Math.abs(L.dx) < 0.999 && Math.abs(L.dy) < 0.999;
    assert.ok(visible(a.out) && !visible(a.in), `${k} at u=0 shows the outgoing shot alone: ${JSON.stringify([a.out, a.in])}`);
    assert.ok(visible(b.in) && !visible(b.out), `${k} at u=1 shows the incoming shot alone: ${JSON.stringify([b.out, b.in])}`);
    assert.ok(Math.abs(b.in.dx) < 1e-6 && Math.abs(b.in.dy) < 1e-6 && Math.abs(b.in.scale - 1) < 1e-6, `${k} lands the incoming shot exactly in place`);
    assert.ok(!b.overlay || b.overlay.alpha <= 0.05, `${k} leaves no overlay at the end`);
  }
});

test('plans sample the curve at the frame rate, with a single frame for a cut, and parameters stay in range', () => {
  const cut = transitionPlan({ type: 'cut' });
  assert.equal(cut.frames.length, 1); assert.equal(cut.durationMs, 0);
  const whip = transitionPlan({ type: 'whip', fps: 30 });
  assert.equal(whip.durationMs, 260); assert.equal(whip.frames.length, 8);
  for (const k of TRANSITION_KEYS) {
    const p = transitionPlan({ type: k, fps: 30, strength: 1.5 });
    for (const f of p.frames) {
      for (const L of [f.out, f.in]) {
        assert.ok(L.alpha >= 0 && L.alpha <= 1); assert.ok(Math.abs(L.dx) <= 1.5 && Math.abs(L.dy) <= 1.5); assert.ok(L.scale > 0.5 && L.scale < 2);
        assert.ok(L.blurX >= 0 && L.blurX <= 0.25 && L.blurY >= 0 && L.blurY <= 0.25);
      }
      if (f.overlay) assert.ok(f.overlay.alpha === undefined || (f.overlay.alpha >= 0 && f.overlay.alpha <= 1));
    }
    assert.ok(p.frames[p.frames.length - 1].atMs === p.durationMs);
  }
  assert.equal(transitionPlan({ type: 'nonsense' }).type, 'cut');
});

test('the motion transitions move the way their direction says, and the whip hides the cut at peak blur', () => {
  const sw = transitionFrame('swipe', 0.5, { direction: 'left' });
  assert.ok(sw.in.dx > 0 && sw.out.dx < 0, 'a left swipe brings the incoming shot in from the right and pushes the outgoing shot left');
  assert.ok(sw.in.blurX > 0 && sw.in.blurY === 0, 'horizontal smear only');
  const up = transitionFrame('swipe', 0.5, { direction: 'up' });
  assert.ok(up.in.dy > 0 && up.in.blurY > 0 && up.in.blurX === 0);
  const mid = transitionFrame('whip', 0.5);
  assert.ok(mid.out.blurX >= 0.1 || mid.in.blurX >= 0.1, 'peak smear at the midpoint');
  const early = transitionFrame('whip', 0.2); const late = transitionFrame('whip', 0.8);
  assert.equal(early.in.alpha, 0); assert.equal(late.out.alpha, 0);
  assert.ok(early.out.blurX < mid.out.blurX && late.in.blurX < mid.in.blurX, 'the smear ramps up to the cut and down after it');
});

test('film roll: both frames roll as one strip with the bar between them, and seat with a small slip', () => {
  const f = transitionFrame('filmroll', 0.5);
  assert.ok(f.out.dy < 0 && f.in.dy > 0, 'outgoing rolls up and out, incoming rolls up from below');
  assert.ok(f.overlay && f.overlay.kind === 'bar');
  assert.ok(Math.abs(f.overlay.y - (f.in.dy - f.overlay.h)) < 1e-6, 'the bar rides just above the incoming frame');
  const seat = transitionFrame('filmroll', 0.925);
  assert.ok(seat.in.dy > 0 && seat.in.dy < 0.05, `a slip at the end: ${seat.in.dy}`);
  assert.equal(transitionFrame('filmroll', 1).in.dy, 0);
});

test('glitch is deterministic from the seed, flash and punch peak in the middle, light leak sweeps', () => {
  const a = transitionFrame('glitch', 0.4, { seed: 7 }); const b = transitionFrame('glitch', 0.4, { seed: 7 }); const c = transitionFrame('glitch', 0.4, { seed: 8 });
  assert.deepEqual(a, b); assert.notDeepEqual(a.overlay, c.overlay);
  assert.ok(hash01(1, 2) >= 0 && hash01(1, 2) < 1 && hash01(1, 2) !== hash01(1, 3));
  assert.ok(transitionFrame('flash', 0.5).overlay.alpha > transitionFrame('flash', 0.1).overlay.alpha);
  const p = transitionFrame('punch', 0.5);
  assert.ok(p.out.scale > 1 && p.in.scale > 1 && p.overlay && p.overlay.kind === 'flash');
  const l1 = transitionFrame('lightleak', 0.25).overlay; const l2 = transitionFrame('lightleak', 0.75).overlay;
  assert.ok(l1.kind === 'broll' && l2.sweep > l1.sweep && l1.blend === 'screen');
});

test('taste rules: not in the first second of a shot, one every four seconds unless cued; cut and fade are always fine', () => {
  assert.equal(transitionAllowed({ type: 'whip', sinceLastShotMs: 400, sinceLastTransitionMs: 9000 }).ok, false);
  assert.equal(transitionAllowed({ type: 'whip', sinceLastShotMs: 4000, sinceLastTransitionMs: 1500 }).ok, false);
  assert.equal(transitionAllowed({ type: 'whip', sinceLastShotMs: 4000, sinceLastTransitionMs: 9000 }).ok, true);
  assert.equal(transitionAllowed({ type: 'whip', sinceLastShotMs: 100, sinceLastTransitionMs: 100, cued: true }).ok, true);
  assert.equal(transitionAllowed({ type: 'cut', sinceLastShotMs: 0, sinceLastTransitionMs: 0 }).ok, true);
  for (const names of Object.values(STYLE_PRESETS)) for (const n of names) assert.ok(TRANSITIONS[n], `${n} is in the catalogue`);
});
