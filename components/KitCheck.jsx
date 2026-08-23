'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { CameraRotate, VideoCamera, VideoCameraSlash } from '@phosphor-icons/react';
import AudioDeckPanel from './AudioDeckPanel';
import EmptyState from './EmptyState';
import { createPilotAudioTrack } from '../lib/audioProcessing';
import { getSession, getProfile } from '../lib/supabaseAuth';
import { getSupabase } from '../lib/supabaseClient';
import { isWindowOpen, nextUpcomingShow, msUntilWindow, humanCountdown } from '../lib/scheduling';

const INK = '#011627';
const PORCELAIN = '#fdfffc';
const TEAL = '#2ec4b6';

// KIT CHECK -- the artist's whole rig, running locally, connected to
// nothing.
//
// THIS IS THE CAMERA-OWNERSHIP INVERSION, done where it matters. There
// is no LiveKitRoom on this page: the camera is acquired here by an
// explicit getUserMedia call, attached to an element we own, flipped and
// stopped by us, and released by us. No LiveKit token is minted, no
// room is joined, nothing is published. An artist can sit here tuning
// for an hour and it costs nothing, which is the entire point of the
// broadcast window (docs/BUILD_AUDIT_2026-08.md G.1).
//
// The audio graph is unchanged from the live path -- createPilotAudioTrack
// was always local-only (getUserMedia + Web Audio), which is why the
// same AudioDeckPanel works here with no LiveKit anywhere near it.
const COUNTDOWN_SECONDS = 60;

export default function KitCheck() {
  const router = useRouter();
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const audioHandleRef = useRef(null);

  const [camOn, setCamOn] = useState(false);
  const [facingMode, setFacingMode] = useState('user');
  const [camError, setCamError] = useState('');
  const [audioNodes, setAudioNodes] = useState(null);
  const [audioContext, setAudioContext] = useState(null);
  const [audioError, setAudioError] = useState('');

  const [session, setSession] = useState(null);
  const [artistEmail, setArtistEmail] = useState('');
  const [upcoming, setUpcoming] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const [countdown, setCountdown] = useState(null); // seconds remaining, or null

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // ── Explicit camera ownership ──────────────────────────────
  const stopCamera = useCallback(() => {
    const stream = streamRef.current;
    if (stream) {
      stream.getTracks().forEach((t) => t.stop()); // releases the device; the light goes out
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    setCamOn(false);
  }, []);

  const startCamera = useCallback(async (mode = facingMode) => {
    setCamError('');
    try {
      stopCamera();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: mode },
        audio: false, // audio comes through the processing graph, never raw here
      });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setCamOn(true);
    } catch (err) {
      setCamError(err?.name === 'NotAllowedError' ? 'Camera permission denied.' : 'Could not open the camera.');
      setCamOn(false);
    }
  }, [facingMode, stopCamera]);

  const flipCamera = useCallback(async () => {
    const next = facingMode === 'user' ? 'environment' : 'user';
    setFacingMode(next);
    if (camOn) await startCamera(next);
  }, [facingMode, camOn, startCamera]);

  // ── Local audio graph ──────────────────────────────────────
  const startAudio = useCallback(async () => {
    setAudioError('');
    try {
      const handle = await createPilotAudioTrack();
      audioHandleRef.current = handle;
      setAudioNodes(handle.nodes);
      setAudioContext(handle.audioContext);
    } catch {
      setAudioError('Could not open the microphone.');
    }
  }, []);

  const stopAudio = useCallback(() => {
    const handle = audioHandleRef.current;
    if (!handle) return;
    try {
      handle.rawStream?.getTracks?.().forEach((t) => t.stop());
      handle.processedTrack?.stop?.();
      handle.audioContext?.close?.();
    } catch {
      // release is best-effort; never throw out of teardown
    }
    audioHandleRef.current = null;
    setAudioNodes(null);
    setAudioContext(null);
  }, []);

  // Everything this page acquired, this page releases. No LiveKit
  // lifecycle is involved, so nothing else can be holding these.
  useEffect(() => () => {
    stopCamera();
    stopAudio();
  }, [stopCamera, stopAudio]);

  // ── Who am I, and when is my window? ───────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = await getSession();
      if (cancelled) return;
      setSession(s);
      if (!s?.user) return;
      setArtistEmail(s.user.email || '');
      const { profile } = await getProfile(s.user.id);
      if (!cancelled && profile?.display_name) { /* profile loaded; name unused here */ }
      const { data } = await getSupabase().from('shows').select('*').eq('artist_id', s.user.id);
      if (!cancelled) setUpcoming(nextUpcomingShow(data || []));
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Window opens while in Kit Check → countdown, then live ──
  useEffect(() => {
    if (!upcoming || countdown !== null) return;
    if (isWindowOpen(upcoming, now)) setCountdown(COUNTDOWN_SECONDS);
  }, [upcoming, now, countdown]);

  useEffect(() => {
    if (countdown === null) return undefined;
    if (countdown <= 0) {
      // Release BEFORE handing over: the live path acquires its own
      // camera, and two owners of one device is how you get a black
      // frame on stage.
      stopCamera();
      stopAudio();
      router.push(`/live?show=${upcoming?.id ?? ''}`);
      return undefined;
    }
    const id = setTimeout(() => setCountdown((c) => (c === null ? null : c - 1)), 1000);
    return () => clearTimeout(id);
  }, [countdown, router, upcoming, stopCamera, stopAudio]);

  if (session === null) {
    return <div style={{ padding: 40, fontSize: 12, color: 'rgba(1,22,39,0.4)' }}>Loading…</div>;
  }
  if (!session) {
    return (
      <div style={{ padding: 40 }}>
        <EmptyState title="Sign in to use Kit Check" body="Kit Check is part of your artist studio." action="LOG IN" actionHref="/auth" />
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: PORCELAIN, color: INK, padding: '28px 32px 60px', boxSizing: 'border-box' }}>
      <div style={{ maxWidth: 1080, margin: '0 auto' }}>

        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 10, letterSpacing: '0.14em', color: 'rgba(1,22,39,0.5)' }}>STUDIO</div>
            <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>Kit Check</div>
          </div>
          <Link href="/dashboard" style={{ fontSize: 11, letterSpacing: '0.08em', color: TEAL, textDecoration: 'none' }}>← BACK TO STUDIO</Link>
        </div>

        {/* The promise, stated plainly and where it can be checked. */}
        <div style={{ marginTop: 10, display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 10.5, letterSpacing: '0.06em', color: TEAL, border: `1px solid ${TEAL}`, borderRadius: 999, padding: '5px 12px' }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: TEAL }} />
          NOT CONNECTED — NOTHING IS BEING SENT
        </div>

        {upcoming && (
          <div style={{ marginTop: 12, fontSize: 11.5, color: 'rgba(1,22,39,0.55)' }}>
            Next show: <strong style={{ color: INK }}>{upcoming.title || 'Untitled show'}</strong>{' '}
            — window opens {humanCountdown(msUntilWindow(upcoming, now))}.
          </div>
        )}

        <div style={{ display: 'flex', gap: 20, marginTop: 22, flexWrap: 'wrap', alignItems: 'flex-start' }}>

          {/* ── Camera ──────────────────────────────────────── */}
          <div style={{ flex: '1 1 380px', minWidth: 300 }}>
            <div style={{ position: 'relative', width: '100%', aspectRatio: '9 / 16', maxHeight: 520, background: INK, overflow: 'hidden', clipPath: 'polygon(12px 0,100% 0,100% 100%,0 100%,0 12px)' }}>
              <video
                ref={videoRef}
                autoPlay
                muted
                playsInline
                style={{ width: '100%', height: '100%', objectFit: 'cover', transform: facingMode === 'user' ? 'scaleX(-1)' : 'none' }}
              />
              {!camOn && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(253,255,252,0.4)', fontSize: 12, letterSpacing: '0.08em' }}>
                  {camError || 'CAMERA OFF'}
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button
                type="button"
                onClick={() => (camOn ? stopCamera() : startCamera())}
                style={btn(camOn)}
              >
                {camOn ? <VideoCamera size={14} weight="bold" /> : <VideoCameraSlash size={14} weight="bold" />}
                {camOn ? 'CAMERA ON' : 'START CAMERA'}
              </button>
              <button type="button" onClick={flipCamera} disabled={!camOn} style={{ ...btn(false), opacity: camOn ? 1 : 0.4 }}>
                <CameraRotate size={14} weight="bold" />
                {facingMode === 'user' ? 'FRONT' : 'REAR'}
              </button>
            </div>
          </div>

          {/* ── Audio + cues ────────────────────────────────── */}
          <div style={{ flex: '1 1 380px', minWidth: 300 }}>
            {!audioNodes && (
              <div style={{ border: '1px solid rgba(1,22,39,0.12)', clipPath: 'polygon(12px 0,100% 0,100% 100%,0 100%,0 12px)', padding: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>Audio</div>
                <div style={{ fontSize: 12, color: 'rgba(1,22,39,0.5)', marginTop: 6, lineHeight: 1.5 }}>
                  Your full processing chain, backing track and cue editor — all running on this device only.
                </div>
                {audioError && <div style={{ fontSize: 12, color: '#e71d36', marginTop: 8 }}>{audioError}</div>}
                <button type="button" onClick={startAudio} style={{ ...btn(false), marginTop: 12 }}>START AUDIO</button>
              </div>
            )}

            {audioNodes && (
              <AudioDeckPanel
                nodes={audioNodes}
                audioContext={audioContext}
                showEnded={false}
                showPhase="soundcheck"
                artistEmail={artistEmail}
                artistAccessToken={session?.access_token}
              />
            )}
          </div>
        </div>
      </div>

      {/* ── Window-open countdown ─────────────────────────────
          Bold, half-opacity, unmissable but not blocking -- the artist
          can still see their own framing underneath it while it runs. */}
      {countdown !== null && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 50,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(1,22,39,0.5)',
            color: PORCELAIN,
            pointerEvents: 'none',
          }}
        >
          <div style={{ fontSize: 13, letterSpacing: '0.2em', opacity: 0.85 }}>YOUR WINDOW IS OPEN</div>
          <div style={{ fontSize: 120, fontWeight: 700, lineHeight: 1, marginTop: 8 }}>{countdown}</div>
          <div style={{ fontSize: 12, letterSpacing: '0.12em', opacity: 0.8, marginTop: 10 }}>GOING LIVE</div>
        </div>
      )}
    </div>
  );
}

function btn(active) {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: '11px 14px',
    fontSize: 10.5,
    fontWeight: 700,
    letterSpacing: '0.08em',
    color: active ? '#011627' : '#2ec4b6',
    background: active ? '#2ec4b6' : 'transparent',
    border: '1px solid #2ec4b6',
    cursor: 'pointer',
  };
}
