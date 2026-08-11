'use client';

import { useRef, useState, useEffect } from 'react';

// Phase 3 (redesign) -- the performer's technical controls (SHOTS, AUDIO,
// VIDEO) used to be TWO separate things: PerformerDeck's own internal
// AUDIO/VIDEO tab-switcher, and a SEPARATELY fixed-position, separately
// toggled director-panel drawer for SHOTS -- two independent floating
// elements that could (and did, per the screenshot) collide. This is the
// single replacement for both: one swipeable/tappable set of pages,
// floating on the video like everything else on a live screen, never
// scrolled -- swipe or tap a label to move between pages, the video
// never moves. Fully generic (pages: [{key, label, content}]) -- doesn't
// know or care what's actually inside each page.
//
// Round 5 rewrite -- CAPTURE-FREE by design, not another edge-case patch.
// Every earlier version of this file (rounds 1-4) used
// element.setPointerCapture() to keep tracking the pointer once a drag
// started. That mechanism has a global side effect that's easy to
// underestimate: once engaged, EVERY subsequent pointer event for that
// pointerId, page-wide, is redirected to the capturing element until an
// up/cancel event arrives. On desktop, a mouse has exactly ONE pointerId
// for the entire tab's lifetime -- so any interruption that loses that
// release event (a native file dialog stealing focus, a <select> opening,
// literally any modal) silently froze mouse input for the WHOLE PAGE,
// not just this component, until reload. Touch never hit this because
// each contact gets a fresh pointerId, so a stuck capture from one
// gesture can't contaminate the next touch. Rounds 1 and 4 patched
// individual interruption sources (defer capture past a movement
// threshold; reset on window blur) -- both were narrowing the list of
// ways the release event could be lost, not removing the mechanism whose
// failure mode was severe every time that list was incomplete.
//
// This version never calls setPointerCapture at all. Pointer position is
// tracked via listeners on `window` (not the element), attached once and
// gated internally on whether a gesture is actually in progress --
// window-level listeners keep firing wherever the pointer physically is,
// giving the identical "track movement even outside my box" property
// capture provided, without ever monopolizing anyone else's events. If a
// release event is STILL missed for some reason nobody's thought of yet,
// the worst case is a stale internal ref in THIS component alone -- the
// swipe transform might sit mid-drag until the next gesture starts fresh
// -- never a page-wide click freeze, because nothing is ever captured in
// the first place. It's also self-healing: gestureRef is a single object,
// fully replaced (not mutated piecemeal) on every new pointerdown, so
// even a hypothetically stuck previous gesture is wiped the instant the
// next one starts.
//
// Uniform across desktop and mobile by construction, not by branching on
// pointerType: each gesture captures whatever pointerId it's given at
// pointerdown into a fresh object, and only that gesture's own
// move/up/cancel events are matched against it -- doesn't matter whether
// the NEXT gesture reuses the same id (desktop) or gets a new one
// (mobile), since every gesture starts from a clean object either way.
const DRAG_START_THRESHOLD_PX = 8;

export default function SwipePages({ pages }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [dragDelta, setDragDelta] = useState(0);
  const viewportRef = useRef(null);

  // The one source of truth for "is a gesture in progress and what do we
  // know about it" -- null when idle. A single object (not several
  // separate refs the way rounds 1-4 had it) so there's no way for
  // pieces of gesture state to disagree with each other or survive only
  // partially reset.
  const gestureRef = useRef(null);

  useEffect(() => {
    function onMove(e) {
      const gesture = gestureRef.current;
      if (!gesture || e.pointerId !== gesture.pointerId) return;
      const delta = e.clientX - gesture.startX;
      gesture.lastDelta = delta;
      if (!gesture.dragging) {
        if (Math.abs(delta) < DRAG_START_THRESHOLD_PX) return;
        gesture.dragging = true;
      }
      setDragDelta(delta);
    }

    function onEnd(e) {
      const gesture = gestureRef.current;
      if (!gesture || (e && e.pointerId !== undefined && e.pointerId !== gesture.pointerId)) return;
      gestureRef.current = null;
      // A plain tap (never crossed the threshold) never touched dragDelta
      // -- nothing to resolve, and the click already reached its real
      // target normally, since we never captured anything.
      if (!gesture.dragging) return;
      const viewportWidth = viewportRef.current?.getBoundingClientRect().width || 1;
      // Swipe past 25% of the viewport's own width to advance a page --
      // short of that, snap back to where it already was.
      const threshold = viewportWidth * 0.25;
      const delta = gesture.lastDelta || 0;
      if (delta < -threshold) {
        setActiveIndex((i) => Math.min(i + 1, pages.length - 1));
      } else if (delta > threshold) {
        setActiveIndex((i) => Math.max(i - 1, 0));
      }
      setDragDelta(0);
    }

    // Cosmetic only, not a correctness/safety mechanism (unlike round
    // 4's blur handler, which existed to release a stuck capture -- there
    // is no capture left to release). Without this, a gesture abandoned
    // mid-drag by an alt-tab/dialog would leave the panel's CSS transform
    // visually offset until the next gesture happens to touch it again --
    // harmless (nothing is blocked), just a stray visual until then. This
    // just snaps it back immediately instead of leaving it stale.
    function onBlur() {
      if (!gestureRef.current) return;
      gestureRef.current = null;
      setDragDelta(0);
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
      window.removeEventListener('blur', onBlur);
    };
  }, [pages.length]);

  const onPointerDown = (e) => {
    // No preventDefault, no setPointerCapture -- just remember where this
    // pointer started. The window listeners above (always attached,
    // gated internally on gestureRef being non-null) do the rest. A
    // plain click's native mouseup/click generation is completely
    // untouched by any of this, on every browser, since we never call
    // the API that could interfere with it.
    gestureRef.current = { pointerId: e.pointerId, startX: e.clientX, dragging: false, lastDelta: 0 };
  };

  return (
    <div>
      {/* Doubles as the swipe-position indicator AND the click target --
          the same mechanism serves both mobile (swipe) and desktop
          (click) rather than two divergent implementations per
          breakpoint. */}
      <div className="swipe-pages-tabs">
        {pages.map((p, i) => (
          <button
            key={p.key}
            type="button"
            className={`swipe-pages-tab ${i === activeIndex ? 'active' : ''}`}
            onClick={() => setActiveIndex(i)}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div
        ref={viewportRef}
        className="swipe-pages-viewport"
        onPointerDown={onPointerDown}
      >
        <div
          className="swipe-pages-track"
          style={{
            transform: `translateX(calc(${-activeIndex * 100}% + ${dragDelta}px))`,
            transition: gestureRef.current?.dragging ? 'none' : 'transform 0.25s ease',
          }}
        >
          {pages.map((p) => (
            <div key={p.key} className="swipe-pages-page">
              {p.content}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
