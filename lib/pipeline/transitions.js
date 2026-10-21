// lib/pipeline/transitions.js
// ─────────────────────────────────────────────────────────────
// Transitions between two shots, as pure data (docs/DECISIONS.md 2026-10-21).
//
// A transition is drawn where the show is composed (the compositor, which
// renders the directed output once for every viewer), never on the phones:
// the phones never hold each other's feeds, and a two-layer picture
// operation is nothing for the compositor's GPU. So transitions cost the
// devices nothing by construction.
//
// Each transition is a short curve (150 to 450 ms) over two layers, the
// OUTGOING shot and the INCOMING shot, plus an optional overlay (a flash,
// a film bar, a colour split, a B-roll wash). transitionFrame() gives the
// per-layer drawing parameters at progress u in [0, 1]; transitionPlan()
// samples it at the frame rate into a list the renderer applies, the way
// zoomPlan.js hands steps to the camera. Everything here is testable
// without a canvas; renderTransition() in compositor.js draws it.
//
// Parameters per layer: alpha (0..1), dx/dy (fraction of the frame; the
// picture moves that far), scale (about the centre), blurX/blurY
// (fraction of the frame width: the length of a motion smear; 0 = sharp),
// clip (an optional wipe rectangle in frame fractions {x,y,w,h}).
// Overlay: null | { kind:'flash', color, alpha } | { kind:'bar', y, h,
// alpha } | { kind:'rgbsplit', px } | { kind:'broll', alpha, blend:'screen' }.
//
// PRD rows 15, 16. S&I: Real-time media.
// ─────────────────────────────────────────────────────────────

export const TRANSITIONS = Object.freeze({
  cut:       { durationMs: 0,   label: 'Cut',        family: 'basic' },
  fade:      { durationMs: 350, label: 'Crossfade',  family: 'basic' },
  flash:     { durationMs: 160, label: 'Flash',      family: 'basic' },
  dip:       { durationMs: 300, label: 'Dip to black', family: 'basic' },
  swipe:     { durationMs: 320, label: 'Swipe',      family: 'motion', direction: 'left' },
  whip:      { durationMs: 260, label: 'Whip pan',   family: 'motion', direction: 'left' },
  punch:     { durationMs: 280, label: 'Zoom punch', family: 'motion' },
  filmroll:  { durationMs: 420, label: 'Film roll',  family: 'motion' },
  glitch:    { durationMs: 200, label: 'Glitch',     family: 'texture' },
  lightleak: { durationMs: 450, label: 'Light leak', family: 'texture' },
});
export const TRANSITION_KEYS = Object.keys(TRANSITIONS);
export const DIRECTIONS = ['left', 'right', 'up', 'down'];

/** Smooth ease, 0..1. */
export function easeInOut(u) { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); }
/** Fast out: most of the move early. */
export function easeOut(u) { u = clamp(u, 0, 1); return 1 - (1 - u) * (1 - u); }
/** Fast in: most of the move late. */
export function easeIn(u) { u = clamp(u, 0, 1); return u * u; }
function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
function r4(v) { const x = Math.round(v * 1e4) / 1e4; return x === 0 ? 0 : x; }
function vec(direction, amount) {
  // the direction names where the PICTURE goes (as pans do): 'left' moves it left
  return direction === 'left' ? [-amount, 0] : direction === 'right' ? [amount, 0] : direction === 'up' ? [0, -amount] : [0, amount];
}
const LAYER = Object.freeze({ alpha: 1, dx: 0, dy: 0, scale: 1, blurX: 0, blurY: 0, clip: null });
const layer = (o) => ({ ...LAYER, ...o });
/** A deterministic pseudo-random in [0,1) from (seed, i): the glitch must look the same on every viewer and every replay. */
export function hash01(seed, i) {
  let x = (Math.imul(seed | 0, 374761393) + Math.imul(i | 0, 668265263)) | 0;
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

/**
 * The drawing parameters of a transition at progress u (0 = the outgoing
 * shot alone, 1 = the incoming shot alone). `strength` scales the visible
 * amount (0.5 subtle .. 1.5 bold). Returns { out, in, overlay, order }:
 * `order` says which layer is drawn on top ('in' or 'out').
 */
export function transitionFrame(type, u, { direction, strength = 1, seed = 1 } = {}) {
  const t = TRANSITIONS[type] || TRANSITIONS.cut;
  const dir = DIRECTIONS.includes(direction) ? direction : (t.direction || 'left');
  const s = clamp(strength, 0.25, 2);
  u = clamp(u, 0, 1);
  switch (type) {
    case 'fade':
      return { out: layer({ alpha: 1 - easeInOut(u) }), in: layer({ alpha: easeInOut(u) }), overlay: null, order: 'in' };
    case 'flash': {
      // the outgoing shot until the middle, a white frame at the peak, the incoming after; the flash decays over the second half
      const peak = u < 0.5 ? easeIn(u / 0.5) : 1 - easeOut((u - 0.5) / 0.5);
      return { out: layer({ alpha: u < 0.5 ? 1 : 0 }), in: layer({ alpha: u < 0.5 ? 0 : 1 }), overlay: { kind: 'flash', color: '#ffffff', alpha: r4(clamp(peak * 0.9 * s, 0, 1)) }, order: 'in' };
    }
    case 'dip': {
      const dark = u < 0.5 ? easeIn(u / 0.5) : 1 - easeOut((u - 0.5) / 0.5);
      return { out: layer({ alpha: u < 0.5 ? 1 : 0 }), in: layer({ alpha: u < 0.5 ? 0 : 1 }), overlay: { kind: 'flash', color: '#000000', alpha: r4(clamp(dark, 0, 1)) }, order: 'in' };
    }
    case 'swipe': {
      // the incoming shot slides in over the outgoing one, which drifts a little the same way; a soft motion smear on the moving edge
      const e = easeInOut(u);
      const [ix, iy] = vec(dir, -(1 - e));              // incoming starts a full frame away on the far side and travels in `dir`, landing at 0
      const [ox, oy] = vec(dir, 0.25 * e * s);          // outgoing is pushed a quarter frame
      const smear = r4(0.02 * s * Math.sin(Math.PI * u)); // peaks mid-move
      const horiz = dir === 'left' || dir === 'right';
      return { out: layer({ alpha: u >= 1 ? 0 : 1, dx: r4(ox), dy: r4(oy), blurX: horiz ? smear : 0, blurY: horiz ? 0 : smear }), in: layer({ dx: r4(ix), dy: r4(iy), blurX: horiz ? smear : 0, blurY: horiz ? 0 : smear }), overlay: null, order: 'in' };
    }
    case 'whip': {
      // the outgoing shot streaks away into a smear; the incoming streaks in from the same side and settles; the cut is hidden at peak blur
      const half = u < 0.5;
      const k = half ? easeIn(u / 0.5) : 1 - easeOut((u - 0.5) / 0.5);  // 0 → 1 → 0
      const smear = r4(0.12 * s * k);
      const travel = 0.35 * s;
      const [ox, oy] = vec(dir, travel * easeIn(u / 0.5));
      const [ix, iy] = vec(dir, -travel * (1 - easeOut((u - 0.5) / 0.5)));
      const horiz = dir === 'left' || dir === 'right';
      return {
        out: layer({ alpha: half ? 1 : 0, dx: r4(half ? ox : 0), dy: r4(half ? oy : 0), blurX: horiz ? smear : 0, blurY: horiz ? 0 : smear }),
        in: layer({ alpha: half ? 0 : 1, dx: r4(half ? 0 : ix), dy: r4(half ? 0 : iy), blurX: horiz ? smear : 0, blurY: horiz ? 0 : smear }),
        overlay: null, order: 'in',
      };
    }
    case 'punch': {
      // the outgoing shot punches in and fades; the incoming lands from slightly large
      const e = easeInOut(u);
      return {
        out: layer({ alpha: 1 - easeIn(u), scale: r4(1 + 0.35 * s * e) }),
        in: layer({ alpha: easeOut(u), scale: r4(1 + 0.18 * s * (1 - e)) }),
        overlay: u > 0.35 && u < 0.65 ? { kind: 'flash', color: '#ffffff', alpha: r4(clamp(0.25 * s * Math.sin(Math.PI * (u - 0.35) / 0.3), 0, 1)) } : null, order: 'in',
      };
    }
    case 'filmroll': {
      // both frames roll vertically as one strip with a dark frame bar between them; a slip and a settle at the end
      const e = easeInOut(u);
      const slip = u > 0.85 ? 0.02 * s * Math.sin(Math.PI * (u - 0.85) / 0.15) : 0;   // a small bounce as the new frame seats
      const roll = (1 - e) + slip;                       // incoming offset from 0 (seated) in frame heights
      const bar = 0.035;                                 // the frame bar's height
      return {
        out: layer({ dy: r4(-(e - slip) * (1 + bar)) }),
        in: layer({ dy: r4(roll * (1 + bar)) }),
        overlay: u >= 1 ? null : { kind: 'bar', y: r4(roll * (1 + bar) - bar), h: bar, alpha: 0.95 }, order: 'in',   // the bar has rolled off the bottom edge once seated
      };
    }
    case 'glitch': {
      // a few frames of colour-channel split and sliced offsets over the cut; deterministic from the seed
      const half = u < 0.5;
      const k = Math.sin(Math.PI * u);                   // 0 → 1 → 0
      const i = Math.floor(u * 12);
      const px = r4(0.012 * s * k * (0.5 + hash01(seed, i)));
      return { out: layer({ alpha: half ? 1 : 0, dx: r4((hash01(seed, i + 100) - 0.5) * 0.02 * s * k) }), in: layer({ alpha: half ? 0 : 1, dx: r4((hash01(seed, i + 200) - 0.5) * 0.02 * s * k) }), overlay: px > 0.0005 ? { kind: 'rgbsplit', px, alpha: r4(clamp(k, 0, 1)), slices: 6 + Math.floor(hash01(seed, i + 300) * 6), seed: seed + i } : null, order: 'in' };
    }
    case 'lightleak': {
      // a warm wash sweeps across the cut (a B-roll leak when the artist has one, a built-in gradient otherwise)
      const k = Math.sin(Math.PI * u);
      return { out: layer({ alpha: 1 - easeInOut(u) }), in: layer({ alpha: easeInOut(u) }), overlay: { kind: 'broll', alpha: r4(clamp(0.85 * s * k, 0, 1)), blend: 'screen', sweep: r4(u) }, order: 'in' };
    }
    case 'cut':
    default:
      return { out: layer({ alpha: u < 1 ? 1 : 0 }), in: layer({ alpha: u < 1 ? 0 : 1 }), overlay: null, order: 'in' };
  }
}

/**
 * The frame-by-frame plan of a transition: { type, durationMs, frames:[{ atMs, u, ...transitionFrame }] }.
 * A 'cut' has a single frame. `durationMs` defaults to the catalogue's.
 */
export function transitionPlan({ type = 'cut', durationMs, fps = 30, direction, strength = 1, seed = 1 } = {}) {
  const t = TRANSITIONS[type] ? type : 'cut';
  const d = Math.max(0, Number.isFinite(durationMs) ? durationMs : TRANSITIONS[t].durationMs);
  const n = d > 0 ? Math.max(1, Math.round(d * fps / 1000)) : 1;
  const frames = [];
  for (let i = 1; i <= n; i += 1) {
    const u = d > 0 ? i / n : 1;
    frames.push({ atMs: Math.round(d * i / n), u: r4(u), ...transitionFrame(t, u, { direction, strength, seed }) });
  }
  return { type: t, durationMs: d, fps, direction: direction || TRANSITIONS[t].direction || null, strength, frames };
}

/**
 * Where a transition may be placed in a live show (the taste rules):
 * never inside the first second of a shot, and no more than one every
 * `minGapMs` unless a cue asks for it. Returns { ok, reason }.
 */
export function transitionAllowed({ type, sinceLastShotMs, sinceLastTransitionMs, cued = false, minShotMs = 1000, minGapMs = 4000 }) {
  if (type === 'cut' || type === 'fade') return { ok: true, reason: null };
  if (cued) return { ok: true, reason: null };
  if (sinceLastShotMs < minShotMs) return { ok: false, reason: `too soon after the shot change (${sinceLastShotMs} ms, needs ${minShotMs})` };
  if (sinceLastTransitionMs < minGapMs) return { ok: false, reason: `a transition ran ${sinceLastTransitionMs} ms ago (one every ${minGapMs} ms unless cued)` };
  return { ok: true, reason: null };
}

/** Style presets: which transitions a style reaches for by default. Every one stays switchable per artist. */
export const STYLE_PRESETS = Object.freeze({
  energetic: ['whip', 'punch', 'glitch', 'flash', 'swipe'],
  warm: ['fade', 'lightleak', 'filmroll', 'dip'],
  clean: ['cut', 'fade', 'swipe'],
});
