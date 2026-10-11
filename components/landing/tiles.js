// components/landing/tiles.js — the landing mosaic as data.
//
// IMAGES is the manifest: one line per performer image in
// public/landing/performers/. Adding a picture is adding a line here; the
// column plan below is derived from the list, so nothing else changes.
//
//   file   the WebP in public/landing/performers/, served as is
//   w, h   its pixel size, written into the <img> so nothing shifts
//   frame  which device frame shows it: 'phone' (9:16), 'fold' (1:1) or
//          'desktop' (16:9). Chosen by the picture's own ratio.
//   label  the genre shown in the live-view overlay, from the file name.
//          null means "no label yet" (classic.webp is waiting for Korey).
//   focus  object-position, so a crop keeps the face: 3:4 pictures lose
//          their top and bottom in a square and their sides in a phone.
//
// tests/landing.test.mjs checks every line against the file on disk.

export const IMAGES = [
  // Order matters a little: the planner deals pictures out in this order,
  // so the first picture of each column is what a visitor sees first and
  // what the browser must fetch before the largest paint. Light files
  // (hip-hop 33 KB, k-pop 46 KB) sit where columns start.
  { file: 'afrobeat.webp', w: 768, h: 1376, frame: 'phone', label: 'Afrobeats', focus: '50% 30%' },
  { file: 'blues.webp', w: 768, h: 1376, frame: 'phone', label: 'Blues', focus: '50% 35%' },
  { file: 'grime.webp', w: 768, h: 1376, frame: 'phone', label: 'Grime', focus: '50% 35%' },
  { file: 'hip-hop.webp', w: 768, h: 1376, frame: 'phone', label: 'Hip-Hop', focus: '50% 40%' },
  { file: 'k-pop.webp', w: 896, h: 1200, frame: 'fold', label: 'K-pop', focus: '50% 28%' },
  { file: 'punjabi.webp', w: 896, h: 1200, frame: 'fold', label: 'Punjabi', focus: '50% 22%' },
  { file: 'amapiano.webp', w: 1024, h: 1024, frame: 'fold', label: 'Amapiano', focus: '50% 40%' },
  { file: 'country.webp', w: 896, h: 1200, frame: 'phone', label: 'Country', focus: '50% 30%' },
  { file: 'arabic.webp', w: 1376, h: 768, frame: 'desktop', label: 'Arabic', focus: '50% 40%' },
  { file: 'classic.webp', w: 1376, h: 768, frame: 'desktop', label: null, focus: '50% 40%' },
  { file: 'gospel.webp', w: 1376, h: 768, frame: 'desktop', label: 'Gospel', focus: '50% 35%' },
];

export const IMAGE_DIR = '/landing/performers/';

// ── Geometry, in column widths ───────────────────────────────
// Every vertical size in a column is a multiple of the column's width
// (aspect-ratio boxes and % margins), so a tile's position in its loop is
// the same fraction at every screen size. That is what lets a CSS-only
// highlight know when a tile is on screen: see cutPhase() below.
export const TILE_HEIGHT = { phone: 16 / 9, fold: 1, desktop: 10 / 16 };
export const GAP = 0.07; // margin-bottom on every tile, as a fraction of the column width

// A column must be at least this tall (in widths) so one duplicate is
// enough: the loop shows a gap only if the viewport is taller than the
// unique run. 6.4 covers a 1080px-tall screen with 5 columns.
export const MIN_COLUMN_HEIGHT = 6.4;
export const COLUMNS = 5; // the most any screen shows; CSS hides the rest

// Each column walks the manifest with its own stride, so neighbouring
// columns never show the same run of pictures in the same order.
const STRIDES = [1, 4, 7, 3, 5];

export const HIGHLIGHT_EVERY_S = 2.7; // target gap between director cuts

// The ring is on just before an "up" tile's top reaches the column's top
// edge (it is about to leave) and just after a "down" tile's does (it has
// just arrived), as fractions of the loop so the lead is the same number
// of pixels at every loop length. landing.css sets the same fractions as
// --shift; tests/landing.test.mjs checks they agree.
export const RING_SHIFT = { up: -0.036, down: 0.009 };

export function genreLabel(image) { return image.label; }

// ── The plan ─────────────────────────────────────────────────
// Deterministic: the server and the browser must build the same markup.
export function planColumns(images = IMAGES) {
  const columns = [];
  let start = 0;
  for (let c = 0; c < COLUMNS; c += 1) {
    const tiles = [];
    let height = 0;
    const seen = new Set();
    const stride = STRIDES[c % STRIDES.length];
    let k = 0;
    while (height < MIN_COLUMN_HEIGHT && seen.size < images.length) {
      // the next picture on this column's walk that it has not shown yet
      const img = images[(start + k * stride) % images.length];
      k += 1;
      if (seen.has(img.file)) continue;
      seen.add(img.file);
      tiles.push({ kind: 'image', image: img, h: TILE_HEIGHT[img.frame] });
      height += TILE_HEIGHT[img.frame] + GAP;
    }
    start += tiles.length;
    columns.push({ index: c, direction: c % 2 === 0 ? 'up' : 'down', tiles, height });
  }
  // Every picture appears somewhere: one the walks skipped goes into the
  // shortest column that has not shown it yet.
  for (const img of images) {
    if (columns.some((c) => c.tiles.some((t) => t.image.file === img.file))) continue;
    const target = [...columns].filter((c) => !c.tiles.some((t) => t.image.file === img.file)).sort((a, b) => a.height - b.height)[0];
    target.tiles.push({ kind: 'image', image: img, h: TILE_HEIGHT[img.frame] });
    target.height += TILE_HEIGHT[img.frame] + GAP;
  }
  // Greedy, in column order, so every prefix (the 2 columns a phone shows,
  // the 3 a laptop shows...) is spaced well on its own.
  const planned = [];
  for (const c of columns.map(withCuts)) planned.push(withPhase(c, planned));
  return planned;
}

// For each tile, `cut` is the fraction of the loop at which its top edge
// reaches the top of the column, and `fire` is when its ring actually
// lights (cut plus the direction's shift). The track is two copies of the
// run and moves one run per loop, so only the first copy reaches the top,
// except at the loop's seam where the copy takes over; both copies carry
// the same timing, and only one of them is ever on screen.
function withCuts(column) {
  let y = 0;
  const tiles = column.tiles.map((t) => {
    const top = y / column.height;
    y += t.h + GAP;
    const cut = column.direction === 'up' ? top : (1 - top) % 1;
    return { ...t, cut, fire: (cut + RING_SHIFT[column.direction] + 1) % 1 };
  });
  return { ...column, tiles };
}

// Spread the columns' cut moments apart so highlights rarely overlap. Each
// column's start phase is chosen in turn to maximise the smallest distance
// between any two cuts across the columns planned so far.
function withPhase(column, earlierColumns) {
  const earlier = earlierColumns.map((c) => c.tiles.map((t) => (t.fire - c.phase + 2) % 1)).flat();
  let best = 0; let bestGap = -1;
  if (earlier.length === 0) return { ...column, phase: 0 };
  for (let step = 0; step < 200; step += 1) {
    const phase = step / 200;
    const mine = column.tiles.map((t) => (t.fire - phase + 2) % 1);
    let gap = 1;
    for (const a of mine) for (const b of earlier) {
      const d = Math.abs(a - b); gap = Math.min(gap, Math.min(d, 1 - d));
    }
    if (gap > bestGap) { bestGap = gap; best = phase; }
  }
  return { ...column, phase: best };
}

// Loop length for a given number of visible columns, so that across them
// a tile reaches the top of its column about every HIGHLIGHT_EVERY_S.
export function loopSeconds(columns, visible) {
  const pictures = columns.slice(0, visible).reduce((n, c) => n + c.tiles.length, 0);
  return Math.round(pictures * HIGHLIGHT_EVERY_S);
}

// The loop lengths landing.css uses per column count (its --dur values and
// the lm-cut-* keyframes). tests/landing.test.mjs checks they still match
// loopSeconds() after the manifest changes; if the test fails, update the
// four numbers in landing.css and here.
export const LOOP_SECONDS = { 2: 27, 3: 43, 4: 59, 5: 76 };

// Smallest spacing, in seconds, between any two director cuts across the
// first `visible` columns. Used by the test to prove "one tile at a time".
export function minCutGap(columns, visible, seconds = LOOP_SECONDS[visible]) {
  const cuts = columns.slice(0, visible).flatMap((c) => c.tiles.map((t) => ((t.fire - c.phase) % 1 + 1) % 1)).sort((a, b) => a - b);
  let gap = 1;
  for (let i = 1; i < cuts.length; i += 1) gap = Math.min(gap, cuts[i] - cuts[i - 1]);
  gap = Math.min(gap, 1 - cuts[cuts.length - 1] + cuts[0]);
  return gap * seconds;
}
