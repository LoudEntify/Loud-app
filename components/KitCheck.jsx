'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { CameraRotate, VideoCamera, VideoCameraSlash } from '@phosphor-icons/react';
import AudioDeckPanel from './AudioDeckPanel';
import EmptyState from './EmptyState';
import PairingPanel from './PairingPanel';
import RehearsalRoom from './RehearsalRoom';
// No releaseAudioHost import, deliberately — see the note above stopCamera's
// cleanup. Kit Check adopts and reads the host; it never tears it down.
import { adoptAudioGraph, audioHostActive, getAudioHost } from '../lib/audioHost';
import { createPilotAudioTrack } from '../lib/audioProcessing';
import { getSession, getProfile } from '../lib/supabaseAuth';
import { initHealthLog } from '../lib/healthLog';
import { getSupabase } from '../lib/supabaseClient';
import { isWindowOpen, nextUpcomingShow, msUntilWindow, humanCountdown, canHandOverNow, handoverState } from '../lib/scheduling';

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
// How long the handover waits for the camera migration before going to
// the stage regardless. See handOverToShow.
const HANDOVER_MIGRATE_CEILING_MS = 2500;

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
  const [showLoadError, setShowLoadError] = useState('');
  const [handoverError, setHandoverError] = useState('');
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
      // The rehearsal room is opened once, on the first camera, and
      // reused by every one after it. That reuse is the whole difference
      // from the old single-shot version.
      if (!rehearsal) {
        const { ok, body } = await pairFetch({ action: 'start' });
        if (!ok) { setPairError(body.error || 'Could not open the rehearsal room.'); return; }
        // Hand the camera over BEFORE connecting: Kit Check owns it
        // locally, the rehearsal room needs to publish it, and two owners
        // of one device produces a black tile.
        stopCamera();
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
      // Reuse a graph the host is already holding rather than opening a
      // second microphone. Walking back into Kit Check from a show must
      // not stack two audio chains on one device.
      if (audioHostActive()) {
        const existing = getAudioHost();
        audioHandleRef.current = existing;
        setAudioNodes(existing.nodes);
        setAudioContext(existing.audioContext);
        return;
      }
      const handle = await createPilotAudioTrack();
      // TASK 2 — the host owns this now, not this component.
      adoptAudioGraph(handle);
      audioHandleRef.current = handle;
      setAudioNodes(handle.nodes);
      setAudioContext(handle.audioContext);
    } catch {
      setAudioError('Could not open the microphone.');
    }
  }, []);

  // ── ⚠️ KIT CHECK NO LONGER RELEASES THE AUDIO HOST. AT ALL. ───
  //
  // There used to be a `stopAudio()` here that called
  // releaseAudioHost('kit-check-stop'), and handOverToShow called it one
  // line before router.push. That was the whole of the round-1 Test 2
  // failure: releaseAudioHost stops the player, closes the AudioContext
  // and nulls trackHash/trackName (lib/audioHost.js), so the handover
  // destroyed the loaded backing track at the exact moment it was
  // supposed to carry it into the show. Both triggers failed identically
  // because the manual button and the countdown are one function.
  //
  // The first fix — moving the release out of the UNMOUNT cleanup — was
  // right and insufficient: it left an explicit call on the handover
  // path, sitting under a comment about the CAMERA that happened to be
  // true of cameras and false of audio.
  //
  // So the helper is gone rather than merely uncalled, and
  // releaseAudioHost is no longer imported by this file. Kit Check
  // cannot release the host even by accident, which is a stronger
  // guarantee than a comment asking it not to. Release now belongs
  // exclusively to the live path, on the two events that actually mean
  // "the session is over" — leave and show-end (components/LiveDemo.jsx).
  //
  // The consequence to know about: an artist who starts the mic here and
  // then navigates somewhere OTHER than the show leaves the graph open.
  // That was already true before this change (nothing called stopAudio on
  // that path either), it is not a regression, and it is not fixed here.

  // Camera only. The audio graph is deliberately NOT released here: this
  // cleanup runs on the route change into the live show, which is
  // precisely when the artist needs their audio to keep running.
  useEffect(() => () => {
    stopCamera();
  }, [stopCamera]);

  // Adopt whatever the host already holds when this page mounts, so
  // returning to Kit Check mid-session shows the live graph rather than
  // an empty deck offering to open a microphone that is already open.
  useEffect(() => {
    if (!audioHostActive()) return;
    const existing = getAudioHost();
    audioHandleRef.current = existing;
    setAudioNodes(existing.nodes);
    setAudioContext(existing.audioContext);
  }, []);

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
    })();
    return () => { cancelled = true; };
  }, []);

  // ── The next show, RE-FETCHED (Finding 1) ──────────────────
  //
  // Two things went wrong here and only one of them was the crash.
  //
  // 1. This used to run ONCE, on mount, inside the session effect above.
  //    An artist who had Kit Check already open and then scheduled a show
  //    (in another tab, or on their phone) never picked it up — no
  //    countdown, no handover, forever. Kit Check is a page people sit on
  //    for half an hour; assuming nothing changes while they do was the
  //    wrong assumption.
  //
  // 2. `nextUpcomingShow` threw (the re-export/scope bug fixed in
  //    68cb676) and, because this is an ASYNC EFFECT rather than render,
  //    the throw became an unhandled promise rejection. `setUpcoming`
  //    never ran, `upcoming` stayed null, and every condition downstream
  //    was silently false. THE SAME DEFECT crashed the artist console
  //    loudly (it calls nextUpcomingShow during render) and made Kit
  //    Check do nothing at all. Silence is the worse of the two.
  //
  // So: a try/catch that puts a real message ON SCREEN, and a poll.
  const loadUpcoming = useCallback(async (userId) => {
    try {
      const { data, error } = await getSupabase().from('shows').select('*').eq('artist_id', userId);
      if (error) throw error;
      setUpcoming(nextUpcomingShow(data || []));
      setShowLoadError('');
    } catch (err) {
      // Never silent again. If Kit Check cannot work out when the artist
      // is on, the artist has to be told — they are sitting here waiting
      // for it to take them to their own show.
      console.error('[kit-check] could not load the next show', err);
      setShowLoadError('Could not check your schedule. The automatic hand-over may not fire — use GO LIVE NOW when it is time.');
    }
  }, []);

  useEffect(() => {
    const userId = session?.user?.id;
    if (!userId) return undefined;
    loadUpcoming(userId);
    // Cheap: one indexed query per artist per 20s, only while this page
    // is open. Far cheaper than an artist missing their own show.
    const id = setInterval(() => loadUpcoming(userId), 20000);
    const onVisible = () => { if (document.visibilityState === 'visible') loadUpcoming(userId); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVisible); };
  }, [session, loadUpcoming]);

  // ── TELEMETRY CONTEXT, FILED UNDER THE SHOW BEING PREPARED ──
  //
  // Kit Check never called initHealthLog, so every logHealthEvent on
  // this page was discarded before it reached the queue
  // (lib/healthLog.js drops when no showId is set). That silently
  // blinded the whole pre-show half of the session — the half where the
  // artist opens the microphone, loads a backing track and waits for a
  // countdown, which is exactly where two of this round's defects lived.
  //
  // Filed under the UPCOMING show's room_name rather than a Kit Check
  // identifier of its own, deliberately: that is the same key the live
  // session will use, so preparation and performance land in ONE
  // capture and one export. Splitting them would mean correlating two
  // pulls by hand to answer any question that spans the handover, which
  // is most of the interesting ones.
  useEffect(() => {
    const room = upcoming?.room_name;
    const uid = session?.user?.id;
    if (!room || !uid) return;
    initHealthLog({ showId: room, participantIdentity: uid, role: 'kit-check' });
  }, [upcoming, session]);

  // ── THE HANDOVER — ONE PATH, TWO TRIGGERS ──────────────────
  //
  // The automatic transition at showtime and the manual GO LIVE NOW
  // button call THE SAME FUNCTION. That is the whole requirement of
  // Finding 2 and it is why this is written as one function rather than
  // two similar ones: a parallel manual path would be a second place to
  // forget the camera migration, and the artist reaching for the manual
  // button is precisely the moment the automatic one has already let
  // them down.
  //
  // What "everything the automatic transition carries" actually means,
  // concretely, because it is worth being able to check:
  //   * PAIRED CAMERAS -- the same POST to /api/camfeed/pair {migrate},
  //     which rewrites target_room and bumps generation, so every propped
  //     phone follows within one poll (lib/camfeedPairing.js).
  //   * THE CAMERA -- released here, because the live path acquires its
  //     own and two owners of one device is a black frame on stage.
  //   * THE AUDIO GRAPH AND THE BACKING TRACK -- NOT released, and this
  //     line is the round-1 Test 2 fix. The graph stays open and stays
  //     owned by lib/audioHost.js, which is mounted at the app root and
  //     survives a router.push; the live path reuses it rather than
  //     opening a second microphone. That is what carries the decoded
  //     AudioBuffer — the thing no database column can restore — into
  //     the show still playing.
  //   * THE SESSION -- router.push, not a page load, so the Supabase
  //     session in this tab carries over warm.
  //   * THE CUE SHEET AND B-ROLL -- neither is held in this component's
  //     state at all. Both are keyed to the artist and re-read on the
  //     live page (cue sheets by track hash, b-roll by artist id), so
  //     they arrive because of WHERE they live, not because this
  //     function carries them. Nothing to pass, and nothing that can be
  //     dropped by taking the manual route.
  //
  // `handingOver` is the no-op guard: pressing the button after the
  // automatic transition has already fired does nothing, rather than
  // firing a second migrate and a second navigation.
  const handOverToShow = useCallback((reason) => {
    if (handingOver) return;
    if (!upcoming?.id) return;
    setHandingOver(true);
    setHandoverError('');

    // Release the CAMERA before handing over: the live path acquires its
    // own, and two owners of one device is how you get a black frame on
    // stage.
    //
    // The AUDIO is deliberately NOT released, and the asymmetry is the
    // point. This used to call stopAudio() on the line below, which
    // closed the AudioContext and dropped the loaded backing track — the
    // round-1 Test 2 failure on both triggers. The reasoning above is
    // sound for a camera and wrong for audio, because the live path does
    // NOT acquire its own any more: LiveDemo now reuses whatever graph
    // the host is already holding (audioHostActive() there, same check
    // startAudio uses here). One graph, one microphone, carried across
    // the router.push intact — which is what makes the decoded
    // AudioBuffer survive the transition at all.
    stopCamera();

    // ── THE RIG COMES TOO ──────────────────────────────────────
    // This is the whole reason Kit Check exists: position once, go live
    // with everything already in place. The rehearsal room and the show
    // room are different LiveKit rooms, so "everything" has to include
    // the phones -- and a phone cannot follow a room it was told about
    // once, at redeem time.
    //
    // So it doesn't. Each paired phone polls its own pairing row for the
    // room it should currently be in. This call rewrites that column to
    // the show's room and bumps a generation counter; every propped
    // phone sees the change on its next poll (~4s) and reconnects itself
    // to the show room with a fresh token. Nobody walks across the room.
    //
    // Fire-and-forget with a hard ceiling. The artist's own handover is
    // the thing that must not be late -- a camera arriving four seconds
    // into a show is a shrug; an artist arriving four seconds late is the
    // show starting without them. If migrate is slow or fails, the phones
    // stay in the rehearsal room and can be re-paired from the live
    // screen, which is the pre-Phase-0b behaviour.
    const go = () => router.push(`/live?show=${upcoming.id}`);
    const token = session?.access_token;
    if (!token) { go(); return; }

    let done = false;
    const guard = setTimeout(() => { if (!done) { done = true; go(); } }, HANDOVER_MIGRATE_CEILING_MS);
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
  }, [handingOver, upcoming, session, router, stopCamera]);

  // ── The last minute before SHOWTIME → countdown, then live ──
  //
  // The decision itself lives in lib/showWindow.js's handoverState and is
  // unit-tested (scripts/window-tests.mjs). It used to be an inline
  // four-clause boolean here, which is how it managed to break twice:
  // once counting down from the window opening instead of from showtime,
  // and once not firing at all.
  const handover = handoverState(upcoming, now);
  const countdown = handover.status === 'countdown' || handover.status === 'due' ? handover.countdown : null;

  useEffect(() => {
    if (handover.status !== 'due') return;
    handOverToShow('automatic');
  }, [handover.status, handOverToShow]);

  // Manual GO LIVE NOW (Finding 2). Available whenever the broadcast
  // window is open -- see canHandOverNow for why that bound and not the
  // show window.
  const canGoLiveNow = canHandOverNow(upcoming, now);

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

        {showLoadError && (
          <div style={{ marginTop: 12, fontSize: 11.5, color: '#e71d36', lineHeight: 1.5 }}>{showLoadError}</div>
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

        {/* ── GO LIVE NOW (Finding 2) ────────────────────────────
            The manual path. Automation is the happy path, not the only
            path — and the moment an artist reaches for this is exactly
            the moment the automatic hand-over has already failed them,
            so it runs the IDENTICAL function rather than a parallel one.

            Always rendered once a show exists, disabled with a reason
            outside the window. A button that appears only when it works
            teaches nobody what the rule is; a disabled button that says
            "your window opens in 12m" does. */}
        {upcoming && (
          <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => handOverToShow('manual')}
              disabled={!canGoLiveNow || handingOver}
              title={canGoLiveNow ? 'Take me to my show now' : 'Your broadcast window is not open yet'}
              style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                padding: '13px 20px', fontSize: 11, fontWeight: 700, letterSpacing: '0.1em',
                color: canGoLiveNow && !handingOver ? PORCELAIN : 'rgba(1,22,39,0.4)',
                background: canGoLiveNow && !handingOver ? '#e71d36' : 'transparent',
                border: canGoLiveNow && !handingOver ? 'none' : '1px solid rgba(1,22,39,0.18)',
                cursor: canGoLiveNow && !handingOver ? 'pointer' : 'not-allowed',
              }}
            >
              {handingOver ? 'TAKING YOU THROUGH…' : 'GO LIVE NOW'}
            </button>
            <span style={{ fontSize: 10.5, color: 'rgba(1,22,39,0.5)', lineHeight: 1.5, flex: '1 1 240px' }}>
              {handingOver
                ? 'Moving your cameras across and putting you on stage.'
                : canGoLiveNow
                  ? 'Skips the wait. Your paired cameras come with you, exactly as they would at showtime.'
                  : `Opens ${humanCountdown(msUntilWindow(upcoming, now))} — 30 minutes before your show.`}
            </span>
          </div>
        )}

        {handoverError && (
          <div style={{ marginTop: 8, fontSize: 11.5, color: '#e71d36' }}>{handoverError}</div>
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
                {/* accessToken is what lets the rehearsal room sign a
                    b-roll clip URL — the same owner-checked route the
                    live show uses. */}
                <RehearsalRoom
                  session={rehearsal}
                  onEnd={endRehearsal}
                  onConnectedRoles={handleConnectedRoles}
                  accessToken={session?.access_token}
                />
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
                /* Task 2 — set lists are assembled HERE, and bind to the
                   upcoming show's row so the choice survives the
                   handover. patchSessionState upserts, so the row not
                   existing yet is not a problem. */
                sessionTarget={upcoming?.id && session?.user?.id
                  ? { showId: upcoming.id, artistId: session.user.id }
                  : null}
                canEditSetList
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
