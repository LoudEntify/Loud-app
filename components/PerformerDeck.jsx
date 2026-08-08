'use client';

import { useState } from 'react';
import AudioDeckPanel from './AudioDeckPanel';
import VideoDeckPanel from './VideoDeckPanel';

// Bottom-docked deck for the main performer only -- switches between Audio
// and Video control panels. Not shown to viewers or camera-feed devices.
// Styled with the app's own ink black / porcelain / teal palette rather
// than the DAW reference's blue, per the existing brand system.
//
// Build 3c -- fully transparent, floating directly on the video inside
// .stage-bottom-overlay (BroadcastStage.jsx) rather than a solid-filled
// panel; the border is a subtle teal glow line instead of a fill, and
// tab labels get the shared text halo (var(--text-halo), reactions.css)
// for legibility with nothing behind them. Previously used #3a3a37 and
// #888780 for the border/inactive-tab colors -- neither is in the
// 5-color brand palette (Ink/Porcelain/Teal/Red/Orange); replaced with
// translucent teal/porcelain instead.
export default function PerformerDeck({ audioNodes, audioContext, showEnded, showPhase, cameraCandidates, activeCameraIdentity, onPickCamera }) {
  const [tab, setTab] = useState('audio'); // 'audio' | 'video'

  return (
    <div style={{ background: 'transparent', borderTop: '1px solid rgba(46, 196, 182, 0.3)', borderRadius: '12px 12px 0 0', padding: 16 }}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 14 }}>
        <button
          onClick={() => setTab('audio')}
          style={{
            flex: 1, padding: '8px 0', background: 'none', color: tab === 'audio' ? '#2ec4b6' : 'rgba(253, 255, 252, 0.55)',
            borderBottom: tab === 'audio' ? '2px solid #2ec4b6' : '2px solid transparent', borderRadius: 0,
            textShadow: 'var(--text-halo)',
          }}
        >
          AUDIO
        </button>
        <button
          onClick={() => setTab('video')}
          style={{
            flex: 1, padding: '8px 0', background: 'none', color: tab === 'video' ? '#2ec4b6' : 'rgba(253, 255, 252, 0.55)',
            borderBottom: tab === 'video' ? '2px solid #2ec4b6' : '2px solid transparent', borderRadius: 0,
            textShadow: 'var(--text-halo)',
          }}
        >
          VIDEO
        </button>
      </div>

      {tab === 'audio' ? (
        <AudioDeckPanel nodes={audioNodes} audioContext={audioContext} showEnded={showEnded} showPhase={showPhase} />
      ) : (
        <VideoDeckPanel
          candidates={cameraCandidates}
          activeIdentity={activeCameraIdentity}
          onPick={onPickCamera}
        />
      )}
    </div>
  );
}
