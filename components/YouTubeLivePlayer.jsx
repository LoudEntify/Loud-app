'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { initHealthLog, logHealthEvent } from '../lib/healthLog';
import YouTubeInteractionPanel from './YouTubeInteractionPanel';

let apiPromise;
function loadYouTubeApi() {
  if (typeof window === 'undefined') return Promise.reject(new Error('YouTube player requires a browser'));
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (window.YT?.Player) resolve(window.YT);
      else reject(new Error('YouTube player API did not initialize'));
    };
    if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.async = true;
      script.onerror = () => reject(new Error('YouTube player API could not be loaded'));
      document.head.appendChild(script);
    }
    setTimeout(() => reject(new Error('YouTube player took too long to load')), 15_000);
  });
  return apiPromise;
}

const PLAYER_EVENTS = { '-1': 'unstarted', 0: 'ended', 1: 'playing', 2: 'paused', 3: 'buffering', 5: 'cued' };
function errorMessage(code) {
  if ([100, 101, 150].includes(code)) return 'This video is unavailable or cannot be played here.';
  if (code === 5) return 'Your browser could not play this video. Try opening it on YouTube.';
  return 'The YouTube player encountered an error.';
}

export default function YouTubeLivePlayer({ experience }) {
  const mountRef = useRef(null);
  const playerRef = useRef(null);
  const [phase, setPhase] = useState('loading');
  const [message, setMessage] = useState('Loading the official YouTube player…');

  useEffect(() => {
    if (!experience?.roomName) return;
    initHealthLog({ showId: experience.roomName, role: 'youtube-viewer' });
  }, [experience?.roomName]);

  useEffect(() => {
    let cancelled = false;
    if (!experience?.videoId || !mountRef.current) return undefined;
    setPhase('loading');
    setMessage(experience.status === 'WAITING' ? 'The broadcast is prepared. Waiting for the artist to go live…' : 'Loading the official YouTube player…');
    loadYouTubeApi().then((YT) => {
      if (cancelled || !mountRef.current) return;
      playerRef.current = new YT.Player(mountRef.current, {
        videoId: experience.videoId,
        width: '100%',
        height: '100%',
        playerVars: {
          autoplay: 0,
          controls: 1,
          fs: 1,
          playsinline: 1,
          enablejsapi: 1,
          origin: window.location.origin,
          rel: 0,
        },
        events: {
          onReady: () => {
            if (cancelled) return;
            setPhase('ready');
            setMessage('');
            logHealthEvent('youtube_player_ready', { broadcastStatus: experience.status });
          },
          onStateChange: (event) => {
            const state = PLAYER_EVENTS[event.data] || 'unknown';
            logHealthEvent('youtube_player_state', { state });
            if (state === 'ended') setPhase('ended');
          },
          onError: (event) => {
            if (cancelled) return;
            setPhase('error');
            setMessage(errorMessage(event.data));
            logHealthEvent('youtube_player_error', { code: Number(event.data) || null });
          },
        },
      });
    }).catch((error) => {
      if (cancelled) return;
      setPhase('error');
      setMessage(error.message || 'The YouTube player could not be loaded.');
      logHealthEvent('youtube_player_load_failed', {});
    });
    return () => {
      cancelled = true;
      try { playerRef.current?.destroy?.(); } catch { /* player already detached */ }
      playerRef.current = null;
    };
  }, [experience?.videoId, experience?.status]);

  const unavailable = !experience?.videoId;
  return (
    <section style={{ minHeight: '100vh', background: '#011627', color: '#fdfffc', padding: 'clamp(16px, 3vw, 36px)' }} aria-labelledby="youtube-show-title">
      <div style={{ width: 'min(1180px, 100%)', margin: '0 auto' }}>
        <header style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 18, marginBottom: 18, flexWrap: 'wrap' }}>
          <div>
            <span style={{ color: '#2ec4b6', fontSize: 12, fontWeight: 800, letterSpacing: '.14em' }}>LOUDENTIFY PRESENTS</span>
            <h1 id="youtube-show-title" style={{ margin: '8px 0 0', fontSize: 'clamp(25px, 4vw, 46px)', letterSpacing: '-.04em' }}>{experience?.title || 'Live show'}</h1>
          </div>
          <div style={{ color: '#9fb5c3', fontSize: 14 }}>{experience?.status === 'ENDED' || phase === 'ended' ? 'Broadcast ended' : experience?.status === 'LIVE' ? 'Live on YouTube' : 'YouTube broadcast'}</div>
        </header>

        <div style={{ position: 'relative', width: '100%', aspectRatio: '16 / 9', minHeight: 200, overflow: 'hidden', borderRadius: 16, background: '#000', border: '1px solid rgba(255,255,255,.12)', boxShadow: '0 28px 80px rgba(0,0,0,.38)' }}>
          {!unavailable && <div ref={mountRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />}
          {(unavailable || phase === 'loading' || phase === 'error') && (
            <div role={phase === 'error' || unavailable ? 'alert' : 'status'} aria-live="polite" style={{ position: 'absolute', inset: 0, zIndex: 2, display: 'grid', placeItems: 'center', padding: 28, textAlign: 'center', pointerEvents: 'none', background: unavailable || phase === 'error' ? 'radial-gradient(circle at 50% 35%, #15333d, #06131d 70%)' : 'linear-gradient(120deg, #07151d, #102a33)' }}>
              <div style={{ maxWidth: 480 }}>
                <div style={{ width: 38, height: 3, background: '#2ec4b6', margin: '0 auto 18px' }} />
                <p style={{ margin: 0, color: '#d9e6ea', fontSize: 16, lineHeight: 1.7 }}>{unavailable ? experience?.message || 'This broadcast is not available to watch.' : message}</p>
              </div>
            </div>
          )}
        </div>

        {!unavailable && <YouTubeInteractionPanel showId={experience.showId} roomName={experience.roomName} playbackPositionMs={() => Math.max(0, Math.round((playerRef.current?.getCurrentTime?.() || 0) * 1000))} />}

        <footer style={{ display: 'flex', justifyContent: 'space-between', gap: 18, alignItems: 'center', flexWrap: 'wrap', marginTop: 16, color: '#8ba4af', fontSize: 13, lineHeight: 1.6 }}>
          <span>Playback is provided by YouTube. YouTube controls, attribution and advertising remain available in the player.</span>
          <span><a href="https://www.youtube.com/t/terms" target="_blank" rel="noreferrer" style={{ color: '#8de1d5' }}>YouTube Terms</a> · <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer" style={{ color: '#8de1d5' }}>Google Privacy</a> · <Link href="/discover" style={{ color: '#8de1d5' }}>Discover</Link></span>
        </footer>
      </div>
    </section>
  );
}
