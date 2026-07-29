'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

const MIN_PERCENT = 25;
const MAX_PERCENT = 75;

// The design's per-side reaction rail is a compact 4-icon subset of the
// full sticker set, floating over each contestant's own video -- distinct
// from the full sticker row + GO LOUD in the comments column.
const RAIL_STICKERS = [
  { key: 'heart', emoji: '❤', className: 'heart' },
  { key: 'fire', emoji: '🔥', className: 'fire' },
  { key: 'clap', emoji: '👏', className: 'clap' },
  { key: 'laugh', emoji: '😂', className: 'laugh' },
];

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

function ReactionRail({ side, onReact }) {
  if (!onReact) return null;
  return (
    <div className={`reaction-rail rail-${side}`}>
      {RAIL_STICKERS.map((s) => (
        <button
          key={s.key}
          className={`reaction-btn ${s.className}`}
          aria-label={s.key}
          onClick={() => onReact(s.key)}
        >
          {s.emoji}
        </button>
      ))}
    </div>
  );
}

// VersusSplit renders either solo (single panel, no divider) or versus
// (two panels with a drag-to-resize divider) depending on the `mode` prop.
// The divider itself is the drag handle. `interactive` gates the per-side
// reaction rails -- the broadcaster's own preview (BroadcastStage) never
// shows them, only the fan-facing versus view (ViewerStage) does.
export default function VersusSplit({ mode = 'versus', renderA, renderB, onReactA, onReactB, interactive = true }) {
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
        {interactive && <ReactionRail side="a" onReact={onReactA} />}
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
        {interactive && <ReactionRail side="b" onReact={onReactB} />}
      </div>
    </div>
  );
}
