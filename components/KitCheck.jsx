'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { CameraRotate, VideoCamera, VideoCameraSlash } from '@phosphor-icons/react';
import AudioDeckPanel from './AudioDeckPanel';
import EmptyState from './EmptyState';
import PairingPanel from './PairingPanel';
import RehearsalRoom from './RehearsalRoom';
import { createPilotAudioTrack } from '../lib/audioProcessing';
import { getSession, getProfile } from '../lib/supabaseAuth';
import { getSupabase } from '../lib/supabaseClient';
import { isWindowOpen, nextUpcomingShow, msUntilWindow, humanCountdown } from '../lib/scheduling';

const INK = '#011627';
const PORCELAIN = '#fdfffc';
const TEAL = '#2ec4b6';

// KIT CHECK -- the artist's whole rig, running locally.
//
// THIS IS THE CAMERA-OWNERSHIP INVERSION, done where it matters. The
// camera is acquired here by an explicit getUserMedia call, attached to
// an element we own, flipped and stopped by us, and released by us. No
// LiveKit token is minted, no room is joined, nothing is published. An
// artist can sit here tuning for an hour and it costs nothing, which is
// the entire point of the broadcast window (BUILD_AUDIT_2026-08.md G.1).
//
// ⚠️ ONE EXCEPTION, and it is opt-in: ADD CAMERA. Pairing a second
// device and seeing the composed view genuinely requires moving video
// between two machines, which cannot be done without a transport. That
// path mounts components/RehearsalRoom.jsx, which DOES connect -- to a
// capped rehearsal room, never the show room. The badge at the top of
// this page changes the moment it does, because the value of this page
// is the artist knowing what state they are in.
//
// This comment previously claimed there was no LiveKitRoom on this page.
// That stopped being true when Add Camera landed, so it says so.
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
  // `countdown` is derived from the clock further down, not stored --
  // this only records that the handover has already fired, so a second
  // tick can't push the same route twice.
  const [handingOver, setHandingOver] = useState(false);

  // ── Add Camera (the documented LiveKit exception) ──────────
  //
  // Now a RIG, not a camera. `rehearsal` is the artist's own seat in the
  // rehearsal room; `pairings` is every camera they have invited into it.
  // The two used to be one object, which is precisely why only one phone
  // could ever be paired: the state shape said "there is at most one".
  const [rehearsal, setRehearsal] = useState(null); // artist's rehearsal session, or null
  const [pairings, setPairings] = useState([]);     // camera invitations / paired devices
  const [connectedRoles, setConnectedRoles] = useState([]);
  const [pairDegraded, setPairDegraded] = useState(false);
  const [pairBusy, setPairBusy] = useState(false);
  const [pairError, setPairError] = useState('');

  // addCamera moved BELOW stopCamera (it calls it) -- see the crash
  // post-mortem in DECISIONS.md §17. It was safe here only because a
  // click handler never runs during render; that is one refactor away
  // from being the same temporal-dead-zone crash that took the live
  // page down, and the file shouldn't rely on that distinction holding.

  const handleConnectedRoles = useCallback((roles) => setConnectedRoles(roles), []);

  function endRehearsal() {
    setRehearsal(null);
    setConnectedRoles([]);
    // The pairing rows deliberately SURVIVE ending a rehearsal. A code
    // that stops working because the artist closed the composed view
    // would be a trap: the phones are still propped, still paired, and
    // will follow into the show. Revoking is an explicit act (REMOVE),
    // not a side effect of tidying the screen.
  }

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

  const pairFetch = useCallback(async (payload) => {
    const res = await fetch('/api/camfeed/pair', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok, body };
  }, [session]);

  // Add ONE camera, in a named role. Called once per camera, which is
  // the whole difference from the old single-shot version: the rehearsal
  // room is opened on the first call and reused by every call after it,
  // so cameras accumulate instead of replacing each other.
  async function addCamera(role) {
    setPairError('');
    setPairBusy(true);
    try {
      let current = rehearsal;
      if (!current) {
        const { ok, body } = await pairFetch({ action: 'start' });
        if (!ok) { setPairError(body.error || 'Could not open the rehearsal room.'); return; }
        // Hand the camera over BEFORE connecting: Kit Check owns it
        // locally, the rehearsal room needs to publish it, and two owners
        // of one device produces a black tile.
        stopCamera();
        current = body;
        setRehearsal(body);
        setPairDegraded(!!body.degraded);
      }

      const { ok, body } = await pairFetch({
        action: 'invite',
        role,
        slot: 'a',
        context: 'rehearsal',
        show_id: upcoming?.id || null,
      });
      if (!ok) { setPairError(body.error || 'Could not create a pairing code.'); return; }
      if (body.degraded) setPairDegraded(true);
      setPairings((prev) => [...prev.filter((p) => p.id !== body.pairing.id), body.pairing]);
    } catch {
      setPairError('Could not reach the pairing service.');
    } finally {
      setPairBusy(false);
    }
  }

  async function removeCamera(id) {
    setPairings((prev) => prev.filter((p) => p.id !== id));
    try {
      await pairFetch({ action: 'revoke', id });
    } catch {
      // The card is already gone from the artist's screen; a failed
      // revoke leaves a row that expires on its own. Never worth an
      // error message about a camera they have already dismissed.
    }
  }

  // Reload the rig on mount. An artist who paired three phones, wandered
  // off to check the door and came back to a reloaded tab should find
  // their cameras still listed rather than an empty panel implying they
  // have to start again.
  useEffect(() => {
    if (!session?.access_token) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/camfeed/pair', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ action: 'list' }),
        });
        const body = await res.json().catch(() => ({}));
        if (cancelled || !res.ok) return;
        setPairDegraded(!!body.degraded);
        if (Array.isArray(body.pairings) && body.pairings.length) setPairings(body.pairings);
      } catch {
        // A failed list is a cosmetic loss — pairing still works.
      }
    })();
    return () => { cancelled = true; };
  }, [session]);

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

  // ── The last minute before SHOWTIME → countdown, then live ──
  //
  // THIS COUNTED DOWN TO THE WRONG MOMENT. It was keyed to the broadcast
  // window opening -- which is T-30min -- so a show scheduled five
  // minutes out had an already-open window the instant Kit Check
  // loaded, the 60 seconds started immediately, and the artist was
  // thrown on stage roughly four minutes before their own showtime. Not
  // a timezone problem and not a wrong constant: the trigger was reading
  // `windowOpensAt`, and what it wanted was `slated_at`.
  //
  // Now: derived from the clock every tick rather than stored and
  // decremented, so it can't drift, and so opening Kit Check at T-20s
  // shows twenty seconds rather than a fresh sixty. Still gated on the
  // window being open -- that rule is about cost and hasn't changed --
  // but the window merely PERMITS this; showtime is what triggers it.
  //
  // The knock-on is the good kind: the artist now gets the full ~29
  // minutes of the window in Kit Check instead of being yanked out of it
  // the moment the window opened.
  const secondsToShowtime = upcoming?.slated_at
    ? Math.ceil((new Date(upcoming.slated_at).getTime() - now) / 1000)
    : null;

  const countdownVisible =
    !!upcoming?.id &&
    isWindowOpen(upcoming, now) &&
    secondsToShowtime !== null &&
    secondsToShowtime <= COUNTDOWN_SECONDS;

  // Clamped at zero so a late arrival (Kit Check opened after showtime,
  // window still open) reads 0 and hands over immediately rather than
  // rendering a negative number.
  const countdown = countdownVisible ? Math.max(0, secondsToShowtime) : null;

  useEffect(() => {
    if (!countdownVisible || handingOver) return;
    if (secondsToShowtime > 0) return;
    setHandingOver(true);

    // Release BEFORE handing over: the live path acquires its own
    // camera, and two owners of one device is how you get a black
    // frame on stage.
    stopCamera();
    stopAudio();

    // ── PHASE 0b: THE RIG COMES TOO ────────────────────────────
    // This is the whole reason Kit Check exists: position once, go live
    // with everything already in place. The rehearsal room and the show
    // room are different LiveKit rooms, so "everything" has to include
    // the phones — and a phone cannot follow a room it was told about
    // once, at redeem time.
    //
    // So it doesn't. Each paired phone polls its own pairing row for the
    // room it should currently be in. This call rewrites that column to
    // the show's room and bumps a generation counter; every propped
    // phone sees the change on its next poll (~4s) and reconnects itself
    // to the show room with a fresh token. Nobody walks across the room.
    //
    // Fire-and-forget with a hard 2.5s ceiling. The artist's own handover
    // is the thing that must not be late — a camera arriving four seconds
    // into a show is a shrug; an artist arriving four seconds late is the
    // show starting without them. If the migrate call is slow or fails,
    // the phones simply stay in the rehearsal room and can be re-paired
    // from the live screen, which is the pre-tonight behaviour.
    const go = () => router.push(`/live?show=${upcoming.id}`);
    const token = session?.access_token;
    if (!token) { go(); return; }

    let done = false;
    const guard = setTimeout(() => { if (!done) { done = true; go(); } }, 2500);
    fetch('/api/camfeed/pair', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: 'migrate', show_id: upcoming.id }),
    })
      .catch(() => {})
      .finally(() => {
        if (done) return;
        done = true;
        clearTimeout(guard);
        go();
      });
  }, [countdownVisible, secondsToShowtime, handingOver, router, upcoming, stopCamera, stopAudio, session]);

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
        {/* This badge is a promise, so it has to track reality. The
            moment a rehearsal room is up, it stops claiming otherwise. */}
        {rehearsal ? (
          <div style={{ marginTop: 10, display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 10.5, letterSpacing: '0.06em', color: '#ff9f1c', border: '1px solid #ff9f1c', borderRadius: 999, padding: '5px 12px' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#ff9f1c' }} />
            REHEARSAL ROOM OPEN — CONNECTED
          </div>
        ) : (
          <div style={{ marginTop: 10, display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 10.5, letterSpacing: '0.06em', color: TEAL, border: `1px solid ${TEAL}`, borderRadius: 999, padding: '5px 12px' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: TEAL }} />
            NOT CONNECTED — NOTHING IS BEING SENT
          </div>
        )}

        {upcoming && (
          <div style={{ marginTop: 12, fontSize: 11.5, color: 'rgba(1,22,39,0.55)' }}>
            Next show: <strong style={{ color: INK }}>{upcoming.title || 'Untitled show'}</strong>{' '}
            {isWindowOpen(upcoming, now) ? (
              <>
                — window is open. You&apos;re on at{' '}
                <strong style={{ color: INK }}>
                  {new Date(upcoming.slated_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                </strong>
                , and this page hands you over 60 seconds before that.
              </>
            ) : (
              <>— window opens {humanCountdown(msUntilWindow(upcoming, now))}.</>
            )}
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

            {/* ── ADD CAMERA ──────────────────────────────────
                The one thing in Kit Check that connects. Opt-in, bounded
                and labelled, because the whole value of this page is the
                artist knowing they are costing nothing -- and a feature
                that quietly broke that would poison the rest of it. */}
            <div style={{ marginTop: 16, border: '1px solid rgba(1,22,39,0.12)', clipPath: 'polygon(10px 0,100% 0,100% 100%,0 100%,0 10px)', padding: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>Your cameras</div>
              <div style={{ fontSize: 11.5, color: 'rgba(1,22,39,0.55)', marginTop: 6, lineHeight: 1.55 }}>
                Prop a phone for each angle you want. Scan the code with it, or tap the link, or type the six
                characters — whichever is easiest with the phone in your hand. Moving video between devices
                needs a connection, so this is the <strong>one part of Kit Check that goes online</strong> —
                a rehearsal room, capped at 20 minutes, separate from your show.
              </div>

              <div style={{ marginTop: 12 }}>
                <PairingPanel
                  pairings={pairings}
                  connectedRoles={connectedRoles}
                  onAdd={addCamera}
                  onRevoke={removeCamera}
                  busy={pairBusy}
                  error={pairError}
                  tone="light"
                  degraded={pairDegraded}
                />
              </div>
            </div>
          </div>

          {/* ── Composed view / audio + cues ────────────────── */}
          <div style={{ flex: '1 1 380px', minWidth: 300 }}>
            {rehearsal && (
              <div style={{ marginBottom: 18 }}>
                <RehearsalRoom session={rehearsal} onEnd={endRehearsal} onConnectedRoles={handleConnectedRoles} />
              </div>
            )}
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
          {/* Says what it's counting to. "YOUR WINDOW IS OPEN" was
              accurate about the old (wrong) trigger and would now be a
              lie about the new one -- the window opened half an hour
              ago; what's about to happen is showtime. */}
          <div style={{ fontSize: 13, letterSpacing: '0.2em', opacity: 0.85 }}>YOU&apos;RE ON IN</div>
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
