// The landing page's pure pieces: the picture manifest matches the files on
// disk, the column plan loops seamlessly and keeps one director cut at a
// time, the stylesheet's loop lengths match the plan, and nothing in the
// live show, camera, replay or console paths imports the landing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  IMAGES, IMAGE_DIR, TILE_HEIGHT, GAP, MIN_COLUMN_HEIGHT, COLUMNS, LOOP_SECONDS, RING_SHIFT,
  planColumns, loopSeconds, minCutGap,
} from '../components/landing/tiles.js';

const ROOT = new URL('..', import.meta.url).pathname;
const DIR = join(ROOT, 'public', IMAGE_DIR);

function webpSize(path) {
  const b = readFileSync(path);
  assert.equal(b.toString('latin1', 0, 4), 'RIFF'); assert.equal(b.toString('latin1', 8, 12), 'WEBP');
  const chunk = b.toString('latin1', 12, 16);
  if (chunk === 'VP8 ') return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
  if (chunk === 'VP8L') { const bits = b.readUInt32LE(21); return [(bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1]; }
  if (chunk === 'VP8X') return [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)];
  throw new Error(`unknown WebP chunk ${chunk}`);
}

test('manifest: every picture exists, is lowercase, has its real size and a frame that fits its ratio', () => {
  const onDisk = readdirSync(DIR).filter((f) => f.endsWith('.webp')).sort();
  assert.deepEqual(IMAGES.map((i) => i.file).sort(), onDisk, 'the manifest lists exactly the files in public/landing/performers');
  for (const img of IMAGES) {
    assert.equal(img.file, img.file.toLowerCase(), `${img.file} is lowercase`);
    const [w, h] = webpSize(join(DIR, img.file));
    assert.deepEqual([img.w, img.h], [w, h], `${img.file} size`);
    assert.ok(['phone', 'fold', 'desktop'].includes(img.frame), `${img.file} frame`);
    const ratio = w / h;
    const nearest = ratio < 0.8 ? 'phone' : ratio > 1.25 ? 'desktop' : 'fold';
    if (Math.abs(ratio - 0.75) > 0.01) assert.equal(img.frame, nearest, `${img.file} (${ratio.toFixed(2)}) goes in the ${nearest} frame`);
    else assert.ok(img.frame !== 'desktop', `${img.file} is 3:4, so phone or fold, never desktop`);
    assert.ok(img.label === null || (typeof img.label === 'string' && img.label.length > 0), `${img.file} label`);
    assert.match(img.focus, /^\d+% \d+%$/, `${img.file} focus`);
  }
});

test('plan: five columns, each tall enough for one duplicate, alternating direction, pictures never repeat within a column', () => {
  const cols = planColumns();
  assert.equal(cols.length, COLUMNS);
  cols.forEach((c, i) => {
    assert.equal(c.direction, i % 2 === 0 ? 'up' : 'down');
    assert.ok(c.height >= MIN_COLUMN_HEIGHT, `column ${i} is ${c.height.toFixed(2)} widths tall`);
    const sum = c.tiles.reduce((n, t) => n + t.h + GAP, 0);
    assert.ok(Math.abs(sum - c.height) < 1e-9, 'height is the sum of its tiles');
    const files = c.tiles.filter((t) => t.kind === 'image').map((t) => t.image.file);
    assert.equal(new Set(files).size, files.length, `column ${i} shows each picture once`);
    let run = 0;
    for (const t of c.tiles) { if (t.kind === 'brand') { assert.ok(run <= 2, 'at most two pictures between brand tiles'); run = 0; } else run += 1; }
    for (const t of c.tiles) { assert.ok(t.cut >= 0 && t.cut < 1, 'cut is a loop fraction'); assert.equal(t.h, TILE_HEIGHT[t.kind === 'image' ? t.image.frame : 'brand']); assert.equal(t.fire === undefined, t.kind === 'brand', 'only pictures are cut to'); }
    assert.ok(c.phase >= 0 && c.phase < 1);
  });
  // the first two columns (every screen) show every picture at least once between them? not required; but the five together must
  const all = new Set(cols.flatMap((c) => c.tiles.filter((t) => t.kind === 'image').map((t) => t.image.file)));
  assert.equal(all.size, IMAGES.length, 'every picture appears somewhere in the mosaic');
});

test('director cut: the loop lengths in landing.css match the plan and no two cuts are closer than the ring is long', () => {
  const cols = planColumns();
  const css = readFileSync(join(ROOT, 'components', 'landing', 'landing.css'), 'utf8');
  assert.ok(css.includes(`.lm-col-up .lm-tile { --shift: calc(${RING_SHIFT.up} * var(--dur)); }`), 'landing.css uses RING_SHIFT.up');
  assert.ok(css.includes(`.lm-col-down .lm-tile { --shift: calc(${RING_SHIFT.down} * var(--dur)); }`), 'landing.css uses RING_SHIFT.down');
  for (const visible of [2, 3, 4, 5]) {
    assert.equal(LOOP_SECONDS[visible], loopSeconds(cols, visible), `${visible} columns: LOOP_SECONDS in tiles.js matches the plan (update tiles.js and landing.css together)`);
    assert.ok(css.includes(`--dur: ${LOOP_SECONDS[visible]}s`), `landing.css sets --dur: ${LOOP_SECONDS[visible]}s`);
    assert.ok(css.includes(`@keyframes lm-cut-${LOOP_SECONDS[visible]} `), `landing.css has lm-cut-${LOOP_SECONDS[visible]} keyframes`);
    const mean = LOOP_SECONDS[visible] / cols.slice(0, visible).reduce((n, c) => n + c.tiles.filter((t) => t.kind === 'image').length, 0);
    assert.ok(mean >= 2 && mean <= 3, `${visible} columns: a cut every ${mean.toFixed(2)}s`);
    // the ring is on for about 0.8s at every loop length: the lm-cut-* keyframes' last stop
    const on = { 24: .0335, 35: .023, 46: .0174, 62: .013 }[LOOP_SECONDS[visible]] * LOOP_SECONDS[visible];
    const gap = minCutGap(cols, visible);
    assert.ok(gap + 1e-9 >= on, `${visible} columns: cuts ${gap.toFixed(2)}s apart, ring on for ${on.toFixed(2)}s`);
  }
});

test('the landing is imported only by app/page.js and by itself', () => {
  const importers = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) { if (name !== 'node_modules' && name !== '.next') walk(p); continue; }
      if (!/\.(js|jsx|mjs)$/.test(name)) continue;
      if (/from '[^']*(components\/landing\/|\.\/(tiles|Tiles|Mosaic|MosaicPause|LandingGate|LandingHeader|LandingPage))[^']*'/.test(readFileSync(p, 'utf8'))) importers.push(p.slice(ROOT.length));
    }
  };
  walk(join(ROOT, 'app')); walk(join(ROOT, 'components')); walk(join(ROOT, 'lib'));
  const allowed = (f) => f === 'app/page.js' || f.startsWith('components/landing/');
  assert.deepEqual(importers.filter((f) => !allowed(f)), [], 'live show, camera, replay and console code never import the landing');
  assert.ok(importers.includes('app/page.js'));
});
