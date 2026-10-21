// The look (lib/pipeline/lut.js, lutGl.js): the .cube format round-trips,
// ids are content-addressed, the trilinear sampler is exact on the grid and
// linear between, the built-in looks are real looks (not identity, not
// clipping), the GPU packing agrees with the sampler, the compositor applies
// a look before the mark, and the egress logs the look on every frame.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseCube, toCube, lutId, sampleLut, applyLut, buildLut, identityLut, builtInLook, LOOK_NAMES, lookPlan, colourMatchGains, colourMatchId, LUT_VERSION } from '../lib/pipeline/lut.js';
import { packLutTexture, rectUniforms, FRAGMENT_SHADER, VERTEX_SHADER } from '../lib/pipeline/lutGl.js';
import { composeLayout, applyLook } from '../lib/pipeline/compositor.js';
import { FakeEgress } from '../lib/pipeline/egress.js';

const close = (a, b, eps = 1e-3) => Math.abs(a - b) <= eps;

test('parseCube reads a 3D .cube (title, size, domain, red fastest) and toCube round-trips with the same id', () => {
  const lut = buildLut(3, (r, g, b) => [r * 0.5, g, 1 - b]);
  const text = toCube({ ...lut, title: 'Test' });
  const back = parseCube(text);
  assert.equal(back.title, 'Test'); assert.equal(back.size, 3);
  assert.equal(back.table.length, 27 * 3);
  // red fastest: the second entry is r=0.5 → 0.25
  assert.ok(close(back.table[3], 0.25));
  assert.equal(lutId(back), lutId(lut));
  assert.equal(lutId(text), lutId(lut));
  assert.match(lutId(lut), /^lut_[0-9a-f]{16}$/);
  assert.notEqual(lutId(lut), lutId(identityLut(3)));
});

test('parseCube expands a 1D LUT and refuses bad files', () => {
  const oneD = 'LUT_1D_SIZE 2\n0 0 0\n1 0.5 1\n';
  const lut = parseCube(oneD);
  assert.equal(lut.from1d, 2);
  const [r, g, b] = sampleLut(lut, 1, 1, 1);
  assert.ok(close(r, 1) && close(g, 0.5) && close(b, 1));
  assert.throws(() => parseCube('LUT_3D_SIZE 2\n0 0 0\n'), /needs 8 entries/);
  assert.throws(() => parseCube('LUT_3D_SIZE 2\nhello\n'), /cannot read/);
  assert.throws(() => parseCube(''), /empty/);
});

test('sampleLut is exact on grid points and linear between them; the identity LUT returns its input', () => {
  const id = identityLut(5);
  for (const v of [0, 0.25, 0.3, 0.71, 1]) { const [r, g, b] = sampleLut(id, v, 1 - v, v * 0.5); assert.ok(close(r, v) && close(g, 1 - v) && close(b, v * 0.5)); }
  const half = buildLut(2, (r) => [r * r, 0, 0]);   // 2 points: linear between 0 and 1 whatever the function
  assert.ok(close(sampleLut(half, 0.5, 0, 0)[0], 0.5));
});

test('applyLut grades RGBA bytes in place, honours strength and per-pixel gains', () => {
  const mono = builtInLook('mono').lut;
  const data = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255]);
  applyLut(data, 2, 1, mono);
  assert.equal(data[0], data[1]); assert.equal(data[1], data[2]);   // red → grey
  assert.equal(data[4], data[5]);
  const half = new Uint8ClampedArray([255, 0, 0, 255]);
  applyLut(half, 1, 1, mono, { strength: 0.5 });
  assert.ok(half[0] > half[1]);                                     // half way: still reddish
  const gained = new Uint8ClampedArray([100, 100, 100, 255, 100, 100, 100, 255]);
  applyLut(gained, 2, 1, null, { gains: (x) => (x === 0 ? [1.2, 1, 0.8] : null) });
  assert.deepEqual([...gained.slice(0, 3)], [120, 100, 80]);
  assert.deepEqual([...gained.slice(4, 7)], [100, 100, 100]);
});

test('the built-in looks: every name builds, none is identity (except none), black stays black-ish, white stays white-ish, ids differ', () => {
  const ids = new Set();
  for (const name of LOOK_NAMES) {
    const look = builtInLook(name);
    assert.ok(look.lut.size >= 17, name);
    const [r0, g0, b0] = sampleLut(look.lut, 0, 0, 0); const [r1, g1, b1] = sampleLut(look.lut, 1, 1, 1);
    assert.ok(Math.max(r0, g0, b0) < 0.15, `${name} black ${[r0, g0, b0]}`);
    assert.ok(Math.min(r1, g1, b1) > 0.85, `${name} white ${[r1, g1, b1]}`);
    if (name === 'none') { assert.equal(look.id, null); continue; }
    ids.add(look.id);
    // a mid-grey skin-ish tone must move somewhere, and not by more than a look should
    const inp = [0.7, 0.5, 0.4]; const out = sampleLut(look.lut, ...inp);
    const dist = Math.hypot(...out.map((v, i) => v - inp[i]));
    assert.ok(dist > 0.01 && dist < 0.35, `${name} moved ${dist}`);
  }
  assert.equal(ids.size, LOOK_NAMES.length - 1);
  assert.equal(builtInLook('nope'), null);
  // generated once: the same object comes back
  assert.equal(builtInLook('film'), builtInLook('film'));
});

test('mono has no colour; stage_warm warms the highlights and club_cool cools the shadows', () => {
  const [r, g, b] = sampleLut(builtInLook('mono').lut, 0.8, 0.3, 0.2);
  assert.ok(close(r, g, 0.005) && close(g, b, 0.005));
  const warm = sampleLut(builtInLook('stage_warm').lut, 0.85, 0.85, 0.85);
  assert.ok(warm[0] > warm[2]);
  const cool = sampleLut(builtInLook('club_cool').lut, 0.15, 0.15, 0.15);
  assert.ok(cool[2] > cool[0]);
});

test('packLutTexture lays the LUT out as N tiles of N x N and agrees with the table', () => {
  const lut = builtInLook('punch').lut; const n = lut.size;
  const tex = packLutTexture(lut);
  assert.equal(tex.width, n * n); assert.equal(tex.height, n);
  // entry (i=3, j=5, k=7): tile 7, x = 7n + 3, y = 5
  const i = 3, j = 5, k = 7;
  const src = ((k * n + j) * n + i) * 3; const dst = (j * tex.width + (k * n + i)) * 4;
  assert.equal(tex.data[dst], Math.round(lut.table[src] * 255));
  assert.equal(tex.data[dst + 2], Math.round(lut.table[src + 2] * 255));
  assert.equal(tex.data[dst + 3], 255);
});

test('the shader declares every uniform the pass sets, and rectUniforms maps slots to 0..1 rects', () => {
  for (const u of ['u_frame', 'u_lut', 'u_size', 'u_strength', 'u_hasLut', 'u_rect0', 'u_rect1', 'u_gain0', 'u_gain1', 'u_gainDefault']) assert.ok(FRAGMENT_SHADER.includes(`uniform`) && FRAGMENT_SHADER.includes(u), u);
  assert.ok(VERTEX_SHADER.includes('a_pos'));
  const layout = composeLayout({ mode: 'versus', view: 'a_performing' });
  const r = rectUniforms(layout, { b: [1.1, 1, 0.9] });
  assert.deepEqual(r.rect1, [0, 0, 0, 0]);
  assert.deepEqual(r.gain0, [1.1, 1, 0.9]);
  assert.ok(r.rect0[0] > 0.5 && r.rect0[2] < 0.4);   // the corner window, lower right
  assert.deepEqual(rectUniforms(layout, {}).gain0, [1, 1, 1]);
});

test('lookPlan: a built-in name or a parsed LUT, strength, colour match; none/0 means no look; the log is what the egress writes', () => {
  const p = lookPlan({ lut: 'film', strength: 0.8, colourMatch: { a: [1.05, 1, 0.97], b: 'junk' } });
  assert.equal(p.lutId, builtInLook('film').id); assert.equal(p.strength, 0.8); assert.equal(p.name, 'film');
  assert.deepEqual(Object.keys(p.colourMatch), ['a']);
  assert.deepEqual(p.log, { lut_id: p.lutId, lut_version: LUT_VERSION, lut_strength: 0.8, colour_match: { a: colourMatchId([1.05, 1, 0.97]) } });
  assert.equal(lookPlan({ lut: 'none' }).lut, null);
  assert.equal(lookPlan({ lut: 'film', strength: 0 }).lutId, null);
  assert.equal(lookPlan().log.lut_id, null);
  const custom = lookPlan({ lut: parseCube(toCube(builtInLook('punch').lut)) });
  assert.equal(custom.lutId, builtInLook('punch').id); assert.equal(custom.name, 'custom');
  assert.throws(() => lookPlan({ lut: 'vhs' }), /unknown look/);
});

test('colourMatchGains moves red and blue toward the reference, holds green, and is capped at 25 %', () => {
  assert.deepEqual(colourMatchGains({ r: 0.5, g: 0.5, b: 0.5 }, { r: 0.55, g: 0.5, b: 0.45 }), [1.1, 1, 0.9]);
  assert.deepEqual(colourMatchGains({ r: 0.2, g: 0.5, b: 0.5 }, { r: 0.6, g: 0.5, b: 0.5 }), [1.25, 1, 1]);
  assert.deepEqual(colourMatchGains({ r: 120, g: 100, b: 80 }, { r: 120, g: 100, b: 80 }), [1, 1, 1]);
  assert.equal(colourMatchId([1, 1, 1]), null);
  assert.match(colourMatchId([1.1, 1, 0.9]), /^cm_/);
});

test('applyLook grades the composed feeds through a fake 2D context and skips when there is nothing to do', () => {
  const w = 4, h = 4;
  const px = new Uint8ClampedArray(w * h * 4).fill(255);
  for (let i = 0; i < w * h; i++) { px[i * 4] = 200; px[i * 4 + 1] = 60; px[i * 4 + 2] = 40; }
  const ctx = { getImageData: () => ({ data: px, width: w, height: h }), putImageData: () => {}, canvas: {} };
  const layout = composeLayout({ mode: 'solo', w, h });
  assert.equal(applyLook(ctx, layout, lookPlan({ lut: 'none' })), false);
  assert.equal(applyLook(ctx, layout, lookPlan({ lut: 'mono' })), true);
  assert.equal(px[0], px[1]); assert.equal(px[1], px[2]);
  // a GPU pass, when given, is used instead of the CPU path
  let used = 0; const drawn = [];
  const pass = { setLook: () => { used += 1; }, apply: () => 'graded', active: () => true };
  const ctx2 = { drawImage: (img) => drawn.push(img), canvas: {} };
  assert.equal(applyLook(ctx2, layout, lookPlan({ lut: 'film' }), pass), true);
  assert.equal(used, 1); assert.deepEqual(drawn, ['graded']);
});

test('the egress logs lut_id, lut_version, lut_strength and colour_match on every frame line', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lut-egress-'));
  const eg = new FakeEgress({ rootDir: dir });
  await eg.start({ showId: 'show1', targets: [{ broadcastId: 'b1', ingestUrl: 'rtmp://x', streamKey: 'k' }] });
  const layout = composeLayout({ mode: 'solo' });
  eg.pushFrame({ tMs: 0, layout });
  eg.pushFrame({ tMs: 33, layout, look: lookPlan({ lut: 'film', strength: 0.5, colourMatch: { a: [1.1, 1, 0.9] } }) });
  const lines = fs.readFileSync(path.join(dir, 'show1', 'recording.ndjson'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lines[0].lut_id, null); assert.equal(lines[0].lut_strength, 0);
  assert.equal(lines[1].lut_id, builtInLook('film').id); assert.equal(lines[1].lut_version, LUT_VERSION); assert.equal(lines[1].lut_strength, 0.5);
  assert.equal(lines[1].colour_match.a, colourMatchId([1.1, 1, 0.9]));
  const yt = fs.readFileSync(path.join(dir, 'show1', 'youtube-b1.ndjson'), 'utf8');
  assert.ok(!yt.includes('"k"'));
});
