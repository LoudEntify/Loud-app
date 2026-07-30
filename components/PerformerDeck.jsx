'use client';

import { useState } from 'react';
import AudioDeckPanel from './AudioDeckPanel';
import VideoDeckPanel from './VideoDeckPanel';

// Bottom-docked deck for the main performer only -- switches between Audio
// and Video control panels. Not shown to viewers or camera-feed devices.
// Styled with the app's own ink black / porcelain / teal palette rather
// than the DAW reference's blue, per the existing brand system.
export default function PerformerDeck({ audioNodes, audioContext, cameraCandidates, activeCameraIdentity, onPickCamera }) {
  const [tab, setTab] = useState('audio'); // 'audio' | 'video'

  return (
    <div style={{ background: '#011627', borderTop: '1px solid #3a3a37', borderRadius: '12px 12px 0 0', padding: 16 }}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 14 }}>
        <button
          onClick={() => setTab('audio')}
          style={{
            flex: 1, padding: '8px 0', background: 'none', color: tab === 'audio' ? '#2ec4b6' : '#888780',
            borderBottom: tab === 'audio' ? '2px solid #2ec4b6' : '2px solid transparent', borderRadius: 0,
          }}
        >
          AUDIO
        </button>
        <button
          onClick={() => setTab('video')}
          style={{
            flex: 1, padding: '8px 0', background: 'none', color: tab === 'video' ? '#2ec4b6' : '#888780',
            borderBottom: tab === 'video' ? '2px solid #2ec4b6' : '2px solid transparent', borderRadius: 0,
          }}
        >
          VIDEO
        </button>
      </div>

      {tab === 'audio' ? (
        <AudioDeckPanel nodes={audioNodes} audioContext={audioContext} />
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
