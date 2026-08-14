'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

const MIN_PERCENT = 25;
const MAX_PERCENT = 75;

function useOrientation() {
  const getOrientation = () => {
    if (typeof window === 'undefined') return 'landscape';
    const isCoarsePointer = window.matchMedia('(pointer: coarse)').matches;
    if (!isCoarsePointer) return 'landscape';
    return window.matchMedia('(orientation: portrait)').matches
      ? 'portrait'
      : 'landscape';
  };

  const [orientation, setOrientation] = useState(getOrientation);

  useEffect(() => {
    const update = () => setOrientation(getOrientation());
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  return orientation;
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
export default function VersusSplit({ mode = 'versus', renderA, renderB, forceOrientation }) {
  const detectedOrientation = useOrientation();
  const orientation = forceOrientation || detectedOrientation;
  const [split, setSplit] = useState(50);
  const stageRef = useRef(null);
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
      <div className="contestant-panel slot-a" style={{ flexBasis: `${split}%` }}>
        {renderA ? renderA() : 'contestant a'}
      </div>

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

      <div className="contestant-panel slot-b" style={{ flexBasis: `${100 - split}%` }}>
        {renderB ? renderB() : 'contestant b'}
      </div>
    </div>
  );
}
