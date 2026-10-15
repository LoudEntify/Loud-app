// Pans on the hardware path (native/src/spike/region.js, zoomPlan.js): every
// pan in every direction, at 1x and 2x, in portrait and landscape, must either
// move the applied region or be refused with an edge reason. The applied
// region is always inside the active array, and a zoomed framing is never the
// full sensor (the 15 Oct report: a pan applied the full sensor after the first move).
import test from 'node:test';
import assert from 'node:assert/strict';
import { regionFor, windowOfRect, insideActive, toSensorRect, bandOf } from '../native/src/spike/region.js';
import { capsFor, panPlan, shotWindow, zoomPlan, SHOT_HOME, PAN_DEFAULTS } from '../native/src/spike/zoomPlan.js';

const ACTIVE = { left: 0, top: 0, width: 4080, height: 3072 };
const profile = { primaryCameraId: '0', lenses: [{ id: '0', facing: 'back', sensor: { activeArray: ACTIVE, maxDigitalZoom: 4 } }], deviceZoom: { available: true, min: 1, max: 4 }, qualityCeiling: { zoom: 2.1 } };
const capsFor4 = (rotation) => capsFor(profile, { frameSource: 'hardware', panPath: 'region', deviceZoomMax: 4, cameraId: '0', rotation });
const EDGE = /at frame edge|cannot go past|crop of the zoomed frame|past the 1\.2x cap/;
const near = (a, b, tol = 0.002) => Math.abs(a - b) <= tol;

test('region: the band is the 16:9 centre of the 4:3 sensor, and a centred window is the centred band', () => {
  const b = bandOf(ACTIVE);
  assert.equal(b.width, 4080); assert.ok(Math.abs(b.height - 2295) < 0.01); assert.ok(Math.abs(b.top - 388.5) < 0.01);
  const home = regionFor({ crop: { x: 0, y: 0, w: 1, h: 1 }, rotation: 90, active: ACTIVE });
  assert.deepEqual(home.rect, [0, 389, 4080, 2684], 'the full band, not the full sensor');
  assert.equal(home.clamped, false);
});

test('region: both orientations map the same display window to the sensor rotation they were given', () => {
  const win = { x: 0.147, y: 0.0128, w: 0.84, h: 0.84 };   // the planned window from the 15 Oct report
  for (const rotation of [90, 0, 270, 180]) {
    const r = regionFor({ crop: win, rotation, active: ACTIVE });
    assert.deepEqual(insideActive(r.rect, ACTIVE), true, `rotation ${rotation} inside the active array`);
    const want = toSensorRect(rotation, win);
    const got = windowOfRect(r.rect, ACTIVE);
    assert.ok(near(got.x, want.x, 0.0005) && near(got.y, want.y, 0.0005) && near(got.w, want.w, 0.0005) && near(got.h, want.h, 0.0005),
      `rotation ${rotation}: asked ${JSON.stringify(want)} applied ${JSON.stringify(got)}`);
  }
  // The 14 Oct symptom: the applied window must not be the full sensor, with the band's -0.169 top.
  const r90 = regionFor({ crop: win, rotation: 90, active: ACTIVE }).rect;
  assert.notDeepEqual(r90, [0, 0, 4080, 3072]);
  assert.ok(r90[1] >= 389 && r90[3] <= 2684, 'the window stays in the band');
});

test('region: a zoom past the digital limit is widened to it and still inside the active array', () => {
  const r = regionFor({ crop: { x: 0.45, y: 0.45, w: 0.1, h: 0.1 }, rotation: 90, active: ACTIVE, maxDigitalZoom: 4 });
  assert.equal(r.clamped, true);
  assert.ok(insideActive(r.rect, ACTIVE));
  assert.ok(r.rect[2] - r.rect[0] >= 4080 / 4 - 1, 'no tighter than the digital zoom limit');
  assert.throws(() => regionFor({ crop: SHOT_HOME, rotation: 90 }), /active array/);
});

test('region: random framings never leave the active array', () => {
  for (const rotation of [0, 90, 180, 270]) {
    for (const zoom of [1, 1.19, 1.5, 2, 2.1, 4]) {
      for (let i = 0; i <= 10; i += 1) {
        for (let j = 0; j <= 10; j += 1) {
          const shot = { zoom, cx: 0.2 + 0.06 * i, cy: 0.2 + 0.06 * j };
          const r = regionFor({ crop: shotWindow(shot), rotation, active: ACTIVE });
          assert.ok(insideActive(r.rect, ACTIVE), `rotation ${rotation} zoom ${zoom} at ${shot.cx},${shot.cy}: ${r.rect}`);
        }
      }
    }
  }
});

// The sequence: every direction, reversals included, at 1x then 2x, in both orientations.
const SEQUENCE = ['right', 'down', 'left', 'up', 'right', 'right', 'left', 'up', 'down', 'down', 'left', 'right', 'up'];
for (const [name, rotation] of [['portrait', 90], ['landscape', 0]]) {
  for (const startZoom of [1, 2]) {
    test(`pans in ${name} from ${startZoom}x: each pan moves the applied region, or is refused with an edge reason`, () => {
      const caps = capsFor4(rotation);
      let shot = { zoom: startZoom, cx: 0.5, cy: 0.5 };
      let prev = regionFor({ crop: shotWindow(shot), rotation, active: ACTIVE }).rect;
      let moved = 0; let refused = 0;
      for (const direction of SEQUENCE) {
        const plan = panPlan({ direction, shot, caps, durationMs: PAN_DEFAULTS.durationMs });
        if (plan.refused) {
          assert.match(plan.reason, EDGE, `${name} ${startZoom}x ${direction} from ${JSON.stringify(shot)}: ${plan.reason}`);
          refused += 1;
          continue;
        }
        // every step inside the active array, and the zoomed framing never the full sensor
        for (const s of plan.steps) {
          assert.ok(s.region, 'a hardware step names its region');
          assert.ok(insideActive(s.region, ACTIVE), `step region ${s.region}`);
          if (plan.to.zoom > 1.01) assert.notDeepEqual(s.region, [0, 0, 4080, 3072], 'a zoomed pan is never the full sensor');
        }
        const last = plan.steps[plan.steps.length - 1].region;
        assert.notDeepEqual(last, prev, `${name} ${startZoom}x ${direction}: the region must move`);
        // the applied region is the planned window (within a fraction of a pixel of the band)
        const got = windowOfRect(last, ACTIVE);
        const want = toSensorRect(rotation, shotWindow(plan.to));
        assert.ok(near(got.x, want.x, 0.0005) && near(got.y, want.y, 0.0005) && near(got.w, want.w, 0.0005) && near(got.h, want.h, 0.0005),
          `${name} ${startZoom}x ${direction}: asked ${JSON.stringify(want)} applied ${JSON.stringify(got)}`);
        prev = last; shot = plan.to; moved += 1;
      }
      assert.ok(moved >= 6, `${name} ${startZoom}x: ${moved} pans moved, ${refused} refused`);
    });
  }
}

test('a zoom then pans: the zoom lands centred, the next pan moves the region again (the 15 Oct sequence)', () => {
  const caps = capsFor4(90);
  const z = zoomPlan({ profile, caps, shot: SHOT_HOME, target: 2, durationMs: 2000 });
  const zoomEnd = z.steps[z.steps.length - 1].region;
  assert.ok(insideActive(zoomEnd, ACTIVE));
  let shot = z.to; let prev = zoomEnd;
  for (const d of ['right', 'up']) {
    const p = panPlan({ direction: d, shot, caps });
    assert.equal(p.refused, false, `${d} after the zoom: ${p.reason}`);
    const r = p.steps[p.steps.length - 1].region;
    assert.notDeepEqual(r, prev, `${d} must move the region after a zoom`);
    prev = r; shot = p.to;
  }
});

test('the step regions are what the native side applies: they come from the plan, not from the camera', () => {
  const caps = capsFor4(90);
  const p = panPlan({ direction: 'left', shot: { zoom: 2, cx: 0.5, cy: 0.5 }, caps });
  assert.equal(p.refused, false);
  for (const s of p.steps) assert.equal(s.region.length, 4);
  const lens = capsFor(profile, { frameSource: 'gpu' });
  assert.ok(!lens.region, 'the gpu source names no region: the crop does the pan there');
});
