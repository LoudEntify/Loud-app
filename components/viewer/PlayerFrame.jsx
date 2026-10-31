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
import { soundPolicy, watchdogStep, GIVE_UP_MESSAGE } from '../../lib/player/continuity';
import { Play } from './Icons';

/** How often the watchdog looks at the player. Often enough to catch a stall, rare enough to cost nothing. */
const WATCH_MS = 2000;

export default function PlayerFrame({ show, rect, apiRef, onState, onError, autoplay = true, muted = false, showLive = true }) {
  const boxRef = useRef(null);
  const sourceRef = useRef(null);
  const [consent, setConsent] = useState(null);
  const [state, setState] = useState('loading');
  const [message, setMessage] = useState(null);
  // Sound waiting on a touch, and the watchdog having given up: the only two
  // things a viewer is ever told about playback, and neither blocks the picture.
  const [needsTouchForSound, setNeedsTouchForSound] = useState(false);
  const [gaveUp, setGaveUp] = useState(false);
  const watchRef = useRef({});
  const userPausedRef = useRef(false);
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
        // The picture starts muted, always: a muted autoplay is allowed
        // everywhere, so nothing about sound can delay the show appearing.
        const policy = soundPolicy({
          hasUserActivation: typeof navigator !== 'undefined' ? Boolean(navigator.userActivation?.hasBeenActive) : false,
          prefersMuted: muted,
        });
        await src.mount(boxRef.current, {
          autoplay,
          muted: policy.startMuted,
          onState: (s) => {
            // A pause the player reports right after we asked for one is the
            // viewer's; anything else is the browser's and the watchdog's to undo.
            setState(s); onState?.(s);
          },
          onError: (m) => { setMessage(m); onError?.(m); },
        });
        if (apiRef) {
          apiRef.current = {
            positionMs: () => src.positionMs(),
            play: () => { userPausedRef.current = false; src.play(); },
            pause: () => { userPausedRef.current = true; src.pause(); },
            setVersusView: (v) => src.setVersusView?.(v),
            kind: src.kind,
          };
        }
        // Sound, as soon as there is a picture. The browser refuses this
        // silently when no gesture has happened, so we ask the player
        // afterwards whether it worked rather than assuming it did.
        if (policy.unmuteNow && src.unmute) {
          setTimeout(() => {
            if (cancelled) return;
            src.unmute();
            setTimeout(() => { if (!cancelled) setNeedsTouchForSound(src.muted?.() ?? false); }, 300);
          }, 400);
        }
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

  // The first touch anywhere turns the sound on, when the browser made us wait
  // for one. One listener, removed the moment it has done its job.
  useEffect(() => {
    if (!needsTouchForSound) return undefined;
    const turnOn = () => {
      const src = sourceRef.current;
      src?.unmute?.();
      if (!src?.muted?.()) setNeedsTouchForSound(false);
    };
    window.addEventListener('pointerdown', turnOn, { passive: true });
    window.addEventListener('keydown', turnOn);
    return () => { window.removeEventListener('pointerdown', turnOn); window.removeEventListener('keydown', turnOn); };
  }, [needsTouchForSound]);

  // The watchdog: a stall, a pause nobody asked for, a tab coming back, a
  // viewer drifting behind live. It acts; it never asks (lib/player/continuity.js).
  useEffect(() => {
    if (!allowed || !showLive) return undefined;
    const tick = () => {
      const src = sourceRef.current;
      if (!src) return;
      const sample = {
        state,
        positionMs: src.positionMs?.() ?? null,
        liveEdgeMs: src.liveEdgeMs?.() ?? null,
        atMs: Date.now(),
        visible: typeof document === 'undefined' ? true : document.visibilityState !== 'hidden',
        userPaused: userPausedRef.current,
      };
      const { action, memory } = watchdogStep(sample, watchRef.current);
      watchRef.current = memory;
      if (action === 'play') src.play?.();
      else if (action === 'seekLive') { if (src.seekToLive) src.seekToLive(); else src.play?.(); }
      else if (action === 'reload') {
        if (memory.gaveUp) { setGaveUp(true); return; }
        // Remount by bouncing the source: the effect above rebuilds it.
        src.destroy?.(); sourceRef.current = null;
        setState('loading');
      }
    };
    const timer = setInterval(tick, WATCH_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') tick(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [allowed, showLive, state]);

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
      {showLive && allowed && needsTouchForSound && (
        <button
          type="button"
          onClick={() => { sourceRef.current?.unmute?.(); if (!sourceRef.current?.muted?.()) setNeedsTouchForSound(false); }}
          data-testid="tap-for-sound"
          style={{ position: 'absolute', left: 10, bottom: 10, padding: '6px 12px', borderRadius: 999, border: 'none', background: 'rgba(1,22,39,0.72)', color: 'var(--porcelain)', fontSize: 13, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' }}
        >
          Tap for sound
        </button>
      )}
      {showLive && allowed && gaveUp && (
        <div style={{ position: 'absolute', left: 10, right: 10, bottom: 10, padding: '8px 12px', borderRadius: 12, background: 'rgba(1,22,39,0.82)', color: 'var(--porcelain)', fontSize: 13 }} role="status">{GIVE_UP_MESSAGE}</div>
      )}
      {showLive && allowed && state === 'loading' && (
        <div style={centre} aria-hidden="true"><Play size={40} /><div className="v-kicker">Loading the player</div></div>
      )}
    </div>
  );
}
