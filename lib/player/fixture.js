// lib/player/fixture.js
// ─────────────────────────────────────────────────────────────
// The test-double PlayerSource: a canvas test card with a running clock.
//
// It exists so seeded synthetic shows, the layout tests and the delay
// alignment tests run with no network and no YouTube. It keeps an honest
// playback position (advances only while playing; starts a configurable
// number of seconds behind the server, to imitate delivery delay), and it
// draws the composed picture a viewer would see: solo full frame, or the
// three Versus views (conversation split; A performing with B's corner
// window at ~31% of the frame width; the mirror).
//
// The position clock is a plain object (PositionClock) with no DOM so the
// node tests can drive it directly.
// ─────────────────────────────────────────────────────────────
import { makeStateReporter } from './PlayerSource.js';

export class PositionClock {
  constructor({ startMs = 0, now = () => Date.now() } = {}) {
    this.now = now;
    this.base = startMs;
    this.startedAt = null; // wall-clock when play began
  }
  play() { if (this.startedAt == null) this.startedAt = this.now(); }
  pause() {
    if (this.startedAt != null) { this.base += this.now() - this.startedAt; this.startedAt = null; }
  }
  get playing() { return this.startedAt != null; }
  positionMs() { return this.base + (this.startedAt != null ? this.now() - this.startedAt : 0); }
  seek(ms) { const was = this.playing; this.pause(); this.base = Math.max(0, ms); if (was) this.play(); }
}

export const CORNER_WINDOW_SHARE = 0.31; // of frame width (docs/YOUTUBE_ADDENDUM.md)

/** Where each artist's picture goes inside a frame, per Versus view. Pure. */
export function versusWindows(view, w, h) {
  if (view === 'conversation') {
    return { a: { x: 0, y: 0, w, h: Math.floor(h / 2) }, b: { x: 0, y: Math.ceil(h / 2), w, h: Math.floor(h / 2) } };
  }
  const cw = Math.round(w * CORNER_WINDOW_SHARE);
  const ch = Math.round(cw * (4 / 3));
  const corner = { x: w - cw - Math.round(w * 0.026), y: h - ch - Math.round(w * 0.026), w: cw, h: ch };
  const full = { x: 0, y: 0, w, h };
  if (view === 'a_performing') return { a: full, b: corner };
  if (view === 'b_performing') return { b: full, a: corner };
  return { a: full };
}

export function createFixtureSource(show) {
  const clock = new PositionClock({ startMs: Number(show?.fixture_start_ms || 0) });
  let el = null;
  let canvas = null;
  let raf = null;
  let report = () => {};
  let view = show?.versus_view || 'conversation';
  const isVersus = show?.performance_mode === 'versus';
  const label = show?.title || 'Fixture show';
  const names = { a: show?.artist_name || show?.artist?.display_name || 'Artist A', b: show?.artist_b?.display_name || 'Artist B' };

  function draw() {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const { width: w, height: h } = canvas;
    ctx.fillStyle = '#0a1f2e';
    ctx.fillRect(0, 0, w, h);
    const windows = isVersus ? versusWindows(view, w, h) : { a: { x: 0, y: 0, w, h } };
    const tint = { a: 'rgba(46,196,182,0.35)', b: 'rgba(255,159,28,0.35)' };
    for (const [slot, r] of Object.entries(windows)) {
      const g = ctx.createRadialGradient(r.x + r.w * 0.7, r.y + r.h * 0.2, 10, r.x + r.w * 0.5, r.y + r.h * 0.5, Math.max(r.w, r.h));
      g.addColorStop(0, tint[slot]);
      g.addColorStop(1, 'rgba(10,34,52,1)');
      ctx.fillStyle = g;
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = 'rgba(253,255,252,0.55)';
      ctx.lineWidth = 2;
      if (r.w < w) ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
      ctx.fillStyle = '#fdfffc';
      ctx.font = `700 ${Math.max(12, Math.round(r.w / 14))}px 'PT Sans Narrow', 'Arial Narrow', sans-serif`;
      ctx.fillText(names[slot], r.x + 8, r.y + r.h - 8);
    }
    if (isVersus && view === 'conversation') {
      ctx.fillStyle = '#011627';
      ctx.fillRect(0, Math.floor(h / 2) - 1, w, 2);
    }
    const pos = clock.positionMs();
    const s = Math.floor(pos / 1000);
    const mm = String(Math.floor(s / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    ctx.fillStyle = 'rgba(253,255,252,0.85)';
    ctx.font = `700 ${Math.max(14, Math.round(w / 9))}px 'PT Sans Narrow', 'Arial Narrow', sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(`${mm}:${ss}`, w / 2, h / 2 + Math.round(w / 24));
    ctx.font = `400 ${Math.max(10, Math.round(w / 22))}px 'PT Sans Narrow', 'Arial Narrow', sans-serif`;
    ctx.fillText(clock.playing ? 'FIXTURE · playing' : 'FIXTURE · paused', w / 2, h / 2 - Math.round(w / 14));
    ctx.fillText(label.slice(0, 32), w / 2, Math.round(h * 0.12));
    ctx.textAlign = 'left';
    // The Loudentify mark is burned in by the egress in real delivery; the
    // fixture draws a small text mark in the same corner so layouts match.
    ctx.font = `700 ${Math.max(9, Math.round(w / 30))}px 'PT Sans Narrow', 'Arial Narrow', sans-serif`;
    ctx.fillStyle = 'rgba(253,255,252,0.9)';
    ctx.fillText('LOUDENTIFY', 8, 8 + Math.round(w / 30));
  }

  function loop() {
    draw();
    raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(loop) : null;
  }

  return {
    kind: 'fixture',
    mount(target, opts = {}) {
      el = target;
      report = makeStateReporter(opts);
      report('loading');
      canvas = document.createElement('canvas');
      canvas.setAttribute('data-player-source', 'fixture');
      canvas.setAttribute('aria-label', 'Fixture player');
      canvas.style.cssText = 'width:100%;height:100%;display:block;background:#0a1f2e';
      const resize = () => {
        const r = el.getBoundingClientRect();
        canvas.width = Math.max(1, Math.round(r.width * (window.devicePixelRatio || 1)));
        canvas.height = Math.max(1, Math.round(r.height * (window.devicePixelRatio || 1)));
      };
      resize();
      el.appendChild(canvas);
      this._resize = resize;
      window.addEventListener('resize', resize);
      report('ready');
      if (opts.autoplay !== false) this.play();
      loop();
      return this;
    },
    play() { clock.play(); report('playing'); },
    pause() { clock.pause(); report('paused'); },
    positionMs() { return clock.positionMs(); },
    setVersusView(v) { view = v; },
    destroy() {
      if (raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
      if (this._resize) window.removeEventListener('resize', this._resize);
      clock.pause();
      canvas?.remove();
      canvas = null;
      el = null;
    },
    _clock: clock,
  };
}
