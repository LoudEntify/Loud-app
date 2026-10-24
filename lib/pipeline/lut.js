// lib/pipeline/lut.js
// ─────────────────────────────────────────────────────────────
// The look: a 3D LUT applied once, in the egress compositor, to the
// composed picture (docs/DECISIONS.md 2026-10-14; the design note in
// docs/DIRECTOR_DATA_SPEC.md). Never on a phone: raw feeds stay ungraded,
// the training store sees what the sensor saw, and the active look is
// logged per composed frame (`lut_id`, `lut_version`) so a reaction can be
// read against what was on screen.
//
// This file is pure data and arithmetic, shared by the browser preview,
// the egress and the tests:
//   parseCube / toCube      the .cube format (Adobe/Resolve; red fastest)
//   lutId                   content address of a LUT (same text → same id)
//   sampleLut / applyLut    trilinear reference implementation (CPU)
//   buildLut + LOOKS        the built-in looks, generated, so they are
//                           content-addressed like an uploaded .cube
//   colourMatchGains        the per-camera transform ahead of the LUT
//   lookPlan                what the compositor applies and the egress logs
// The GPU pass that does this at frame rate is lib/pipeline/lutGl.js.
//
// PRD rows 15, 16, 139. S&I: Real-time media.
// ─────────────────────────────────────────────────────────────

export const LUT_SIZE_DEFAULT = 17;   // 17^3 = 4913 entries: what every grading tool exports by default; smooth under trilinear
export const LUT_VERSION = 1;         // the format of what the egress logs; bump when the log line's meaning changes

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// ── .cube ────────────────────────────────────────────────────
/**
 * Parse a .cube text. Returns { title, size, domainMin, domainMax, table }
 * where table is a Float32Array of size^3 * 3 in .cube order (red index
 * changes fastest, then green, then blue). 1D LUTs (LUT_1D_SIZE) are
 * expanded to a 3D table so one sampler serves both.
 */
export function parseCube(text) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('empty .cube');
  let title = ''; let size = 0; let size1d = 0;
  let domainMin = [0, 0, 0]; let domainMax = [1, 1, 1];
  const values = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const up = line.toUpperCase();
    if (up.startsWith('TITLE')) { title = line.slice(5).trim().replace(/^"|"$/g, ''); continue; }
    if (up.startsWith('LUT_3D_SIZE')) { size = parseInt(line.split(/\s+/)[1], 10); continue; }
    if (up.startsWith('LUT_1D_SIZE')) { size1d = parseInt(line.split(/\s+/)[1], 10); continue; }
    if (up.startsWith('DOMAIN_MIN')) { domainMin = line.split(/\s+/).slice(1, 4).map(Number); continue; }
    if (up.startsWith('DOMAIN_MAX')) { domainMax = line.split(/\s+/).slice(1, 4).map(Number); continue; }
    if (up.startsWith('LUT_3D_INPUT_RANGE') || up.startsWith('LUT_1D_INPUT_RANGE')) { const [a, b] = line.split(/\s+/).slice(1, 3).map(Number); domainMin = [a, a, a]; domainMax = [b, b, b]; continue; }
    const nums = line.split(/\s+/).map(Number);
    if (nums.length >= 3 && nums.slice(0, 3).every(Number.isFinite)) values.push(nums[0], nums[1], nums[2]);
    else throw new Error(`.cube: cannot read line "${line.slice(0, 40)}"`);
  }
  if (size1d && !size) {
    if (values.length !== size1d * 3) throw new Error(`.cube: LUT_1D_SIZE ${size1d} but ${values.length / 3} entries`);
    // expand: each channel through its own 1D curve
    const n = size1d;
    const curve = (ch, v) => {
      const x = clamp01(v) * (n - 1); const i = Math.min(n - 2, Math.floor(x)); const f = x - i;
      return values[i * 3 + ch] * (1 - f) + values[(i + 1) * 3 + ch] * f;
    };
    const lut = buildLut(Math.min(n, 33), (r, g, b) => [curve(0, r), curve(1, g), curve(2, b)]);
    return { ...lut, title, domainMin, domainMax, from1d: n };
  }
  if (!size || size < 2 || size > 256) throw new Error(`.cube: missing or bad LUT_3D_SIZE (${size})`);
  if (values.length !== size * size * size * 3) throw new Error(`.cube: LUT_3D_SIZE ${size} needs ${size ** 3} entries, found ${values.length / 3}`);
  return { title, size, domainMin, domainMax, table: Float32Array.from(values) };
}

/** Serialise a LUT as .cube text (6 decimals, deterministic, so lutId is stable). */
export function toCube(lut, { title = lut.title || '' } = {}) {
  const lines = [];
  if (title) lines.push(`TITLE "${title}"`);
  lines.push(`LUT_3D_SIZE ${lut.size}`);
  const dm = lut.domainMin || [0, 0, 0]; const dx = lut.domainMax || [1, 1, 1];
  if (dm.some((v) => v !== 0) || dx.some((v) => v !== 1)) { lines.push(`DOMAIN_MIN ${dm.join(' ')}`); lines.push(`DOMAIN_MAX ${dx.join(' ')}`); }
  const t = lut.table;
  for (let i = 0; i < t.length; i += 3) lines.push(`${t[i].toFixed(6)} ${t[i + 1].toFixed(6)} ${t[i + 2].toFixed(6)}`);
  return lines.join('\n') + '\n';
}

/**
 * Content address of a LUT: 'lut_' + 16 hex of FNV-1a 64 over the
 * canonical .cube text (so an uploaded file and its re-export agree).
 * Not a security hash; a stable id for the log and the asset store.
 */
export function lutId(lutOrText) {
  // the title is metadata: the same table under another name is the same look
  const text = toCube(typeof lutOrText === 'string' ? parseCube(lutOrText) : lutOrText, { title: '' });
  let h = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n; const mask = 0xffffffffffffffffn;
  for (let i = 0; i < text.length; i++) { h ^= BigInt(text.charCodeAt(i) & 0xff); h = (h * prime) & mask; }
  return `lut_${h.toString(16).padStart(16, '0')}`;
}

// ── sampling (CPU reference) ─────────────────────────────────
/** Trilinear lookup of one colour (0..1 each) → [r, g, b]. */
export function sampleLut(lut, r, g, b) {
  const n = lut.size; const t = lut.table;
  const dm = lut.domainMin || [0, 0, 0]; const dx = lut.domainMax || [1, 1, 1];
  const pos = (v, c) => clamp01((v - dm[c]) / ((dx[c] - dm[c]) || 1)) * (n - 1);
  const x = pos(r, 0), y = pos(g, 1), z = pos(b, 2);
  const x0 = Math.min(n - 2, Math.floor(x)), y0 = Math.min(n - 2, Math.floor(y)), z0 = Math.min(n - 2, Math.floor(z));
  const fx = x - x0, fy = y - y0, fz = z - z0;
  const idx = (i, j, k) => ((k * n + j) * n + i) * 3;
  const out = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const c000 = t[idx(x0, y0, z0) + c], c100 = t[idx(x0 + 1, y0, z0) + c];
    const c010 = t[idx(x0, y0 + 1, z0) + c], c110 = t[idx(x0 + 1, y0 + 1, z0) + c];
    const c001 = t[idx(x0, y0, z0 + 1) + c], c101 = t[idx(x0 + 1, y0, z0 + 1) + c];
    const c011 = t[idx(x0, y0 + 1, z0 + 1) + c], c111 = t[idx(x0 + 1, y0 + 1, z0 + 1) + c];
    const c00 = c000 * (1 - fx) + c100 * fx, c10 = c010 * (1 - fx) + c110 * fx;
    const c01 = c001 * (1 - fx) + c101 * fx, c11 = c011 * (1 - fx) + c111 * fx;
    const c0 = c00 * (1 - fy) + c10 * fy, c1 = c01 * (1 - fy) + c11 * fy;
    out[c] = c0 * (1 - fz) + c1 * fz;
  }
  return out;
}

/**
 * Apply a look to RGBA bytes in place (the CPU path: tests, thumbnails,
 * a preview without WebGL). `gains` is the per-pixel colour match ahead of
 * the LUT ([r, g, b] multipliers, or a function (x, y) → gains when it
 * differs per layer); `strength` mixes the graded result with the input.
 */
export function applyLut(data, width, height, lut, { strength = 1, gains = null } = {}) {
  const s = clamp01(strength);
  const gainAt = typeof gains === 'function' ? gains : () => gains;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const gn = gainAt(x, y);
      let r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
      if (gn) { r = clamp01(r * gn[0]); g = clamp01(g * gn[1]); b = clamp01(b * gn[2]); }
      if (lut && s > 0) {
        const [lr, lg, lb] = sampleLut(lut, r, g, b);
        r = r + (lr - r) * s; g = g + (lg - g) * s; b = b + (lb - b) * s;
      }
      data[i] = Math.round(clamp01(r) * 255); data[i + 1] = Math.round(clamp01(g) * 255); data[i + 2] = Math.round(clamp01(b) * 255);
    }
  }
  return data;
}

// ── building looks ───────────────────────────────────────────
/** Generate a size^3 LUT from a colour function (r, g, b in 0..1) → [r, g, b]. */
export function buildLut(size, fn) {
  const table = new Float32Array(size * size * size * 3);
  let p = 0;
  for (let k = 0; k < size; k++) for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const out = fn(i / (size - 1), j / (size - 1), k / (size - 1));
    table[p++] = clamp01(out[0]); table[p++] = clamp01(out[1]); table[p++] = clamp01(out[2]);
  }
  return { size, table, domainMin: [0, 0, 0], domainMax: [1, 1, 1], title: '' };
}

export const identityLut = (size = LUT_SIZE_DEFAULT) => buildLut(size, (r, g, b) => [r, g, b]);

// colour maths the looks are written in (sRGB-ish, no linearisation: a look, not a calibration)
const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const sat = (k) => (r, g, b) => { const l = luma(r, g, b); return [l + (r - l) * k, l + (g - l) * k, l + (b - l) * k]; };
const contrast = (k, pivot = 0.5) => (v) => pivot + (v - pivot) * k;
const scurve = (k) => (v) => { const x = clamp01(v); return x - k * Math.sin(2 * Math.PI * x) / (2 * Math.PI) * 1.4; }; // gentle S: shadows down, highlights up
const lift = (amt) => (v) => v + amt * (1 - v);
const gamma = (gm) => (v) => clamp01(v) ** (1 / gm);
const each = (...fns) => (r, g, b) => { let o = [r, g, b]; for (const f of fns) o = o.map((v) => f(v)); return o; };
/** Split toning: shadows pulled toward one tint, highlights toward another (tints as [r,g,b] offsets at full weight). */
const splitTone = (shadow, high, amt) => (r, g, b) => {
  const l = luma(r, g, b); const ws = (1 - l) ** 2 * amt; const wh = l ** 2 * amt;
  return [r + shadow[0] * ws + high[0] * wh, g + shadow[1] * ws + high[1] * wh, b + shadow[2] * ws + high[2] * wh];
};
const chain = (...stages) => (r, g, b) => { let o = [r, g, b]; for (const st of stages) o = st(...o); return o; };

/**
 * The built-in looks. Each is a short recipe; the LUT is generated once
 * and content-addressed, so `lut_id` in the log means the same picture
 * next season even if a recipe is renamed. `none` is no look at all.
 */
export const LOOK_RECIPES = {
  none: { label: 'None', note: 'the camera as it is', fn: (r, g, b) => [r, g, b] },
  stage_warm: { label: 'Stage warm', note: 'warm highlights, a touch of contrast and colour: a lit stage', fn: chain(each(contrast(1.08)), sat(1.1), splitTone([0, 0, 0.02], [0.05, 0.02, -0.04], 0.9)) },
  club_cool: { label: 'Club cool', note: 'teal shadows, clean skin, more contrast: a night room', fn: chain(each(scurve(0.08)), sat(1.05), splitTone([-0.03, 0.02, 0.07], [0.04, 0.01, -0.03], 1.0)) },
  film: { label: 'Film', note: 'a soft S-curve, lifted blacks, muted colour, warm mids', fn: chain(each(lift(0.04)), each(scurve(0.07)), sat(0.88), splitTone([0.01, 0, -0.01], [0.03, 0.015, 0], 0.7)) },
  faded: { label: 'Faded', note: 'low contrast, lifted blacks, pastel colour', fn: chain(each(lift(0.08)), each(contrast(0.85)), sat(0.8)) },
  punch: { label: 'Punch', note: 'contrast and saturation up: bright, sharp, social', fn: chain(each(scurve(0.12)), sat(1.25)) },
  mono: { label: 'Mono', note: 'black and white with a gentle curve', fn: chain(each(scurve(0.06)), sat(0)) },
  mono_warm: { label: 'Mono warm', note: 'black and white with a sepia breath', fn: chain(each(scurve(0.06)), sat(0), splitTone([0.01, 0, -0.01], [0.05, 0.03, 0], 0.6)) },
};
export const LOOK_NAMES = Object.keys(LOOK_RECIPES);

const lookCache = new Map();
/** A built-in look by name → { name, label, note, lut, cube, id } (generated once; null for an unknown name). */
export function builtInLook(name, size = LUT_SIZE_DEFAULT) {
  const recipe = LOOK_RECIPES[name];
  if (!recipe) return null;
  const key = `${name}@${size}`;
  if (lookCache.has(key)) return lookCache.get(key);
  const lut = { ...buildLut(size, recipe.fn), title: recipe.label };
  const cube = toCube(lut);
  const look = { name, label: recipe.label, note: recipe.note, lut, cube, id: name === 'none' ? null : lutId(lut) };
  lookCache.set(key, look);
  return look;
}

// ── per-camera colour match (ahead of the LUT) ───────────────
/**
 * Gains that bring a feed's grey-world mean to a reference's (green held at
 * 1, so exposure is untouched and only colour moves), limited to ±25 % so
 * a bad read cannot paint a feed. means are { r, g, b } in 0..1 or 0..255.
 */
export function colourMatchGains(feedMean, referenceMean, { limit = 0.25 } = {}) {
  const norm = (m) => { const g = m?.g || 1; return { r: (m?.r ?? g) / g, b: (m?.b ?? g) / g }; };
  const f = norm(feedMean); const ref = norm(referenceMean);
  const bound = (v) => Math.min(1 + limit, Math.max(1 - limit, v));
  const gr = f.r > 0 ? bound(ref.r / f.r) : 1; const gb = f.b > 0 ? bound(ref.b / f.b) : 1;
  return [+gr.toFixed(4), 1, +gb.toFixed(4)];
}
export const COLOUR_MATCH_IDENTITY = [1, 1, 1];
/** A stable id for a colour-match triple (logged beside lut_id). */
export const colourMatchId = (gains) => (!gains || gains.every((v, i) => v === COLOUR_MATCH_IDENTITY[i]) ? null : `cm_${gains.map((v) => Math.round(v * 10000).toString(16)).join('_')}`);

// ── what the compositor applies and the egress logs ──────────
/**
 * The look for one composed frame: { lut, lutId, lutVersion, strength,
 * colourMatch: { [slot]: gains }, log }. `lut` is a parsed LUT (an uploaded
 * .cube) or a built-in look's name; strength 0..1. The `log` object is what
 * the egress writes on every frame line.
 */
export function lookPlan({ lut = 'none', strength = 1, colourMatch = {} } = {}) {
  const built = typeof lut === 'string' ? builtInLook(lut) : null;
  if (typeof lut === 'string' && !built) throw new Error(`unknown look "${lut}"; one of ${LOOK_NAMES.join(', ')}`);
  const table = built ? built.lut : lut;
  const id = built ? built.id : lut ? lutId(lut) : null;
  const s = clamp01(Number.isFinite(strength) ? strength : 1);
  const active = id != null && s > 0;
  const cm = {};
  for (const [slot, g] of Object.entries(colourMatch || {})) if (Array.isArray(g) && g.length === 3 && g.every(Number.isFinite)) cm[slot] = g;
  return {
    lut: active ? table : null, lutId: active ? id : null, lutVersion: LUT_VERSION, strength: active ? s : 0, name: built?.name ?? (active ? 'custom' : 'none'),
    colourMatch: cm,
    log: { lut_id: active ? id : null, lut_version: LUT_VERSION, lut_strength: active ? s : 0, colour_match: Object.fromEntries(Object.entries(cm).map(([k, g]) => [k, colourMatchId(g)])) },
  };
}
