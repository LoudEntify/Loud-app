'use client';

import { useEffect, useState } from 'react';

const MIN_PERCENT = 25;
const MAX_PERCENT = 75;

function useOrientation() {
  const getOrientation = () => {
    if (typeof window === 'undefined') return 'landscape';
    // Only phones/tablets actually rotate — desktops/TVs stay landscape.
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
// (two panels with a user-draggable split) depending on the `mode` prop.
// Reaction rails on the outer edges are tagged to the specific contestant —
// wire onReactA / onReactB to LiveKit data messages tagged with contestant id.
export default function VersusSplit({ mode = 'versus', renderA, renderB, onReactA, onReactB }) {
  const orientation = useOrientation();
  const [split, setSplit] = useState(50);

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
    <div>
      <div className={`versus-stage ${orientation}`} style={{ height: '260px' }}>
        <div className="edge-rail">
          <button className="reaction-btn heart" style={{ width: 24, height: 24, fontSize: 12 }} onClick={() => onReactA && onReactA('heart')}>
            {'\u2764'}
          </button>
        </div>

        <div className="contestant-panel" style={{ flexBasis: `${split}%` }}>
          {renderA ? renderA() : 'contestant a'}
        </div>

        <div className="divider" />

        <div className="contestant-panel" style={{ flexBasis: `${100 - split}%` }}>
          {renderB ? renderB() : 'contestant b'}
        </div>

        <div className="edge-rail">
          <button className="reaction-btn clap" style={{ width: 24, height: 24, fontSize: 12 }} onClick={() => onReactB && onReactB('clap')}>
            {'\uD83D\uDC4F'}
          </button>
        </div>
      </div>

      {/* User-controlled slider - viewer's own preference, not driven by
          reaction counts. Same slider works for both orientations; only the
          stage's flex-direction changes above. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
        <span style={{ fontSize: 12, color: '#888780' }}>a</span>
        <input
          type="range"
          min={MIN_PERCENT}
          max={MAX_PERCENT}
          step={1}
          value={split}
          onChange={(e) => setSplit(Number(e.target.value))}
          aria-label="adjust split between contestants"
          style={{ flex: 1 }}
        />
        <span style={{ fontSize: 12, color: '#888780' }}>b</span>
      </div>
    </div>
  );
}
