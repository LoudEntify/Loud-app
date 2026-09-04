'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

const MIN_PERCENT = 25;
const MAX_PERCENT = 75;

// ── ORIENTATION IS MEASURED, NOT INFERRED ─────────────────────
// This used to ask the POINTER: coarse pointer plus a portrait viewport
// meant "phone", anything else meant "desktop". That answers a question
// about the input device when the question is about the BOX.
//
// Foldables break it outright, and they are the case that made this
// necessary rather than tidier. A folded Z Fold is a narrow portrait
// phone; unfolded it is a wide near-square tablet. Same device, same
// coarse pointer, two different correct layouts — so pointer type gets
// one of the two states wrong every time, and it can change MID-SHOW
// while someone is performing.
//
// Measuring the stage element's own aspect ratio answers all of it with
// one mechanism: fold, unfold, tablet rotation, and a browser window
// being resized.
//
// ── WHY A ResizeObserver AND NOT window.resize ────────────────
// A window listener would happen to catch a fold, because folding
// changes the viewport. It cannot catch the case the window never sees:
// the STAGE's own box changing while the window does not — a panel
// collapsing, the deck expanding, the comments dock opening. The
// observer subsumes the window case and covers that one too.
const STACK_BELOW_ASPECT = 1;

function useStageOrientation(ref, forced) {
  // 'landscape' as the pre-measurement default, deliberately: it is what
  // a server render and the first paint assume, and a stage that starts
  // stacked and snaps sideways reads worse than one that starts side by
  // side and settles.
  const [orientation, setOrientation] = useState('landscape');

  useEffect(() => {
    if (forced) return undefined;
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;

    const measure = (width, height) => {
      if (!width || !height) return;
      // Taller than wide -> stack. Two portrait feeds side by side in a
      // narrow box are two slivers of a person; stacked they are two
      // usable frames. The inverse is just as true: two portrait feeds
      // stacked in a WIDE box each get a very short, very wide panel and
      // letterbox into a strip.
      setOrientation(width / height < STACK_BELOW_ASPECT ? 'portrait' : 'landscape');
    };

    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box) measure(box.width, box.height);
    });
    observer.observe(el);
    // Measured once immediately as well: ResizeObserver fires on observe
    // in every current engine, but relying on that leaves the first
    // paint's orientation depending on a behaviour nothing here
    // guarantees.
    const rect = el.getBoundingClientRect();
    measure(rect.width, rect.height);

    return () => observer.disconnect();
  }, [ref, forced]);

  return forced || orientation;
}

// VersusSplit renders either solo (single panel, no divider) or versus
// (two panels with a drag-to-resize divider) depending on the `mode` prop.
// The divider itself is the drag handle.
//
// `forceOrientation` bypasses useOrientation()'s pointer-based detection
// (which assumes a real device -- coarse pointer for portrait phones, fine
// pointer for desktop/landscape -- and so always resolves to 'landscape'
// in a headless/fine-pointer browser like LiveKit's Egress renderer,
// regardless of the actual canvas shape). Egress always records a known,
// fixed-aspect canvas (portrait 1080x1920 per app/api/egress/start/
// route.js's EncodingOptions), so it passes the correct orientation
// directly instead of relying on pointer-type inference. Real viewers
// (LiveDemo/RoomInner) don't pass this, so their existing pointer-based
// behavior is untouched.
// ── THE LIVE BORDER ───────────────────────────────────────────
// Teal, mildly neonised, drawn INSIDE the panel via an inset shadow
// rather than a border box — an outset border would change the panel's
// geometry and the whole point of this cue is that it never touches
// layout. Size belongs to the participant (they drag the split);
// emphasis belongs to the show. Two owners, two mechanisms, no
// collision.
//
// Identical in egress, never amplified. The moment the recording gets a
// heavier treatment than the live stage, prominence starts doing the job
// that size was forbidden from doing.
const LIVE_BORDER = 'inset 0 0 0 2px #2ec4b6, inset 0 0 14px rgba(46, 196, 182, 0.45)';
// Long enough not to strobe when someone taps mute twice in a second,
// short enough to still read as a response to the tap.
const LIVE_BORDER_TRANSITION = 'box-shadow 220ms ease';

export default function VersusSplit({
  mode = 'versus',
  renderA,
  renderB,
  forceOrientation,
  // Which slots have an open microphone. One, both, or neither — see
  // lib/micState.js for why this is rendered literally and never
  // arbitrated.
  liveSlots = null,
  // Replay and the recorder pass a number here. It pins the ratio AND
  // removes the drag handle: a recording has no viewer to adjust it, and
  // a replay viewer adjusting a layout that was already baked into the
  // file would be adjusting nothing.
  fixedSplit = null,
}) {
  const stageRef = useRef(null);
  const orientation = useStageOrientation(stageRef, forceOrientation);
  // ── THE SPLIT SURVIVES THE FLIP, BY CONSTRUCTION ──────────────
  // A PERCENTAGE SHARE, not an axis-specific value and not pixels. 60
  // means "slot A gets 60%" — of the height when stacked, of the width
  // when side by side. So a fold mid-show carries the ratio across
  // unchanged: same proportion, different axis.
  //
  // That is a property of storing a share rather than a measurement, and
  // it is why nothing here resets on an orientation change. If this ever
  // became a pixel offset, folding would reset the viewer to 50/50 and
  // they would notice instantly.
  const [split, setSplit] = useState(fixedSplit ?? 50);
  const draggingRef = useRef(false);

  const clampSplit = (v) => Math.min(MAX_PERCENT, Math.max(MIN_PERCENT, v));

  const updateFromPointer = useCallback((clientX, clientY) => {
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    let pct;
    if (orientation === 'portrait') {
      pct = ((clientY - rect.top) / rect.height) * 100;
    } else {
      pct = ((clientX - rect.left) / rect.width) * 100;
    }
    setSplit(clampSplit(pct));
  }, [orientation]);

  const onPointerDown = (e) => {
    draggingRef.current = true;
    e.target.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e) => {
    if (!draggingRef.current) return;
    updateFromPointer(e.clientX, e.clientY);
  };
  const onPointerUp = () => {
    draggingRef.current = false;
  };

  if (mode === 'solo') {
    return (
      <div className={`versus-stage ${orientation}`}>
        <div className="contestant-panel slot-a solo">
          {renderA ? renderA() : 'performer'}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={stageRef}
      className={`versus-stage ${orientation}`}
    >
      <div
        className="contestant-panel slot-a"
        style={{
          flexBasis: `${fixedSplit ?? split}%`,
          boxShadow: liveSlots?.a ? LIVE_BORDER : 'none',
          transition: LIVE_BORDER_TRANSITION,
        }}
      >
        {renderA ? renderA() : 'contestant a'}
      </div>

      {/* A pinned split has no drag handle: the recorder has no viewer,
          and a replay viewer would be dragging a ratio already baked
          into the file. Rendered as a plain divider so the two panels
          still read as two panels. */}
      {fixedSplit != null ? (
        <div className="divider" aria-hidden="true" />
      ) : (
      <div
        className="divider drag-divider"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        role="slider"
        aria-label="adjust split between contestants"
        aria-valuemin={MIN_PERCENT}
        aria-valuemax={MAX_PERCENT}
        aria-valuenow={Math.round(split)}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') setSplit((s) => clampSplit(s - 2));
          if (e.key === 'ArrowRight' || e.key === 'ArrowDown') setSplit((s) => clampSplit(s + 2));
        }}
      >
        <div className={`drag-handle ${orientation}`}>
          <span className="drag-dot" />
          <span className="drag-dot" />
          <span className="drag-dot" />
        </div>
      </div>
      )}

      <div
        className="contestant-panel slot-b"
        style={{
          flexBasis: `${100 - (fixedSplit ?? split)}%`,
          boxShadow: liveSlots?.b ? LIVE_BORDER : 'none',
          transition: LIVE_BORDER_TRANSITION,
        }}
      >
        {renderB ? renderB() : 'contestant b'}
      </div>
    </div>
  );
}
