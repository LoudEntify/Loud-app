// native/src/spike/region.js — the sensor crop region for one framing, platform-free.
//
// The hardware frame path hands the camera a SCALER_CROP_REGION (sensor
// pixels). This module is the one place that turns a framing (a window of
// the picture as the artist sees it, in display-frame fractions) into that
// region, so the phone applies numbers it did not compute and both
// orientations are tested here (tests/spike-pan.test.mjs). The Kotlin side
// keeps a copy only as a fallback for plans made without it.
//
// The output stream is the 16:9 band centred in the active array (the HAL
// letterboxes the region to the stream's aspect). The display frame is the
// band turned by the content rotation: 90 for a portrait show on the G35
// (sensor orientation 90, phone upright), 0 for landscape (phone on its side).
// A region never leaves the band, and never leaves the active array.
//
// PRD rows 15, 16, 127. S&I: Real-time media.

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const r4 = (v) => +v.toFixed(4);

/** The 16:9 band centred in the active array, in sensor pixels. */
export function bandOf(active) {
  const aw = active.width; const ah = active.height;
  let bandW = aw; let bandH = aw * 9 / 16;
  if (bandH > ah) { bandH = ah; bandW = ah * 16 / 9; }
  return { left: active.left + (aw - bandW) / 2, top: active.top + (ah - bandH) / 2, width: bandW, height: bandH };
}

/** A display-frame window {x,y,w,h} (fractions) as the same window in the sensor's own frame, for the given content rotation. */
export function toSensorRect(rotation, c) {
  const x = c.x; const y = c.y; const w = c.w; const h = c.h;
  switch (rotation) {
    case 90: return { x: y, y: 1 - x - w, w: h, h: w };
    case 180: return { x: 1 - x - w, y: 1 - y - h, w, h };
    case 270: return { x: 1 - y - h, y: x, w: h, h: w };
    default: return { x, y, w, h };
  }
}

/**
 * The region for a framing: `rect` = [left, top, right, bottom] in sensor
 * pixels, always inside the band and the active array. `clamped` says the
 * zoom needed more than the digital limit allows and was widened to it.
 */
export function regionFor({ crop, rotation = 90, active, maxDigitalZoom = 4 }) {
  if (!active || !Number.isFinite(active.width) || !Number.isFinite(active.height)) throw new Error('regionFor needs the active array');
  const band = bandOf(active);
  const s = toSensorRect(rotation, crop);
  let { x: fx, y: fy, w: fw, h: fh } = s;
  const minW = active.width / maxDigitalZoom / band.width;
  const minH = active.height / maxDigitalZoom / band.height;
  let clamped = false;
  if (fw < minW || fh < minH) {
    const k = Math.max(minW / fw, minH / fh);
    const cx = fx + fw / 2; const cy = fy + fh / 2;
    fw *= k; fh *= k; fx = cx - fw / 2; fy = cy - fh / 2; clamped = true;
  }
  fx = clamp(fx, 0, 1 - fw); fy = clamp(fy, 0, 1 - fh);
  const l = Math.round(band.left + fx * band.width); const t = Math.round(band.top + fy * band.height);
  const r = Math.round(band.left + (fx + fw) * band.width); const b = Math.round(band.top + (fy + fh) * band.height);
  const left = Math.max(active.left, l); const top = Math.max(active.top, t);
  const right = Math.min(active.left + active.width, r); const bottom = Math.min(active.top + active.height, b);
  return { rect: [left, top, right, bottom], clamped, band };
}

/** A region back as the band fractions the camera reports (the same arithmetic as the native appliedCrop), so a test can compare what was asked with what was applied. */
export function windowOfRect(rect, active) {
  const band = bandOf(active);
  const [l, t, r, b] = rect;
  return { x: r4((l - band.left) / band.width), y: r4((t - band.top) / band.height), w: r4((r - l) / band.width), h: r4((b - t) / band.height) };
}

/** True when a region lies inside the active array and is not empty. */
export function insideActive(rect, active) {
  const [l, t, r, b] = rect;
  return l >= active.left && t >= active.top && r <= active.left + active.width && b <= active.top + active.height && r > l && b > t;
}
