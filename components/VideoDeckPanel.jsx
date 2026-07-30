'use client';

import { useState, useEffect, useRef } from 'react';
import { VideoTrack } from '@livekit/components-react';

const AUTO_ROTATE_INTERVAL_MS = 8000;

// Video deck: toggle between Manual (performer picks the live camera, same
// as the existing director panel) and Auto. Auto here is a simple,
// honest round-robin timer that cycles through connected cameras -- this
// is the placeholder auto-switching already scoped in the original build
// guide, NOT the emotion/staccato-aware AI auto-director from the PRD,
// which stays explicitly deferred (Won't now / Future Roadmap). Flagging
// that distinction directly in the UI copy below so it isn't overstated.
export default function VideoDeckPanel({ candidates, activeIdentity, onPick }) {
  const [mode, setMode] = useState('manual'); // 'manual' | 'auto'
  const rotateIndexRef = useRef(0);

  useEffect(() => {
    if (mode !== 'auto' || candidates.length <= 1) return;
    const timer = setInterval(() => {
      rotateIndexRef.current = (rotateIndexRef.current + 1) % candidates.length;
      onPick(candidates[rotateIndexRef.current].participant.identity);
    }, AUTO_ROTATE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [mode, candidates, onPick]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          className={mode === 'manual' ? 'btn-active' : ''}
          onClick={() => setMode('manual')}
          style={{ background: '#2C2C2A', color: '#fdfffc', padding: '6px 16px', fontSize: 12 }}
        >
          Manual
        </button>
        <button
          className={mode === 'auto' ? 'btn-active' : ''}
          onClick={() => setMode('auto')}
          style={{ background: '#2C2C2A', color: '#fdfffc', padding: '6px 16px', fontSize: 12 }}
        >
          Auto
        </button>
      </div>

      {candidates.length <= 1 ? (
        <p style={{ fontSize: 12, color: '#888780' }}>Only one camera connected -- add extra cameras to switch between shots.</p>
      ) : mode === 'manual' ? (
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto' }}>
          {candidates.map((t) => {
            const isActive = t.participant.identity === activeIdentity;
            return (
              <button
                key={t.participant.identity}
                onClick={() => onPick(t.participant.identity)}
                className={isActive ? 'btn-active' : ''}
                style={{ width: 72, height: 54, borderRadius: 8, overflow: 'hidden', padding: 0, background: '#2C2C2A', flexShrink: 0 }}
              >
                <VideoTrack trackRef={t} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              </button>
            );
          })}
        </div>
      ) : (
        <p style={{ fontSize: 12, color: '#888780' }}>
          Rotating between {candidates.length} cameras every {AUTO_ROTATE_INTERVAL_MS / 1000}s. This is a simple
          timed rotation, not an AI-directed cut -- switch to Manual any time to take direct control.
        </p>
      )}
    </div>
  );
}
