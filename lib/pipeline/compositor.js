// lib/pipeline/compositor.js
// ─────────────────────────────────────────────────────────────
// The compositor: one portrait (9:16) composed picture per show.
//
// docs/ARCHITECTURE.md "The path (v2)" step 2 and PRD row 139: solo is the
// director's output; Versus has three views (conversation split top and
// bottom; A performing with B in a small portrait window lower right at
// about 31% of frame width; the mirror). The Loudentify logo is burned in
// before it leaves. The same spec drives the artist console preview, the
// fixture player viewers see, and the egress (which renders it to frames).
//
// composeLayout() is pure data: a list of layers with rects. renderFrame()
// draws that onto any 2D context (browser canvas now; node-canvas in the
// real egress service). Tests prove the geometry.
// ─────────────────────────────────────────────────────────────
import { applyLut } from './lut.js';

export const OUTPUT = { w: 1080, h: 1920 }; // the broadcast frame
export const CORNER_SHARE = 0.31;             // of frame width (docs/YOUTUBE_ADDENDUM.md)
export const CORNER_MARGIN_SHARE = 0.026;
export const LOGO = { heightShare: 0.018, marginShare: 0.015 };
export const VERSUS_VIEWS = ['conversation', 'a_performing', 'b_performing'];

/**
 * @param {{ mode:'solo'|'versus', view?:string, w?:number, h?:number, healthy?:{a:boolean,b:boolean} }} opts
 * @returns {{ w, h, layers:[{ slot:'a'|'b', rect:{x,y,w,h}, role:'full'|'half'|'corner', label:boolean }], logo:{x,y,h} }}
 */
export function composeLayout({ mode = 'solo', view = 'conversation', w = OUTPUT.w, h = OUTPUT.h, healthy = { a: true, b: true } } = {}) {
  const logo = { x: Math.round(w * LOGO.marginShare), y: Math.round(w * LOGO.marginShare), h: Math.round(w * LOGO.heightShare) };
  const full = (slot) => ({ slot, rect: { x: 0, y: 0, w, h }, role: 'full', label: mode === 'versus' });
  if (mode !== 'versus') return { w, h, view: 'solo', layers: [full('a')], logo };
  // Degrade, never stop: if one artist's connection fails, the healthy one fills the frame.
  if (healthy.a === false && healthy.b !== false) return { w, h, view: 'b_performing', layers: [full('b')], logo, degraded: 'a_unhealthy' };
  if (healthy.b === false && healthy.a !== false) return { w, h, view: 'a_performing', layers: [full('a')], logo, degraded: 'b_unhealthy' };
  if (!VERSUS_VIEWS.includes(view)) view = 'conversation';
  if (view === 'conversation') {
    const top = Math.floor(h / 2);
    return { w, h, view, layers: [
      { slot: 'a', rect: { x: 0, y: 0, w, h: top }, role: 'half', label: true },
      { slot: 'b', rect: { x: 0, y: h - (h - top), w, h: h - top }, role: 'half', label: true },
    ], logo, divider: { y: top } };
  }
  const cw = Math.round(w * CORNER_SHARE);
  const ch = Math.round(cw * (16 / 9) * (3 / 4)); // a portrait window, shorter than full 9:16 so it never covers a third of the frame
  const m = Math.round(w * CORNER_MARGIN_SHARE);
  const corner = { x: w - cw - m, y: h - ch - m, w: cw, h: ch };
  const [big, small] = view === 'a_performing' ? ['a', 'b'] : ['b', 'a'];
  return { w, h, view, layers: [full(big), { slot: small, rect: corner, role: 'corner', label: true }], logo };
}

/** Draw a layout onto a 2D context. `sources[slot]` is anything drawImage accepts (video, canvas, image) or null. */
export function renderFrame(ctx, layout, { sources = {}, names = {}, logoImage = null, placeholderTint = { a: 'rgba(46,196,182,0.35)', b: 'rgba(255,159,28,0.35)' }, look = null, lutPass = null } = {}) {
  const { w, h } = layout;
  ctx.fillStyle = '#0a1f2e';
  ctx.fillRect(0, 0, w, h);
  for (const layer of layout.layers) {
    const r = layer.rect;
    const src = sources[layer.slot];
    if (src) {
      // cover: keep the source's shape, crop to the window (ResponsiveRules: never stretched)
      const sw = src.videoWidth || src.width || r.w, sh = src.videoHeight || src.height || r.h;
      const scale = Math.max(r.w / sw, r.h / sh);
      const dw = sw * scale, dh = sh * scale;
      ctx.save(); ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip();
      ctx.drawImage(src, r.x + (r.w - dw) / 2, r.y + (r.h - dh) / 2, dw, dh);
      ctx.restore();
    } else {
      ctx.fillStyle = placeholderTint[layer.slot] || 'rgba(255,255,255,0.1)';
      ctx.fillRect(r.x, r.y, r.w, r.h);
    }
    if (layer.role === 'corner') { ctx.strokeStyle = 'rgba(253,255,252,0.55)'; ctx.lineWidth = Math.max(2, Math.round(w / 540)); ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2); }
    if (layer.label && names[layer.slot]) {
      const fs = Math.max(12, Math.round(r.w / 14));
      ctx.font = `700 ${fs}px 'PT Sans Narrow', 'Arial Narrow', sans-serif`;
      ctx.fillStyle = 'rgba(1,22,39,0.7)';
      const tw = ctx.measureText(names[layer.slot]).width;
      ctx.fillRect(r.x + fs * 0.5, r.y + r.h - fs * 2.1, tw + fs, fs * 1.6);
      ctx.fillStyle = '#fdfffc';
      ctx.fillText(names[layer.slot], r.x + fs, r.y + r.h - fs * 0.9);
    }
  }
  // The look (lut.js lookPlan): per-camera colour match then the show's LUT, applied to the
  // composed feeds and before the labels' divider and the mark, so the brand is never graded
  // (docs/DECISIONS.md 2026-10-14: in the compositor, never on a phone). The GPU pass when one is
  // given (lutGl.js), the CPU reference otherwise (preview thumbnails, tests).
  applyLook(ctx, layout, look, lutPass);
  if (layout.divider) { ctx.fillStyle = '#011627'; ctx.fillRect(0, layout.divider.y - 1, w, 2); }
  // the mark, burned in before it leaves
  if (logoImage) {
    const lh = layout.logo.h, lw = lh * (logoImage.width / logoImage.height || 4.56);
    ctx.drawImage(logoImage, layout.logo.x, layout.logo.y, lw, lh);
  } else {
    ctx.font = `700 ${layout.logo.h}px 'PT Sans Narrow', 'Arial Narrow', sans-serif`;
    ctx.fillStyle = 'rgba(253,255,252,0.9)';
    ctx.fillText('LOUDENTIFY', layout.logo.x, layout.logo.y + layout.logo.h);
  }
  return layout;
}

/** Apply a lookPlan() to what is on the context so far. No-op without a LUT or a colour match. */
export function applyLook(ctx, layout, look, lutPass = null) {
  if (!look || (!look.lut && !Object.keys(look.colourMatch || {}).length)) return false;
  const { w, h } = layout;
  if (lutPass) {
    lutPass.setLook(look);
    const graded = lutPass.apply(ctx.canvas, layout);
    ctx.drawImage(graded, 0, 0, w, h);
    return true;
  }
  const img = ctx.getImageData(0, 0, w, h);
  const cm = look.colourMatch || {};
  const layers = layout.layers.filter((l) => cm[l.slot]);
  const gains = layers.length
    ? (x, y) => { for (const l of layers) { const r = l.rect; if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return cm[l.slot]; } return null; }
    : null;
  applyLut(img.data, w, h, look.lut, { strength: look.strength, gains });
  ctx.putImageData(img, 0, 0);
  return true;

// ─── Transitions (lib/pipeline/transitions.js) ───────────────
// Draw one frame of a transition between two already-composed pictures
// (`outgoing` and `incoming`: canvases or images the size of the frame, each
// the renderFrame() of its own layout). The parameters come from
// transitionFrame()/transitionPlan(); nothing here decides anything. Motion
// smear is drawn as a few offset copies at low alpha, so it needs no canvas
// filter and renders the same in a browser and in node-canvas. `broll` is
// an optional image for the light leak; without one a built-in warm
// gradient is used, so the look never depends on an upload.
export function renderTransition(ctx, w, h, frame, { outgoing, incoming, broll = null } = {}) {
  ctx.fillStyle = '#0a1f2e';
  ctx.fillRect(0, 0, w, h);
  const draw = (img, p) => {
    if (!img || p.alpha <= 0) return;
    const copies = Math.max(p.blurX, p.blurY) > 0 ? 7 : 1;      // the smear: copies spread along the blur length
    ctx.save();
    if (p.clip) { ctx.beginPath(); ctx.rect(p.clip.x * w, p.clip.y * h, p.clip.w * w, p.clip.h * h); ctx.clip(); }
    for (let k = 0; k < copies; k += 1) {
      const f = copies === 1 ? 0 : (k / (copies - 1) - 0.5);
      const ox = (p.dx + f * p.blurX) * w, oy = (p.dy + f * p.blurY) * h;  // horizontal amounts are fractions of the width, vertical of the height
      ctx.globalAlpha = Math.min(1, p.alpha / copies * (copies === 1 ? 1 : 1.15));
      ctx.setTransform(p.scale, 0, 0, p.scale, w / 2 + ox - (w / 2) * p.scale, h / 2 + oy - (h / 2) * p.scale);
      ctx.drawImage(img, 0, 0, w, h);
    }
    ctx.restore();
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1;
  };
  const first = frame.order === 'in' ? frame.out : frame.in;
  const second = frame.order === 'in' ? frame.in : frame.out;
  draw(frame.order === 'in' ? outgoing : incoming, first);
  draw(frame.order === 'in' ? incoming : outgoing, second);
  const ov = frame.overlay;
  if (ov && ov.alpha > 0) {
    ctx.save();
    if (ov.kind === 'flash') { ctx.globalAlpha = ov.alpha; ctx.fillStyle = ov.color || '#fff'; ctx.fillRect(0, 0, w, h); }
    else if (ov.kind === 'bar') { ctx.globalAlpha = ov.alpha; ctx.fillStyle = '#05070a'; ctx.fillRect(0, Math.round(ov.y * h), w, Math.round(ov.h * h)); }
    else if (ov.kind === 'rgbsplit') {
      // the current picture, redrawn in slices with a small horizontal offset and a colour tint on alternate slices
      const src = frame.order === 'in' && frame.in.alpha > 0 ? incoming : outgoing;
      if (src) {
        const n = ov.slices || 8; const px = ov.px * w;
        for (let i = 0; i < n; i += 1) {
          const y0 = Math.round(i * h / n), hh = Math.round(h / n) + 1;
          const sgn = (i % 2 === 0 ? 1 : -1) * (0.5 + ((ov.seed * 31 + i * 17) % 7) / 7);
          ctx.globalAlpha = 0.6; ctx.globalCompositeOperation = 'lighter';
          ctx.fillStyle = i % 2 === 0 ? 'rgba(231,29,54,0.0)' : 'rgba(46,196,182,0.0)';
          ctx.drawImage(src, 0, y0, w, hh, Math.round(sgn * px), y0, w, hh);
        }
      }
    } else if (ov.kind === 'broll') {
      ctx.globalAlpha = ov.alpha; ctx.globalCompositeOperation = ov.blend === 'screen' ? 'screen' : 'source-over';
      if (broll) ctx.drawImage(broll, 0, 0, w, h);
      else {
        const x = (ov.sweep ?? 0.5) * w * 1.6 - w * 0.3;
        const g = ctx.createLinearGradient(x - w * 0.6, 0, x + w * 0.6, h);
        g.addColorStop(0, 'rgba(255,159,28,0)'); g.addColorStop(0.5, 'rgba(255,196,110,0.9)'); g.addColorStop(1, 'rgba(231,29,54,0)');
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      }
    }
    ctx.restore(); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }
}
