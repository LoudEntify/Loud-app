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
export function renderFrame(ctx, layout, { sources = {}, names = {}, logoImage = null, placeholderTint = { a: 'rgba(46,196,182,0.35)', b: 'rgba(255,159,28,0.35)' } } = {}) {
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
