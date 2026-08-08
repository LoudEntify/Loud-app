'use client';

import { useRef, useState } from 'react';

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
// Pointer events (not touch-specific) for the drag, matching the same
// pattern VersusSplit's divider and BroadcastStage's own deck-resize
// divider already use elsewhere in this app -- one consistent gesture
// idiom, not a new one just for this.
export default function SwipePages({ pages }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [dragDelta, setDragDelta] = useState(0);
  const draggingRef = useRef(false);
  const dragStartXRef = useRef(0);
  const viewportRef = useRef(null);

  const onPointerDown = (e) => {
    draggingRef.current = true;
    dragStartXRef.current = e.clientX;
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e) => {
    if (!draggingRef.current) return;
    setDragDelta(e.clientX - dragStartXRef.current);
  };

  const endDrag = () => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    const viewportWidth = viewportRef.current?.getBoundingClientRect().width || 1;
    // Swipe past 25% of the viewport's own width to advance a page --
    // short of that, snap back to where it already was. Dragging past
    // the first/last page just has nowhere further to go (the track's
    // own width is exactly pages.length * 100%) -- a small harmless
    // overshoot at the edges, not a bug worth clamping for a 3-page set.
    const threshold = viewportWidth * 0.25;
    if (dragDelta < -threshold && activeIndex < pages.length - 1) {
      setActiveIndex((i) => i + 1);
    } else if (dragDelta > threshold && activeIndex > 0) {
      setActiveIndex((i) => i - 1);
    }
    setDragDelta(0);
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
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div
          className="swipe-pages-track"
          style={{
            transform: `translateX(calc(${-activeIndex * 100}% + ${dragDelta}px))`,
            transition: draggingRef.current ? 'none' : 'transform 0.25s ease',
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
