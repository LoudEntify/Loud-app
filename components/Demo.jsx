'use client';

import { useRef, useState } from 'react';
import ReactionBar, { GO_LOUD_THRESHOLD } from './ReactionBar';
import SuperReactionPanel from './SuperReactionPanel';
import ReactionStream, { GoLoudBurst } from './ReactionStream';
import VersusSplit from './VersusSplit';
import './reactions.css';

// This file is a local preview only — swap the placeholder divs in
// VersusSplit's renderA/renderB props for real <LiveKitRoom> video once
// the LiveKit connection is wired in. Nothing else here needs to change.
export default function Demo() {
  const [mode, setMode] = useState('versus');
  const [superVisible, setSuperVisible] = useState(false);
  const [goLoudKey, setGoLoudKey] = useState(null);
  const [goLoudCount, setGoLoudCount] = useState(0);
  const streamRef = useRef(null);

  const REACTION_EMOJI = {
    heart: '\u2764',
    fire: '\uD83D\uDD25',
    clap: '\uD83D\uDC4F',
    laugh: '\uD83D\uDE02',
    plusone: '+1',
    riff: '\uD83C\uDFB8',
    run: '\u2b06\ufe0f',
    rap: '\uD83C\uDFA4',
  };

  function handleReact(key) {
    if (streamRef.current) streamRef.current.push(REACTION_EMOJI[key] || key);
  }

  function handleGoLoud() {
    setGoLoudCount((prev) => {
      const next = prev + 1;
      if (next >= GO_LOUD_THRESHOLD) {
        setGoLoudKey(Date.now());
        return 0;
      }
      return next;
    });
  }

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', fontFamily: 'sans-serif' }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button onClick={() => setMode('solo')}>solo</button>
        <button onClick={() => setMode('versus')}>versus</button>
      </div>

      <div style={{ position: 'relative', height: 260 }}>
        <VersusSplit
          mode={mode}
          renderA={() => 'contestant a (placeholder video)'}
          renderB={() => 'contestant b (placeholder video)'}
          onReactA={handleReact}
          onReactB={handleReact}
        />
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          <ReactionStream streamRef={streamRef} />
          <GoLoudBurst triggerKey={goLoudKey} />
        </div>
      </div>

      <ReactionBar
        onReact={handleReact}
        onSuperToggle={() => setSuperVisible((v) => !v)}
        goLoudCount={goLoudCount}
        onGoLoud={handleGoLoud}
      />
      <SuperReactionPanel visible={superVisible} onReact={handleReact} />
    </div>
  );
}
