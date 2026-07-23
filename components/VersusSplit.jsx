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
// The divider itself is the drag handle now -- no separate slider control
// taking up page space below the video.
export default function VersusSplit({ mode = 'versus', renderA, renderB, onReactA, onReactB }) {
  const orientation = useOrientation();
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
        <div className="contestant-panel" style={{ flexBasis: '92%' }}>
          {renderA ? renderA() : 'performer'}
        </div>
        <div className="edge-rail">
          <button className="reaction-btn heart" style={{ width: 28, height: 28, fontSize: 14 }} onClick={() => onReactA && onReactA('heart')}>
            {'\u2764'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={stageRef}
      className={`versus-stage ${orientation}`}
      style={{ height: '260px', position: 'relative' }}
    >
      <div className="edge-rail">
        <button className="reaction-btn heart" style={{ width: 24, height: 24, fontSize: 12 }} onClick={() => onReactA && onReactA('heart')}>
          {'\u2764'}
        </button>
      </div>

      <div className="contestant-panel" style={{ flexBasis: `${split}%` }}>
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

      <div className="contestant-panel" style={{ flexBasis: `${100 - split}%` }}>
        {renderB ? renderB() : 'contestant b'}
      </div>

      <div className="edge-rail">
        <button className="reaction-btn clap" style={{ width: 24, height: 24, fontSize: 12 }} onClick={() => onReactB && onReactB('clap')}>
          {'\uD83D\uDC4F'}
        </button>
      </div>
    </div>
  );
}
