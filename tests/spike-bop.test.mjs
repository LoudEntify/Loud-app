// tests/spike-bop.test.mjs — the bop: a rhythmic micro-pan with a bounce
// (zoomPlan.js bopPlan, docs/DECISIONS.md 2026-10-21). Platform-free.
import test from 'node:test';
import assert from 'node:assert/strict';
import { bopPlan, bopCurve, bopPulse, unrealisable, realise, BOP_DEFAULTS, BOP_DIRECTIONS, MIN_PAN_ZOOM, SHOT_HOME, capsFor } from '../native/src/spike/zoomPlan.js';
import { bopCommand } from '../native/src/spike/commands.js';

const gpuCaps = { frameSource: 'gpu', panPath: 'crop', deviceZoom: { available: true, min: 0.6, max: 10 }, digitalMax: 1.2 };   // the S25 Ultra
const g35 = { primaryCameraId: '0', deviceZoom: { available: true, min: 1, max: 4 }, lenses: [{ id: '0', sensor: { activeArray: { width: 4080, height: 3072, left: 0, top: 0 }, maxDigitalZoom: 4 } }] };
const hybrid = capsFor(g35, { frameSource: 'hardware', deviceZoomMax: 4, panPath: 'gpu', rotation: 90 });            // the Moto G35 since 21 Oct
const at2x = { zoom: 2, cx: 0.5, cy: 0.5 };

test('the bounce curve: a fast hit to 1, an overshoot through the other side, and back near 0 by the end of the beat', () => {
  assert.equal(bopCurve(0), 0);
  assert.ok(Math.abs(bopCurve(0.12) - 1) < 1e-9, 'the hit lands at 12 percent of the beat');
  assert.ok(bopCurve(0.06) > 0.7, 'most of the way there halfway through the attack (ease-out)');
  const min = Math.min(...Array.from({ length: 100 }, (_, i) => bopCurve(0.12 + 0.88 * i / 99)));
  assert.ok(min < -0.1, `it overshoots to the other side: ${min}`);
  assert.ok(Math.abs(bopCurve(1)) < 0.03, `it settles by the end of the beat: ${bopCurve(1)}`);
  // the pulse is the same hit without the oscillation: never negative
  assert.ok(Array.from({ length: 101 }, (_, i) => bopPulse(i / 100)).every((v) => v >= 0 && v <= 1));
  assert.ok(bopPulse(1) < 0.01);
});

test('a bop at 2x on the gpu source: beats at the tempo, every step inside the crop cap, home at the end', () => {
  const p = bopPlan({ direction: 'left-right', bpm: 120, durationMs: 4000, shot: at2x, caps: gpuCaps });
  assert.equal(p.refused, false); assert.equal(p.beats, 8); assert.equal(p.bpm, 120); assert.equal(p.beatMs, 500);
  assert.ok(p.steps.length >= 120 && p.steps.length <= 122, `30 fps for 4 s: ${p.steps.length} steps`);
  assert.ok(p.shots.every((s) => !unrealisable(s, gpuCaps)), 'every step is realisable (inside the 1.2x cap)');
  assert.ok(p.shots.every((s) => realise(s, gpuCaps).digitalFactor <= 1.2 + 1e-3));
  assert.deepEqual(p.shots[p.shots.length - 1], at2x, 'the bop ends on the shot it started from');
  assert.deepEqual(p.to, at2x);
  const cxs = p.shots.map((s) => s.cx);
  assert.ok(Math.min(...cxs) < 0.5 - 0.02 && Math.max(...cxs) > 0.5 + 0.02, 'left-right moves the framing both ways');
  assert.ok(p.shots.every((s) => Math.abs(s.cy - 0.5) < 1e-9), 'a left-right bop never moves vertically');
  // the picture moves 'left' on the first beat: the framing moves right (cx up), as for a pan
  const firstHit = p.shots[Math.round(0.12 * 500 / (1000 / 30)) - 1];
  assert.ok(firstHit.cx > 0.5, `first beat is the picture left, framing right: cx ${firstHit.cx}`);
  // the zoom pulse punches in and never out
  assert.ok(p.shots.every((s) => s.zoom >= 2 - 1e-9) && p.shots.some((s) => s.zoom > 2.01));
  assert.equal(p.pulse, 0.03);
  // monotonic step times, the last one after the duration
  for (let i = 1; i < p.steps.length; i += 1) assert.ok(p.steps[i].atMs > p.steps[i - 1].atMs);
  assert.ok(p.steps[p.steps.length - 1].atMs >= 4000);
});

test('the amplitude is the asked amount when there is room, and is cut by the crop cap or the frame edge when there is not', () => {
  // the default 0.08 of the visible frame at 2x is 0.04 of the wide frame; the cap at 2x allows 0.05, so it fits (less the 5 percent margin)
  const p = bopPlan({ direction: 'left', shot: at2x, caps: gpuCaps });
  assert.equal(p.amplitudeRequested, 0.04); assert.equal(p.capped, false); assert.ok(p.amplitude >= 0.037 && p.amplitude <= 0.04);
  // strength 2 asks 0.08, which the cap at 2x cuts to about 0.05
  const strong = bopPlan({ direction: 'left', strength: 2, shot: at2x, caps: gpuCaps });
  assert.equal(strong.capped, true); assert.ok(strong.amplitude < strong.amplitudeRequested); assert.match(strong.reason, /^amplitude 0\.0\d+ of the 0\.08 asked: the crop cap/);
  assert.ok(strong.shots.every((s) => !unrealisable(s, gpuCaps)));
  // near a frame edge the edge cuts it
  const nearEdge = bopPlan({ direction: 'left', shot: { zoom: 2, cx: 0.26, cy: 0.5 }, caps: gpuCaps });
  assert.ok(nearEdge.refused || nearEdge.amplitude < 0.011, `edge room 0.01: ${JSON.stringify({ refused: nearEdge.refused, amp: nearEdge.amplitude })}`);
});

test('a bop at a wide shot is refused like a pan, with a reason; the directions and the command are as specified', () => {
  const r = bopPlan({ direction: 'up-down', shot: SHOT_HOME, caps: gpuCaps });
  assert.equal(r.refused, true); assert.match(r.reason, new RegExp(`zoom to ${MIN_PAN_ZOOM}x or more first`)); assert.deepEqual(r.steps, []);
  assert.throws(() => bopPlan({ direction: 'sideways', shot: at2x, caps: gpuCaps }), /unknown bop direction/);
  assert.deepEqual(BOP_DIRECTIONS, ['left', 'right', 'up', 'down', 'left-right', 'up-down']);
  const c = bopCommand({ direction: 'left-right', bpm: 140, decidedAt: 1 });
  assert.equal(c.type, 'bop'); assert.equal(c.bpm, 140); assert.equal(c.durationMs, BOP_DEFAULTS.durationMs); assert.equal(c.strength, 1); assert.ok(c.id && c.decisionId);
  // tempo is clamped to the bop range, length to at least one beat
  assert.equal(bopPlan({ direction: 'left', bpm: 400, shot: at2x, caps: gpuCaps }).bpm, 200);
  assert.equal(bopPlan({ direction: 'left', bpm: 10, shot: at2x, caps: gpuCaps }).bpm, 50);
  assert.equal(bopPlan({ direction: 'left', bpm: 60, durationMs: 100, shot: at2x, caps: gpuCaps }).beats, 1);
});

test('on the Moto G35 hybrid path (region zoom, GPU pan) the bop steps carry a device zoom and a crop and stay inside the cap', () => {
  const p = bopPlan({ direction: 'up-down', bpm: 90, durationMs: 2000, shot: at2x, caps: hybrid });
  assert.equal(p.refused, false); assert.equal(p.beats, 3);
  assert.ok(p.steps.every((s) => Number.isFinite(s.deviceZoom) && s.deviceZoom >= 1 && Array.isArray(s.crop) && s.crop[2] <= 1 && s.crop[2] >= 1 / 1.2 - 1e-3));
  assert.ok(p.steps.every((s) => s.region === undefined), 'the hybrid path sends no sensor region: the region is the centred zoom, the crop carries the bop');
  assert.ok(p.shots.every((s) => Math.abs(s.cx - 0.5) < 1e-9), 'an up-down bop never moves horizontally');
  assert.deepEqual(p.shots[p.shots.length - 1], at2x);
});
