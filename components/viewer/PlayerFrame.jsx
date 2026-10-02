'use client';
// components/viewer/PlayerFrame.jsx — the box the player lives in.
//
// The box is sized by lib/player/layout.js and NOTHING is ever placed over
// it (docs/CLAUDE.md §6). What is INSIDE the box before a player exists is
// ours: the poster, the cookie-consent card for the YouTube embed, the
// honest reconnecting/ended messages. Once a PlayerSource is mounted the
// box is the player.
//
// Exposes the current playback position through `apiRef` so votes,
// reactions, Support and metering can stamp it.
import { useEffect, useRef, useState } from 'react';
import { createPlayerSource } from '../../lib/player/PlayerSource';
import { loadConsent, onConsentChange, saveConsent } from '../../lib/consent';
import { Play } from './Icons';

export default function PlayerFrame({ show, rect, apiRef, onState, onError, autoplay = true, muted = false, showLive = true }) {
  const boxRef = useRef(null);
  const sourceRef = useRef(null);
  const [consent, setConsent] = useState(null);
  const [state, setState] = useState('loading');
  const [message, setMessage] = useState(null);
  const needsConsent = (show?.delivery || 'youtube') === 'youtube';

  useEffect(() => { setConsent(loadConsent()); return onConsentChange(setConsent); }, []);

  const allowed = !needsConsent || consent?.embed;
  const kind = show?.delivery || 'youtube';

  useEffect(() => {
    if (!show || !boxRef.current || !allowed || !showLive) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const src = await createPlayerSource(show);
        if (cancelled) return;
        sourceRef.current = src;
        await src.mount(boxRef.current, {
          autoplay,
          muted,
          onState: (s) => { setState(s); onState?.(s); },
          onError: (m) => { setMessage(m); onError?.(m); },
        });
        if (apiRef) apiRef.current = { positionMs: () => src.positionMs(), play: () => src.play(), pause: () => src.pause(), setVersusView: (v) => src.setVersusView?.(v), kind: src.kind };
      } catch (e) {
        setState('error'); setMessage(e.message); onError?.(e.message);
      }
    })();
    return () => {
      cancelled = true;
      sourceRef.current?.destroy?.();
      sourceRef.current = null;
      if (apiRef) apiRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show?.id, show?.delivery, show?.youtube_video_id, allowed, showLive]);

  useEffect(() => { sourceRef.current?.setVersusView?.(show?.versus_view); }, [show?.versus_view]);

  const style = {
    position: rect ? 'absolute' : 'relative', left: rect?.x, top: rect?.y, width: rect?.w ?? '100%', height: rect?.h ?? '100%',
    outline: '1px solid rgba(253,255,252,0.28)', background: 'var(--poster)', overflow: 'hidden', color: 'rgba(253,255,252,0.7)',
  };
  const centre = { position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 12, textAlign: 'center' };

  return (
    <div data-testid="player-frame" data-player-kind={kind} data-player-state={state} style={style} aria-label="Player" role="region">
      {/* the player mounts here */}
      <div ref={boxRef} style={{ position: 'absolute', inset: 0 }} />
      {!showLive && (
        <div style={centre}><Play size={40} /><div className="v-kicker">{show?.state === 'ended' ? 'The show has ended' : 'Not started yet'}</div></div>
      )}
      {showLive && needsConsent && !allowed && (
        <div style={centre} data-testid="embed-consent">
          <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--porcelain)' }}>The show plays in a YouTube player</div>
          <div style={{ fontSize: 14 }}>It sets YouTube's cookies. Allow it to watch. <a href="/privacy" style={{ textDecoration: 'underline' }}>Privacy</a></div>
          <button className="v-btn v-btn-teal" onClick={() => setConsent(saveConsent({ ...loadConsent(), embed: true }))}>Allow the player</button>
        </div>
      )}
      {showLive && allowed && (state === 'error' || state === 'offline') && (
        <div style={centre} role="status">
          <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--porcelain)' }}>{state === 'offline' ? 'Reconnecting' : "We couldn't load the picture"}</div>
          <div style={{ fontSize: 14 }}>{message || 'The show is still on. Hold tight.'}</div>
        </div>
      )}
      {showLive && allowed && state === 'loading' && (
        <div style={centre} aria-hidden="true"><Play size={40} /><div className="v-kicker">Loading the player</div></div>
      )}
    </div>
  );
}
