'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  LiveKitRoom,
  RoomAudioRenderer,
  VideoTrack,
  useTracks,
  useDataChannel,
  useRoomContext,
} from '@livekit/components-react';
import { Track, RoomEvent, ConnectionState } from 'livekit-client';
import { VideoCamera, VideoCameraSlash, PhoneDisconnect, CameraRotate } from '@phosphor-icons/react';
import '@livekit/components-styles';

import PageShell from './PageShell';
import BroadcastStage from './BroadcastStage';
import ViewerStage from './ViewerStage';
import CameraQRPanel from './CameraQRPanel';
import BlurFillBackground from './BlurFillBackground';
import { CUT_DEBUG_ENABLED, logCutDebug, CutTimingDebugOverlay, ShotVideo } from './ShotRendering';
import { createPilotAudioTrack, tuneMicMuted } from '../lib/audioProcessing';
import { useSourceDimensions, useNativeIsLandscape, landscapeNativeCaptureOptions } from '../lib/useSourceDimensions';
import { createPortraitProcessor } from '../lib/rotationProcessor';
import { SHOT_TYPES, NEAREST_SHOT_FOR_ROLE, resolveSourceRole } from '../lib/shotTypes';
import { buildShotCommand, broadcastShotCommand, resolveTargetIdentity, onPublishOutcome, publishHealthProbe } from '../lib/shotCommands';
import { createAutoDirector } from '../lib/autoDirector';
import { createCueDirector } from '../lib/cueDirector';
import { effectiveState, canGoLive } from '../lib/showState';
import { initHealthLog, logHealthEvent } from '../lib/healthLog';
import { describeTransport } from '../lib/transportDiagnostics';
import { useIneligibleTracks, filterEligible } from '../lib/trackLiveness';
import { signUp, signIn } from '../lib/supabaseAuth';
import './reactions.css';

const ROOM_NAME = 'pilot-room';

// Fix (b2) -- ceiling on automatic publish recoveries per session.
// recoveryAttempted now resets whenever an episode resolves (so one bad
// moment at show start no longer spends the whole show's automatic
// budget), but each recovery is a real disconnect/connect that
// interrupts audio -- so a pathological fail/resolve/fail cycle must not
// be able to loop on it indefinitely. Past this count the performer
// keeps the manual banner and nothing reconnects on its own.
const MAX_AUTOMATIC_RECOVERIES = 3;

// Fix (a2c) -- the "camera lost" treatment shown over a frozen last
// frame, LIVE SURFACES ONLY. The egress template deliberately passes no
// lostOverlay and gets the bare frozen frame: readable status text baked
// into a recording is exactly what that template exists to exclude.
// Deliberately subtle -- a held frame with a quiet label reads as "this
// feed dropped", where a full-bleed error card would read as "the show
// broke".
const CAMERA_LOST_OVERLAY = (
  <div
    style={{
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 16,
      display: 'flex',
      justifyContent: 'center',
    }}
  >
    <span
      style={{
        fontSize: 11,
        letterSpacing: '0.08em',
        color: 'rgba(253, 255, 252, 0.75)',
        background: 'rgba(1, 22, 39, 0.55)',
        border: '1px solid rgba(46, 196, 182, 0.3)',
        borderRadius: 999,
        padding: '4px 10px',
      }}
    >
      CAMERA LOST
    </span>
  </div>
);

// Portrait is the output target always (Stage 1 of the portrait capture
// work) -- requested uniformly, for every source, not just phones.
// Ideal (not exact), so this is a hint, never a requirement: a phone
// held upright genuinely delivers portrait already (device orientation,
// not this request, is what actually determines that); a fixed
// landscape-only source (webcam, capture card) simply can't satisfy a
// portrait ideal and falls back to its own best available landscape
// mode with no error -- getUserMedia only hard-fails on {exact: ...}/
// min/max constraints, never on bare/ideal values. What actually gets
// delivered is read back afterwards via useSourceDimensions
// (lib/useSourceDimensions.js), never assumed from this request.
//
// aspectRatio + a single dimension (height), NOT width+height as two
// independent ideals -- see the matching comment in CamPage.jsx for the
// real-hardware failure (Sony via capture card) this avoids: two free
// axes invite a driver to hit both by non-uniformly stretching a
// landscape sensor frame into a portrait buffer, which is a squeeze
// baked into the delivered pixels, not something object-fit downstream
// can undo. A phone already delivering ~9:16 content is unaffected.
const HIGH_RES_VIDEO_CAPTURE = { resolution: { height: 1920, aspectRatio: 9 / 16 }, frameRate: { ideal: 30 } };

// DEBUG -- surfaces what useSourceDimensions actually detected, for
// verifying the portrait capture work on real hardware. Safe to delete
// once capture is verified; not meant for artist-facing use. Shows
// whether dimensions were found on the first read or needed retries
// (see useSourceDimensions' bounded initial-read retry -- a capture
// card can lose the race to have getSettings() populated that a phone
// usually wins instantly), and a clearly-flagged failure state rather
// than sitting silently on "detecting" forever if the retry window
// exhausts.
function SourceDimsDebugLabel({ state, style }) {
  const status = state?.status ?? 'detecting';
  const attempts = state?.attempts ?? 0;

  let text;
  let failed = false;
  if (status === 'ready') {
    const tries = attempts > 1 ? ` (found after ${attempts} tries)` : attempts === 1 ? ' (first read)' : '';
    text = `DEBUG ${state.width}x${state.height} -- ${state.isPortraitSource ? 'native portrait' : 'landscape (cropped to portrait)'}${tries}`;
  } else if (status === 'failed') {
    failed = true;
    text = `DEBUG couldn't detect camera resolution after ${attempts} tries -- try reselecting the device or reloading`;
  } else {
    text = attempts > 0 ? `DEBUG detecting source... (retry ${attempts})` : 'DEBUG detecting source...';
  }

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 8,
        left: 8,
        padding: '4px 8px',
        borderRadius: 6,
        background: failed ? 'rgba(231, 29, 54, 0.85)' : 'rgba(1, 22, 39, 0.7)',
        color: '#fdfffc',
        fontFamily: 'monospace',
        fontSize: 10,
        pointerEvents: 'none',
        maxWidth: 260,
        ...style,
      }}
    >
      {text}
    </div>
  );
}

// CUT_DEBUG_ENABLED/logCutDebug/CutTimingDebugOverlay/trackKey and the
// full cut-timing debug-bus history moved to components/ShotRendering.jsx
// (Stage 4) -- imported above.

function formatCountdown(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const mm = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  const ss = String(totalSeconds % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

// Both Go Live and End Show depend on this write actually landing --
// the whole viewer path (15s poll + clock derivation) depends on the row
// reflecting reality, so a silent failure here is a silent failure for
// every viewer, not just a cosmetic one on the artist's own screen.
// Retries once before giving up; caller shows a persistent warning on
// final failure rather than pretending it worked.
async function updateShowStateWithRetry(nextState) {
  const write = async () => {
    const { getSupabase } = await import('../lib/supabaseClient');
    const supabase = getSupabase();
    const { error } = await supabase.from('shows').update({ state: nextState }).eq('room_name', ROOM_NAME);
    if (error) throw error;
  };
  try {
    await write();
    return true;
  } catch (e) {
    console.warn(`[show-lifecycle] ${nextState} write failed, retrying once`, e);
    try {
      await write();
      return true;
    } catch (e2) {
      console.warn(`[show-lifecycle] ${nextState} write failed again, giving up`, e2);
      return false;
    }
  }
}

// Fire-and-forget egress start/stop -- recording is a nice-to-have layered
// on top of a live show, never a dependency of it. Callers don't await
// this; a failed request is logged and swallowed, same principle as
// flywheel logging in lib/shotCommands.js (a broken recorder must never
// take the show down). performanceMode (Stage 4) is only meaningful for
// 'start' -- the route ignores it for 'stop', harmless to always pass.
function triggerEgress(action, room, performanceMode) {
  fetch(`/api/egress/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ room, performanceMode }),
  })
    .then((res) => res.json())
    .then((data) => {
      if (data?.error) {
        console.warn(`[egress] ${action} failed:`, data.error, data.detail);
        return;
      }
      // status/error here is per-egress EgressInfo (see the route) --
      // logged even on an HTTP-200 response so an upload-side failure
      // (bad bucket/credential) isn't invisible just because the request
      // itself succeeded.
      const egresses = data?.egresses || (data?.egressId ? [data] : []);
      egresses.forEach((e) => {
        if (e.status === 'EGRESS_FAILED' || e.status === 'EGRESS_ABORTED' || e.error) {
          console.warn(`[egress] ${action} reported failure:`, e.status, e.error);
        }
      });
    })
    .catch((e) => console.warn(`[egress] ${action} request failed:`, e));
}

// PAN_VECTORS/ShotTransformFrame/ShotFadeLayer/ShotVideo moved to
// components/ShotRendering.jsx (Stage 4, directed portrait egress) --
// imported above, reused as-is by both this file and the new egress
// template.

// Phase 2 diagnostic instrumentation -- log-only 'ended'/'mute'/'unmute'
// taps on the raw capture track and the published track (see lib/
// audioProcessing.js's createPilotAudioTrack). 'raw' vs 'published' lets
// the health-event timeline distinguish a browser/OS-level device event
// (e.g. a Bluetooth input disappearing -- only ever touches the raw
// track directly) from the Web Audio graph's own output going quiet
// while the raw track stays fine. Never touches .enabled or calls
// .stop() on either track -- observation only, exactly like the existing
// metering taps in audioProcessing.js this instrumentation sits beside.
function attachAudioTrackHealthListeners(rawTrack, publishedTrack) {
  const detachers = [];
  function attach(track, which) {
    if (!track) return;
    const onEnded = () => logHealthEvent('mst_ended', { which, trackId: track.id });
    const onMute = () => logHealthEvent('mst_muted', { which, trackId: track.id });
    const onUnmute = () => logHealthEvent('mst_unmuted', { which, trackId: track.id });
    track.addEventListener('ended', onEnded);
    track.addEventListener('mute', onMute);
    track.addEventListener('unmute', onUnmute);
    detachers.push(() => {
      track.removeEventListener('ended', onEnded);
      track.removeEventListener('mute', onMute);
      track.removeEventListener('unmute', onUnmute);
    });
  }
  attach(rawTrack, 'raw');
  attach(publishedTrack, 'published');
  return () => detachers.forEach((fn) => fn());
}

// Phase 2 diagnostic instrumentation -- classifies WHY the director loop
// is starting, purely for the health-event log. sessionStorage (survives
// a same-tab refresh, cleared on tab close) is used ONLY to label the
// reason; it does not restore any session state -- Phase 1 confirmed
// nothing does. Distinguishes "first time this tab observed this show
// live" (mount) from "this tab previously ran the director for this
// show and is starting again" (recovery -- the signature of a mid-show
// refresh). The 'transition' case (soundcheck -> live while already
// mounted and watching) is detected separately at the call site, since
// it doesn't need sessionStorage at all.
// Fix (b1) -- a bounded probe. The pre-flight gates the director, the
// SHOW_LIVE broadcast AND the recording start, so it is now on the
// show's critical path: it must be impossible for it to hang the show
// open. publishData's own path is internally bounded (the SDK's
// peerConnectionTimeout loop in ensureDataTransportConnected), so this
// is belt-and-braces against any future SDK path that awaits
// unbounded -- a timed-out probe is treated exactly like a failed one,
// which routes into recovery rather than into waiting forever.
const PREFLIGHT_PROBE_TIMEOUT_MS = 8000;

// Fix (b6.1) -- how long the pre-flight will wait for the room to reach
// Connected before probing anyway. Generous: this is not a health
// threshold, it's a backstop so a room that never connects can't hold
// the show start open forever. A connect that hasn't landed in 30s has
// problems the pre-flight was never going to solve.
const PREFLIGHT_CONNECT_TIMEOUT_MS = 30000;

// Fix (b6.1) -- resolves once the room is genuinely Connected.
//
// WHY THE PRE-FLIGHT OWNS THIS RATHER THAN ITS CALLERS: the 15:46 capture
// showed the probe firing ~10s BEFORE room_connected, at pcState 'new'
// with signalWs null. The director effect was correctly gated on
// Connected, but the SHOW_LIVE/egress effect was not -- it fires on the
// clock-derived showState alone -- and since runStartPreflight is
// memoized, that ungated caller won the race and spent the one
// pre-flight on a transport that did not exist yet.
//
// Probing then is not merely useless, it is ACTIVELY HARMFUL: with no
// pcManager, ensureDataTransportConnected throws 'PC manager is closed',
// and that rejection is memoized into publisherConnectionPromise for
// that engine's whole life. The pre-flight became the thing that
// poisoned the engine it was meant to protect.
//
// So the wait lives INSIDE the pre-flight, where every caller gets it
// for free regardless of its own gating -- a caller that forgets to
// gate is exactly the failure this round was.
//
// Never rejects: a timeout resolves with timedOut:true and the caller
// proceeds, because not starting the show is worse than starting it
// with the warning banner up.
function waitForRoomConnected(room, timeoutMs = PREFLIGHT_CONNECT_TIMEOUT_MS) {
  if (room?.state === ConnectionState.Connected) {
    return Promise.resolve({ waited: false, timedOut: false });
  }
  return new Promise((resolve) => {
    let settled = false;
    let timer;
    function finish(timedOut) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      room?.off?.(RoomEvent.Connected, onConnected);
      room?.off?.(RoomEvent.ConnectionStateChanged, onStateChanged);
      resolve({ waited: true, timedOut });
    }
    function onConnected() {
      finish(false);
    }
    // ConnectionStateChanged as well as Connected: RoomEvent.Connected
    // only fires for an INITIAL connect. A room that reaches Connected
    // via a reconnect emits Reconnected instead, and waiting on
    // Connected alone would then stall here for the full timeout on a
    // room that is actually fine.
    function onStateChanged(state) {
      if (state === ConnectionState.Connected) finish(false);
    }
    room?.on?.(RoomEvent.Connected, onConnected);
    room?.on?.(RoomEvent.ConnectionStateChanged, onStateChanged);
    timer = setTimeout(() => finish(true), timeoutMs);
    // Re-check AFTER subscribing: Connected could have landed in the gap
    // between the check at the top and the listener being attached, and
    // that event is not replayed.
    if (room?.state === ConnectionState.Connected) finish(false);
  });
}

function probeWithTimeout(room) {
  let timer;
  const probe = publishHealthProbe(room);
  // The losing side of the race still settles. publishHealthProbe
  // already logs and notifies its own outcome internally, so this
  // handler exists purely so a late rejection can't surface as an
  // unhandled promise rejection.
  probe.catch(() => {});
  return Promise.race([
    probe,
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`pre-flight probe timed out after ${PREFLIGHT_PROBE_TIMEOUT_MS}ms`)),
        PREFLIGHT_PROBE_TIMEOUT_MS
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

function classifyDirectorStartReason(showId, role) {
  try {
    const key = `healthlog:director-started:${showId}:${role}`;
    const seen = sessionStorage.getItem(key);
    sessionStorage.setItem(key, '1');
    return seen ? 'recovery' : 'mount';
  } catch {
    return 'mount'; // storage unavailable -- best-effort label, never throws
  }
}

// --- Join flow: performance mode first, then role -----------------------
// PRD ref: Multi-Camera & Production (Artist, Should/Phase 2).
// Scaling ref: Real-time video/audio -- camera feeds are just additional
// LiveKit participants in the same room; no architecture change needed,
// this scales the same way the rest of the room does.

export default function LiveDemo() {
  const [step, setStep] = useState('gate');
  // Entry gate (MULTI_PERFORMER_SPEC.md section 3) -- the one screen
  // every joiner (performer or viewer) hits before the existing
  // mode/role flow below. participantId is kept so a later slot-code
  // claim (Stage 3) can UPDATE this same row instead of inserting a
  // second one.
  const [email, setEmail] = useState('');
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [gateError, setGateError] = useState('');
  const [gateSubmitting, setGateSubmitting] = useState(false);
  const [participantId, setParticipantId] = useState(null);
  const [performanceMode, setPerformanceMode] = useState(null);
  const [name, setName] = useState('');
  // 'performer' is a selection-screen-only sentinel (MULTI_PERFORMER_
  // SPEC.md Stage 3) -- the code determines the real slot, so nothing
  // ever sets role to 'a'/'b' directly anymore. handleClaimAndGoLive
  // overwrites role with whatever slot the server's code check
  // resolves, once a claim actually succeeds.
  const [role, setRole] = useState('viewer'); // 'viewer' | 'performer' | 'a' | 'b' (post-claim only) | 'camfeed-a' | 'camfeed-b'
  const [performerCode, setPerformerCode] = useState('');
  // Accounts & Identity Day 1 -- artist login/signup branch at the gate.
  // gateAudience is the new top-level choice: 'viewer' keeps the
  // existing anonymous form (below) byte-for-byte; 'artist' is the new
  // real-auth path. artistSession holds the Supabase session once an
  // artist authenticates -- its presence is what gates
  // handleClaimAndGoLive's Authorization header, and what step==='role'
  // branches on to skip the free role dropdown entirely (an
  // authenticated artist only ever goes to the performer flow, so
  // `role` is set to 'performer' programmatically once auth succeeds,
  // same sentinel isContestantRole already checks for below).
  const [gateAudience, setGateAudience] = useState(null); // null | 'viewer' | 'artist'
  const [artistAuthTab, setArtistAuthTab] = useState('login'); // 'login' | 'signup'
  const [artistEmailInput, setArtistEmailInput] = useState('');
  const [artistPassword, setArtistPassword] = useState('');
  const [artistDisplayName, setArtistDisplayName] = useState('');
  const [artistAuthError, setArtistAuthError] = useState('');
  const [artistAuthSubmitting, setArtistAuthSubmitting] = useState(false);
  const [artistSession, setArtistSession] = useState(null);
  // Held for Stage 4's active-performer switch control -- only ever
  // non-null on the device that most recently claimed slot 'a'.
  const [sessionToken, setSessionToken] = useState(null);
  const [camRole, setCamRole] = useState('wide'); // camera position for camfeed devices: 'wide' | 'close' | 'side'
  const [conn, setConn] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  // Phase 4 (redesign) -- true browser Fullscreen API, not the CSS-only
  // "fill the stage box" toggle this used to be (that CSS effect no
  // longer exists at all since Phase 2 made full-bleed the permanent
  // default, not something to toggle into). maximized itself stays a
  // plain boolean the rest of the app already reads -- it's now kept in
  // sync FROM the browser's own fullscreen state via the event listener
  // below, rather than being the thing that DRIVES entering/exiting.
  //
  // Hard platform limit, not a bug: iOS Safari does not implement
  // requestFullscreen() for arbitrary elements at all (only <video>
  // elements get a separate, video-specific fullscreen API there) --
  // canUseFullscreenApi is a feature-detect, not a device-sniff, so this
  // falls back gracefully on any browser in the same situation, not just
  // iPhone specifically. Where it's unavailable, "maximize" still does
  // something -- the same instant declutter (hide sidebar/deck/comments/
  // QR) the cascade effect below already does on real fullscreen entry --
  // just without genuine OS-level fullscreen alongside it.
  const [maximized, setMaximized] = useState(false);
  // Fix (1d) -- set once, by RoomInner, when the show reaches 'ended'.
  // Gates the `video` prop below so nothing can republish the camera.
  const [broadcastEnded, setBroadcastEnded] = useState(false);
  const handleBroadcastEnded = useCallback(() => setBroadcastEnded(true), []);
  const canUseFullscreenApi =
    typeof document !== 'undefined' &&
    !!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);

  const toggleMaximize = useCallback(() => {
    if (!canUseFullscreenApi) {
      setMaximized((v) => !v);
      return;
    }
    const isFullscreen = !!(document.fullscreenElement || document.webkitFullscreenElement);
    if (!isFullscreen) {
      const request = document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen;
      request.call(document.documentElement).catch((e) => {
        // A user gesture requirement not being met, or the platform
        // refusing for its own reasons, is the realistic failure case --
        // fall back to the CSS-only declutter so the button still does
        // SOMETHING rather than silently no-op.
        console.warn('[fullscreen] requestFullscreen failed, using CSS-only fallback', e);
        setMaximized((v) => !v);
      });
    } else {
      const exit = document.exitFullscreen ? document.exitFullscreen.bind(document) : document.webkitExitFullscreen?.bind(document);
      exit?.();
    }
  }, [canUseFullscreenApi]);

  // Keeps `maximized` truthful if the user exits fullscreen via the
  // browser's OWN control (Escape key, its native UI) rather than this
  // button -- without this, the icon/state would desync and keep
  // claiming "fullscreen" after the browser already left it.
  useEffect(() => {
    function handleFullscreenChange() {
      setMaximized(!!(document.fullscreenElement || document.webkitFullscreenElement));
    }
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
    };
  }, []);

  // Performer-only left-menu collapse (separate from maximize's own
  // hideSidebar, which fully unmounts the sidebar with no animation) --
  // owned here since it needs to reach both PageShell (renders Sidebar)
  // and RoomInner/BroadcastStage (needs it to know when, combined with
  // the bottom deck also being collapsed, the video should go full-view).
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const toggleSidebarCollapsed = useCallback(() => setSidebarCollapsed((v) => !v), []);

  // Phase 4 -- entering fullscreen also collapses the sidebar once, so
  // true browser fullscreen (which only makes the PAGE fill the screen,
  // not declutter OUR OWN overlay chrome on top of it) still lands on a
  // genuinely clean "just video" view. One-time on the FALSE->TRUE
  // transition -- the reveal tab still works normally afterward if the
  // artist wants the menu back mid-fullscreen. RoomInner runs the
  // matching effect for deck/comments/QR (that state lives there, not
  // here) -- same trigger, same one-time-on-entry reasoning, split
  // across the two components that actually own each piece of state.
  const prevMaximizedRef = useRef(maximized);
  useEffect(() => {
    if (maximized && !prevMaximizedRef.current) {
      setSidebarCollapsed(true);
    }
    prevMaximizedRef.current = maximized;
  }, [maximized]);

  // Show lifecycle (SHOW_LIFECYCLE_SPEC.md L1). `now` ticks locally every
  // second so effectiveState's clock check (and any countdown built on
  // it) stays live without a fresh fetch -- true from a cached
  // 'soundcheck' row onward, since effectiveState can derive 'live' from
  // that alone. A missing/unreachable show row (no Supabase env
  // configured, or the pilot row hasn't been created yet) safely falls
  // back to 'scheduled' via effectiveState(null).
  const [show, setShow] = useState(null);
  const [now, setNow] = useState(() => Date.now());

  // 'soundcheck' | 'ended' | null -- which lifecycle write (if either)
  // has failed twice and needs a persistent on-screen warning. A single
  // slot is enough since Go Live and End Show can't both be in flight
  // from the same artist at once.
  const [showWriteError, setShowWriteError] = useState(null);

  const fetchShow = useCallback(async () => {
    try {
      const { getSupabase } = await import('../lib/supabaseClient');
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from('shows')
        .select('*')
        .eq('room_name', ROOM_NAME)
        .maybeSingle();
      if (!error) setShow(data);
    } catch (e) {
      console.warn('[show-lifecycle] show fetch failed', e);
    }
  }, []);

  useEffect(() => {
    fetchShow();
  }, [fetchShow]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // effectiveState can only ever derive 'live' from a cached 'soundcheck'
  // row -- a viewer whose cache still says 'scheduled' (fetched before
  // the artist tapped Go Live) can NEVER flip via the clock alone, no
  // matter how much time passes. Without this, such a viewer depends
  // entirely on receiving the SHOW_LIVE broadcast -- a single point of
  // failure if their connection blips at the flip moment. So: poll while
  // the cache still says 'scheduled' (or no row exists yet -- same
  // failure mode). This effect's own condition goes false the moment the
  // cache reaches 'soundcheck' or 'ended', which stops the interval
  // without any separate stop-condition logic -- from 'soundcheck'
  // onward the clock derivation is sufficient on its own, exactly as
  // before this fix.
  useEffect(() => {
    if (show && show.state !== 'scheduled') return undefined;
    const id = setInterval(fetchShow, 15000);
    return () => clearInterval(id);
  }, [show, fetchShow]);

  // Final safety net: one extra re-fetch right as the local clock crosses
  // slated_at, in case the 15s poll hasn't landed yet AND SHOW_LIVE is
  // somehow missed too -- covers the narrowest possible timing gap.
  // Guarded by a ref (not state) so firing it can't itself trigger a
  // render loop, and reset whenever the underlying show row changes so a
  // rescheduled show can trigger it again.
  const slatedSafetyFiredRef = useRef(false);
  useEffect(() => {
    slatedSafetyFiredRef.current = false;
  }, [show?.slated_at, show?.state]);

  useEffect(() => {
    if (!show || show.state !== 'scheduled' || slatedSafetyFiredRef.current) return;
    if (now >= new Date(show.slated_at).getTime()) {
      slatedSafetyFiredRef.current = true;
      fetchShow();
    }
  }, [now, show, fetchShow]);

  const showState = effectiveState(show, now);

  async function handleJoin() {
    setError('');
    setNotice('');

    const isCamFeed = role.startsWith('camfeed-');
    const contestantRequest = (!isCamFeed && role !== 'viewer') ? role : null;
    const camfeedSlot = isCamFeed ? role.split('-')[1] : null;

    let identity;
    let extraParam = '';
    if (contestantRequest) {
      identity = `contestant-${contestantRequest}-${name || Date.now()}`;
      extraParam = `&contestant=${contestantRequest}`;
    } else if (camfeedSlot) {
      identity = `camfeed-${camfeedSlot}-${camRole}-${Date.now()}-${name || 'cam'}`;
      extraParam = `&camfeed=${camfeedSlot}`;
    } else {
      identity = name || `viewer-${Date.now()}`;
    }

    try {
      const res = await fetch(
        `/api/token?room=${ROOM_NAME}&identity=${encodeURIComponent(identity)}${extraParam}`
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Token request failed');

      if (data.slotTaken) {
        setNotice(`Performer ${contestantRequest?.toUpperCase()} is already in the show -- joining you as a viewer instead.`);
      }

      setConn({ token: data.token, url: data.url, assignedRole: data.assignedRole, name: name || 'guest' });
      setStep('joined');
    } catch (e) {
      setError(e.message);
    }
  }

  const primaryBtnStyle = { padding: 12, background: '#2ec4b6', color: '#011627' };
  const fieldStyle = {
    padding: 8,
    background: 'rgba(253, 255, 252, 0.06)',
    border: '1px solid rgba(253, 255, 252, 0.2)',
    borderRadius: 8,
    color: '#fdfffc',
  };

  // Go Live (SHOW_LIFECYCLE_SPEC.md L2). Only performer roles drive show
  // state -- viewers/camfeed devices join exactly as before, ungated.
  // canGoLive() isn't null-safe (throws on show.slated_at if show is
  // null), so it's only ever called behind the `show &&` guard here.
  // 'performer' here means "authenticated as an artist, about to claim
  // a code" (MULTI_PERFORMER_SPEC.md Stage 3, now gated by Accounts &
  // Identity Day 1's auth layer -- see handleArtistAuth, the only place
  // role is ever set to 'performer') -- role only ever becomes the real
  // 'a'/'b' after a successful claim, by which point this screen is no
  // longer rendered.
  const isContestantRole = role === 'performer';
  const goLiveDisabledReason = !isContestantRole
    ? null
    : showState === 'ended'
      ? 'This show has ended.'
      : !show
        ? 'No show scheduled yet.'
        : showState === 'scheduled' && !canGoLive(show, now)
          ? `Soundcheck opens at ${new Date(show.slated_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`
          : null;

  function handleGoLive() {
    if (goLiveDisabledReason) return;
    if (show && show.state === 'scheduled') {
      // Optimistic local update -- instant countdown on this device
      // without waiting on the round trip; the artist never taps a
      // second button, so this has to feel immediate.
      setShow((prev) => (prev ? { ...prev, state: 'soundcheck' } : prev));
      setShowWriteError(null);
      // Not awaited -- handleJoin() below must not wait on the network
      // round trip (or the retry). The write resolves in the background;
      // if it ultimately fails, the soundcheck banner picks up the
      // warning whenever this settles, even after the artist has already
      // joined and is looking at it.
      updateShowStateWithRetry('soundcheck').then((ok) => {
        setShowWriteError(ok ? null : 'soundcheck');
      });
    }
    handleJoin();
  }

  // Stage 3 (MULTI_PERFORMER_SPEC.md) -- replaces handleJoin for the
  // performer path entirely. Deliberately does NOT call /api/token:
  // /api/performer/claim-slot mints its own LiveKit AccessToken, gated
  // on the code rather than the client asserting a slot letter. Reuses
  // handleGoLive's optimistic soundcheck write since a performer join
  // is still a "go live" action either way.
  async function handleClaimAndGoLive() {
    setError('');
    setNotice('');
    if (goLiveDisabledReason) return;
    if (!performerCode.trim()) {
      setError('Enter your performer code.');
      return;
    }
    if (!artistSession) {
      setError('Sign in as an artist to claim a slot.');
      return;
    }
    try {
      const res = await fetch('/api/performer/claim-slot', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // claim-slot now verifies this server-side (lib/verifyArtistAuth.js)
          // and derives claimed_by_email from it -- email is no longer sent
          // in the body at all.
          Authorization: `Bearer ${artistSession.access_token}`,
        },
        body: JSON.stringify({
          show_id: show?.id,
          code: performerCode.trim(),
          participantId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Code not recognized');
      if (data.warning) setNotice(data.warning);

      if (show && show.state === 'scheduled') {
        setShow((prev) => (prev ? { ...prev, state: 'soundcheck' } : prev));
        setShowWriteError(null);
        updateShowStateWithRetry('soundcheck').then((ok) => {
          setShowWriteError(ok ? null : 'soundcheck');
        });
      }

      setRole(data.slot); // 'a' | 'b' -- everything downstream (isMainPerformer, BroadcastStage, renderSlot) now just works unchanged
      setSessionToken(data.sessionToken);
      setConn({ token: data.livekitToken, url: data.url, assignedRole: data.slot, name: name || 'guest' });
      setStep('joined');
    } catch (e) {
      setError(e.message);
    }
  }

  // Shared by both gate paths -- the viewer's plain form and, after
  // auth, the artist branch below -- since registering a join in
  // `participants` (email + consent) is the same operation regardless
  // of which identity mechanism produced the email.
  async function registerParticipant(emailValue, consent) {
    if (!show?.id) {
      throw new Error("Couldn't reach the show yet -- try again in a moment.");
    }
    const res = await fetch('/api/participants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ show_id: show.id, email: emailValue, consent }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not continue');
    return data.participantId;
  }

  async function handleGateSubmit() {
    setGateError('');
    const trimmed = email.trim();
    if (!trimmed) {
      setGateError('Enter your email to continue.');
      return;
    }
    setGateSubmitting(true);
    try {
      const id = await registerParticipant(trimmed, marketingConsent);
      setParticipantId(id);
      setStep('mode');
    } catch (e) {
      setGateError(e.message);
    } finally {
      setGateSubmitting(false);
    }
  }

  // Accounts & Identity Day 1. Auth answers WHO; the performer code
  // (still ahead, at step==='role') answers WHICH SLOT -- this only
  // signs the artist in and gets them to the same code-entry screen the
  // old role dropdown used to, it never claims a slot itself.
  async function handleArtistAuth() {
    setArtistAuthError('');
    if (!artistEmailInput.trim() || !artistPassword) {
      setArtistAuthError('Email and password are required.');
      return;
    }
    setArtistAuthSubmitting(true);
    try {
      const result = artistAuthTab === 'signup'
        ? await signUp({
            email: artistEmailInput.trim(),
            password: artistPassword,
            role: 'artist',
            displayName: artistDisplayName.trim() || artistEmailInput.trim(),
          })
        : await signIn({ email: artistEmailInput.trim(), password: artistPassword });

      if (result.error) {
        setArtistAuthError(result.error.message || 'Authentication failed.');
        return;
      }
      if (result.needsEmailConfirmation) {
        setArtistAuthError('Check your email to confirm your account, then log in.');
        setArtistAuthTab('login');
        return;
      }
      if (result.profile && result.profile.role !== 'artist') {
        setArtistAuthError('This account is not an artist account.');
        return;
      }

      const session = result.data.session;
      const verifiedEmail = session.user.email;
      const displayName = result.profile?.display_name || verifiedEmail;
      const id = await registerParticipant(verifiedEmail, false);

      setArtistSession(session);
      setParticipantId(id);
      setEmail(verifiedEmail);
      setName(displayName);
      setRole('performer');
      setStep('mode');
    } catch (e) {
      setArtistAuthError(e.message);
    } finally {
      setArtistAuthSubmitting(false);
    }
  }

  if (step === 'gate') {
    if (!gateAudience) {
      return (
        <PageShell active="live">
          <div style={{ maxWidth: 400, margin: '60px auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <h2>Pilot show</h2>
            <p style={{ color: 'rgba(253, 255, 252, 0.55)', fontSize: 14 }}>Are you here to watch, or to perform?</p>
            <button onClick={() => setGateAudience('viewer')} style={primaryBtnStyle}>I&apos;m a viewer</button>
            <button onClick={() => setGateAudience('artist')} style={primaryBtnStyle}>I&apos;m an artist</button>
          </div>
        </PageShell>
      );
    }

    if (gateAudience === 'artist') {
      return (
        <PageShell active="live">
          <div style={{ maxWidth: 400, margin: '60px auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <h2>Artist sign in</h2>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => setArtistAuthTab('login')}
                style={{ ...primaryBtnStyle, opacity: artistAuthTab === 'login' ? 1 : 0.5 }}
              >
                Log in
              </button>
              <button
                onClick={() => setArtistAuthTab('signup')}
                style={{ ...primaryBtnStyle, opacity: artistAuthTab === 'signup' ? 1 : 0.5 }}
              >
                Sign up
              </button>
            </div>
            {artistAuthTab === 'signup' && (
              <input
                placeholder="display name"
                value={artistDisplayName}
                onChange={(e) => setArtistDisplayName(e.target.value)}
                style={fieldStyle}
              />
            )}
            <input
              type="email"
              placeholder="email"
              value={artistEmailInput}
              onChange={(e) => setArtistEmailInput(e.target.value)}
              style={fieldStyle}
            />
            <input
              type="password"
              placeholder="password"
              value={artistPassword}
              onChange={(e) => setArtistPassword(e.target.value)}
              style={fieldStyle}
            />
            <button
              onClick={handleArtistAuth}
              disabled={artistAuthSubmitting}
              style={{ ...primaryBtnStyle, opacity: artistAuthSubmitting ? 0.6 : 1 }}
            >
              {artistAuthSubmitting ? 'Please wait…' : artistAuthTab === 'signup' ? 'Create account' : 'Log in'}
            </button>
            {artistAuthError && <p style={{ color: '#e71d36' }}>{artistAuthError}</p>}
            <button
              onClick={() => setGateAudience(null)}
              style={{ background: 'none', border: 'none', color: 'rgba(253, 255, 252, 0.5)', fontSize: 12, padding: 4 }}
            >
              ← Back
            </button>
          </div>
        </PageShell>
      );
    }

    // gateAudience === 'viewer' -- existing anonymous form, unchanged.
    return (
      <PageShell active="live">
        <div style={{ maxWidth: 400, margin: '60px auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h2>Pilot show</h2>
          <input
            type="email"
            placeholder="your email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={fieldStyle}
          />
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'rgba(253, 255, 252, 0.7)' }}>
            <input
              type="checkbox"
              checked={marketingConsent}
              onChange={(e) => setMarketingConsent(e.target.checked)}
            />
            Send me updates about Loudentify shows
          </label>
          <p style={{ color: 'rgba(253, 255, 252, 0.55)', fontSize: 12 }}>
            We&apos;ll use your email to send you updates about this show and Loudentify.
          </p>
          <button
            onClick={handleGateSubmit}
            disabled={gateSubmitting}
            style={{ ...primaryBtnStyle, opacity: gateSubmitting ? 0.6 : 1 }}
          >
            {gateSubmitting ? 'Continuing…' : 'Continue'}
          </button>
          {gateError && <p style={{ color: '#e71d36' }}>{gateError}</p>}
          <button
            onClick={() => setGateAudience(null)}
            style={{ background: 'none', border: 'none', color: 'rgba(253, 255, 252, 0.5)', fontSize: 12, padding: 4 }}
          >
            ← Back
          </button>
        </div>
      </PageShell>
    );
  }

  if (step === 'mode') {
    return (
      <PageShell active="live">
        <div style={{ maxWidth: 400, margin: '60px auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h2>Pilot show</h2>
          <p style={{ color: 'rgba(253, 255, 252, 0.55)', fontSize: 14 }}>Is this a solo performance or a versus matchup?</p>
          <button onClick={() => { setPerformanceMode('solo'); setStep('role'); }} style={primaryBtnStyle}>Solo</button>
          <button onClick={() => { setPerformanceMode('versus'); setStep('role'); }} style={primaryBtnStyle}>Versus</button>
        </div>
      </PageShell>
    );
  }

  if (step === 'role') {
    return (
      <PageShell active="live">
        <div style={{ maxWidth: 400, margin: '60px auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h2>Join {performanceMode === 'solo' ? 'solo show' : 'versus show'}</h2>
          {artistSession ? (
            // Accounts & Identity Day 1 -- an authenticated artist skips
            // the free name/role picker entirely (identity already comes
            // from the verified session, role is already 'performer',
            // set in handleArtistAuth) and goes straight to the one thing
            // auth doesn't answer: which slot. isContestantRole/
            // goLiveDisabledReason below are unchanged -- role==='performer'
            // is the same sentinel they always checked, just reachable
            // only through this branch now instead of a dropdown option.
            <>
              <p style={{ color: 'rgba(253, 255, 252, 0.7)', fontSize: 13 }}>Signed in as {name || email}</p>
              <input
                placeholder="performer code"
                value={performerCode}
                onChange={(e) => setPerformerCode(e.target.value)}
                style={fieldStyle}
              />
              <button
                onClick={handleClaimAndGoLive}
                disabled={!!goLiveDisabledReason}
                style={{
                  ...primaryBtnStyle,
                  opacity: goLiveDisabledReason ? 0.5 : 1,
                  cursor: goLiveDisabledReason ? 'not-allowed' : 'pointer',
                }}
              >
                Claim &amp; Go Live
              </button>
              {goLiveDisabledReason && (
                <p style={{ color: 'rgba(253, 255, 252, 0.55)', fontSize: 13 }}>{goLiveDisabledReason}</p>
              )}
            </>
          ) : (
            <>
              <input
                placeholder="your name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={fieldStyle}
              />
              <select value={role} onChange={(e) => setRole(e.target.value)} style={fieldStyle}>
                <option value="viewer">Viewer</option>
                <option value="camfeed-a">{performanceMode === 'solo' ? 'Extra camera' : 'Extra camera -- side A'}</option>
                {performanceMode === 'versus' && <option value="camfeed-b">Extra camera -- side B</option>}
              </select>
              {role.startsWith('camfeed-') && (
                <div style={{ display: 'flex', gap: 8 }}>
                  {[
                    { value: 'wide', label: 'Wide' },
                    { value: 'close', label: 'Close' },
                    { value: 'side', label: 'Side' },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setCamRole(opt.value)}
                      style={{
                        flex: 1,
                        padding: 10,
                        borderRadius: 8,
                        background: camRole === opt.value ? '#2ec4b6' : 'rgba(253, 255, 252, 0.06)',
                        color: camRole === opt.value ? '#011627' : '#fdfffc',
                        border: camRole === opt.value ? 'none' : '1px solid rgba(253, 255, 252, 0.2)',
                      }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
              <button onClick={handleJoin} style={primaryBtnStyle}>Join</button>
            </>
          )}
          {error && <p style={{ color: '#e71d36' }}>{error}</p>}
        </div>
      </PageShell>
    );
  }

  const isCamFeedRole = conn.assignedRole?.startsWith('camfeed-');
  // Generalized off the a/b whitelist (found during the slot-c bug
  // triage, MULTI_PERFORMER_SPEC.md's generalization pass) -- any
  // claimed slot letter publishes video; only the known non-performer
  // sentinels ('viewer', camfeed-prefixed handled separately above)
  // don't.
  // Fix (1d) -- once the broadcast has ended, the `video` prop goes false
  // so LiveKitRoom cannot put the camera back on air. RoomInner's own
  // unpublish (above) is the immediate, authoritative stop; this is what
  // makes it STAY stopped, because LiveKitRoom re-asserts the prop by
  // calling setCameraEnabled(!!video) on every SignalConnected -- so any
  // reconnect after End Show would otherwise silently resume
  // transmission. Exactly the same class of hole as fix (1b) for audio.
  //
  // Lifted out of RoomInner via a callback rather than read from
  // `showState` here, because a versus show's NON-director performer
  // only learns the show ended from the SHOW_ENDED broadcast, which this
  // outer component's clock-derived state never sees.
  //
  // Consequence worth naming: LiveKitRoom's own setCameraEnabled(false)
  // also stops the local camera device shortly after. Acceptable here --
  // the show is over and the ended card is showing. Keeping the camera
  // alive locally while off air is the broadcast window's job
  // (docs/BUILD_AUDIT_2026-08.md G.1), not this fix's.
  const publishesVideo = conn.assignedRole !== 'viewer' && !broadcastEnded;
  // Camfeed phones are propped to film the artist -- rear by default.
  // The artist's own device defaults to front so they can see themselves.
  const defaultFacingMode = isCamFeedRole ? 'environment' : 'user';
  // Only a plain fan viewer gets the auto-hiding mobile sidebar -- main
  // performers and camera-feed devices keep the sidebar's normal behavior.
  const isViewerRole = conn.assignedRole === 'viewer';

  return (
    <PageShell
      active="live"
      hideSidebar={maximized}
      autoHideSidebar={isViewerRole}
      sidebarCollapsed={sidebarCollapsed}
      onToggleSidebarCollapse={!isViewerRole && !isCamFeedRole ? toggleSidebarCollapsed : undefined}
      liveOverlay
    >
      <div className="live-room-shell">
        <LiveKitRoom
          token={conn.token}
          serverUrl={conn.url}
          connect
          audio={false}
          video={publishesVideo ? { facingMode: defaultFacingMode, ...HIGH_RES_VIDEO_CAPTURE } : false}
          data-lk-theme="default"
          style={{ height: '100%', width: '100%' }}
        >
          {/* Fix (1c) -- RoomAudioRenderer moved INTO RoomInner, where
              displayShowState exists. It was gated here on the plain
              clock-derived showState, which cannot see a SHOW_ENDED
              receipt: L1's polling stops once the cached row reaches
              'soundcheck', and the clock derives 'live' forever after,
              so a viewer who learned the show ended from the broadcast
              kept RoomAudioRenderer mounted indefinitely and kept
              hearing the performer. The gate needs the same authoritative
              state the rest of the lifecycle UI already uses. */}
          <RoomInner
            performanceMode={performanceMode}
            role={conn.assignedRole}
            notice={notice}
            selfName={conn.name}
            email={email}
            artistAccessToken={artistSession?.access_token}
            maximized={maximized}
            onToggleMaximize={toggleMaximize}
            sidebarCollapsed={sidebarCollapsed}
            show={show}
            showState={showState}
            now={now}
            onShowUpdate={setShow}
            onRefetchShow={fetchShow}
            showWriteError={showWriteError}
            onShowWriteErrorChange={setShowWriteError}
            sessionToken={sessionToken}
            connToken={conn.token}
            connServerUrl={conn.url}
            onBroadcastEnded={handleBroadcastEnded}
          />
        </LiveKitRoom>
      </div>
    </PageShell>
  );
}

// --- Viewer holding screen / ended card (SHOW_LIFECYCLE_SPEC.md 3c) ----
// Rendered instead of ViewerStage while displayShowState is 'scheduled'
// or 'soundcheck' -- viewers connect to the room early regardless (3c:
// "simpler than gating the connection"), they just don't see renderSlot
// output until live. Swapping between this and <ViewerStage> is itself
// the hard cut described in 3c ("this is the show's first shot -- make
// it land like one") -- no crossfade layer, a plain conditional render.
function HoldingScreen({ show, now }) {
  const slated = show?.slated_at ? new Date(show.slated_at).getTime() : null;
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: '#011627',
        color: '#fdfffc',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        textAlign: 'center',
        padding: 24,
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: '0.2em', opacity: 0.7 }}>LOUDENTIFY</div>
      <div style={{ fontSize: 24, fontWeight: 700 }}>{show?.artist_name || 'The show'}</div>
      {slated ? (
        <>
          <div style={{ fontSize: 14, opacity: 0.6 }}>
            Starting {new Date(slated).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          </div>
          <div style={{ fontSize: 32, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
            {formatCountdown(slated - now)}
          </div>
        </>
      ) : (
        <div style={{ fontSize: 14, opacity: 0.6 }}>Waiting for the show to be scheduled...</div>
      )}
    </div>
  );
}

function EndedCard() {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: '#011627',
        color: '#fdfffc',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
      }}
    >
      <div style={{ fontSize: 20, fontWeight: 700 }}>Show ended</div>
    </div>
  );
}

// "Be right back" interstitial (SHOW_LIFECYCLE_SPEC.md L6-3) -- fills
// renderSlot's own ShotVideo slot (a bounded panel inside VersusSplit,
// already centered by .contestant-panel's flex rules), not a fullscreen
// takeover like HoldingScreen/EndedCard above. Reuses their ink/
// porcelain branding, scaled to fit inline instead.
const BE_RIGHT_BACK_PLACEHOLDER = (
  <div style={{ textAlign: 'center', padding: 16, color: '#fdfffc' }}>
    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.2em', opacity: 0.6, marginBottom: 8 }}>
      LOUDENTIFY
    </div>
    <div style={{ fontSize: 13 }}>The performance will resume in a moment</div>
  </div>
);

// --- Connected room UI -------------------------------------------------

function RoomInner({ performanceMode, role, notice, selfName, email, artistAccessToken, maximized, onToggleMaximize, sidebarCollapsed, show, showState, now, onShowUpdate, onRefetchShow, showWriteError, onShowWriteErrorChange, sessionToken, connToken, connServerUrl, onBroadcastEnded }) {
  const room = useRoomContext();
  const tracks = useTracks([Track.Source.Camera]);
  // Finding 1 -- shared liveness registry (lib/trackLiveness.js), same
  // instance feeding every selection on this device.
  const ineligibleTracks = useIneligibleTracks(room, tracks);

  // Fix (b), SHOW-1 diagnosis round -- the director-start trigger below
  // must gate on the ROOM actually being connected, not just on
  // displayShowState reaching 'live'. Phase 1 audit + the health_events
  // timeline from the main-performer-refresh test both confirmed
  // director_loop_started can fire before RoomEvent.Connected (a
  // rejoining client's displayShowState is often already 'live' the
  // instant this component mounts, since it derives from a
  // pre-fetched/cached show row, independent of the room's own connect
  // handshake). Tracked as React state (not read via room.state
  // directly in the effect below) so the effect re-evaluates the moment
  // connection state changes, without needing room.state itself as a
  // dependency (a fresh property read isn't a stable reference to depend
  // on). Initialized from room.state directly since Connected/
  // Reconnected may already have fired before this component mounted.
  const [roomConnectionState, setRoomConnectionState] = useState(() => room.state);

  // Hoisted from their previous position further down this component
  // (audio-reconnect round) -- ensureAudioPublished below needs them,
  // and it in turn needs to be callable from the room+track lifecycle
  // effect's onReconnected handler just below, which is declared earlier
  // than where these used to live. Pure state/ref declarations with no
  // dependencies of their own, so hoisting is safe.
  const [micOn, setMicOn] = useState(true);
  const [audioNodes, setAudioNodes] = useState(null);
  const [audioContext, setAudioContext] = useState(null);
  const audioHandleRef = useRef(null);
  const detachAudioTrackHealthListenersRef = useRef(null);

  // Fix (a)+(b) (audio-reconnect round) -- idempotent "make sure the
  // processed audio track is published," used by every reconnect path:
  // fix (c)'s recovery, RoomEvent.Reconnected (plain LiveKit-level
  // reconnects, Phase 1's unverified case), and RoomEvent.SignalConnected
  // (which is also where LiveKitRoom's own setMicrophoneEnabled(false)
  // mutes an already-published track out from under us -- see the
  // SignalConnected handler below for the other half of that fix).
  // Deliberately NOT used by the initial mount-time publish further down
  // (that path creates the Web Audio graph in the first place and
  // already has its own tested attempt/success/failure logging,
  // confirmed working in a real capture) -- this function only ever
  // republishes a track that already exists via audioHandleRef.
  //
  // In-flight guard (not just a publication check) because
  // SignalConnected and the recovery path can fire close together -- a
  // reconnect's own SignalConnected can fire while attemptPublishRecovery's
  // own call to this function is still awaiting publishTrack. Without
  // it, two concurrent calls could both see "not published yet" and both
  // publish, producing two audio track publications.
  const audioPublishInFlightRef = useRef(false);
  // Fix (1b) -- a ref, not the state value, because ensureAudioPublished
  // and the SignalConnected handler are long-lived callbacks that would
  // otherwise capture a stale `displayShowState` from the render that
  // created them. Set in an effect below, next to displayShowState.
  const showEndedRef = useRef(false);

  const ensureAudioPublished = useCallback(async (trigger) => {
    // Fix (1b) -- once the show has ended, nothing may put the mic back
    // on air. This is load-bearing, not defensive: this function fires on
    // signal_connected, room_reconnected AND publish recovery, so without
    // this guard any reconnect after END SHOW silently republishes the
    // performer's live microphone to whoever is still in the room.
    if (showEndedRef.current) {
      logHealthEvent('ensure_audio_published', { trigger, action: 'skipped_show_ended' });
      return;
    }
    if (audioPublishInFlightRef.current) {
      logHealthEvent('ensure_audio_published', { trigger, action: 'skipped_in_flight' });
      return;
    }
    const handle = audioHandleRef.current;
    if (!handle?.processedTrack) {
      // Nothing to (re)publish yet -- either this device never runs the
      // audio effect (not isMainPerformer) or a reconnect landed before
      // the mount-time graph setup finished. Not an error: the mount
      // effect's own publish runs once it's ready.
      // Fix (b3) -- snapshot here too. This firing with
      // skipped_no_handle at signal-connect, BEFORE go-live, is one of
      // the signals that the start sequence races itself; correlating it
      // against the transport state is how we tell "graph not built yet"
      // (benign, the mount effect's own publish follows) apart from
      // "engine already being torn down underneath us" (not benign).
      logHealthEvent('ensure_audio_published', { trigger, action: 'skipped_no_handle', transport: describeTransport(room) });
      return;
    }
    audioPublishInFlightRef.current = true;
    try {
      const existingPub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
      if (existingPub?.track) {
        logHealthEvent('ensure_audio_published', { trigger, action: 'already_published' });
        return;
      }
      let trackToPublish = handle.processedTrack;
      let action = 'republished';
      if (trackToPublish.readyState === 'ended') {
        // Defensive guard -- not observed in either real recovery test
        // captured so far (no mst_ended anywhere), but a genuinely dead
        // MediaStreamTrack can't be republished, only replaced. Rebuilds
        // the whole Case 2 graph exactly like the mount effect does, and
        // re-attaches the same health listeners to the new handle.
        const freshHandle = await createPilotAudioTrack();
        audioHandleRef.current = freshHandle;
        setAudioNodes(freshHandle.nodes);
        setAudioContext(freshHandle.audioContext);
        detachAudioTrackHealthListenersRef.current?.();
        detachAudioTrackHealthListenersRef.current = attachAudioTrackHealthListeners(
          freshHandle.rawStream?.getAudioTracks?.()[0] ?? null,
          freshHandle.processedTrack
        );
        freshHandle.audioContext.onstatechange = () => {
          logHealthEvent('audiocontext_statechange', { state: freshHandle.audioContext.state });
        };
        trackToPublish = freshHandle.processedTrack;
        action = 'track_ended_recreated';
      }
      // Fix (2c) -- the published track is now ALWAYS enabled; mute state
      // lives in the Web Audio graph (micMuteGain), not on the track.
      // This previously set `.enabled = micOn`, which under the new model
      // would take the backing track off air on every republish whenever
      // the artist happened to be muted.
      //
      // The graph carries mute across a same-object republish by itself.
      // The track_ended_recreated branch above builds a WHOLE new graph,
      // though, so its micMuteGain starts at unity -- re-assert the
      // current toggle state against whichever handle we ended up with.
      trackToPublish.enabled = true;
      const nodesToSync = audioHandleRef.current?.nodes;
      if (nodesToSync) tuneMicMuted(nodesToSync, !micOn);
      await room.localParticipant.publishTrack(trackToPublish, {
        source: Track.Source.Microphone,
      });
      logHealthEvent('ensure_audio_published', { trigger, action });
    } catch (err) {
      logHealthEvent('ensure_audio_published', { trigger, action: 'failed', error: String(err?.message || err) });
    } finally {
      audioPublishInFlightRef.current = false;
    }
  }, [room, micOn]);

  // DEBUG (bug 2 investigation -- viewer stuck on main) -- viewer-side
  // only. Second link in the chain, between "did the SHOT_COMMAND arrive"
  // (the data-channel log below) and "[renderSlot] matched=...": is a
  // given camfeed's track actually subscribed/present for THIS viewer at
  // all right now. Logs the full camera-track list (identity, whether
  // LiveKit reports it subscribed, whether a real Track object is
  // attached yet -- isSubscribed can be true with track still briefly
  // undefined) whenever the SET or any entry's subscription state
  // changes, not every render.
  const trackSubDebugRef = useRef('');
  useEffect(() => {
    if (!CUT_DEBUG_ENABLED || role !== 'viewer') return;
    const signature = tracks
      .map((t) => `${t.participant.identity}:sub=${t.publication?.isSubscribed}:track=${!!t.publication?.track}`)
      .join('|');
    if (trackSubDebugRef.current === signature) return;
    trackSubDebugRef.current = signature;
    logCutDebug(`[tracks] camera tracks now: ${tracks.length === 0 ? '(none)' : tracks.map((t) => `${t.participant.identity}(sub=${t.publication?.isSubscribed},track=${!!t.publication?.track})`).join(', ')}`);
  }, [tracks, role]);

  // Phase 2 diagnostic instrumentation -- initialized as soon as this
  // device's own identity/role are known. Safe to call again if role
  // changes (e.g. this device just claimed a performer slot mid-session);
  // initHealthLog only updates context, never resets the queue.
  useEffect(() => {
    initHealthLog({
      showId: ROOM_NAME,
      participantIdentity: room.localParticipant.identity,
      role,
    });
  }, [room, role]);

  // Room + track lifecycle -> health_events (Phase 2). Log-only: never
  // reacts to any of these by changing show behavior. Attached once per
  // room instance (room is stable for the life of this connection).
  useEffect(() => {
    // Fix (b3) -- transport snapshots on the connection-lifecycle
    // anchors. room_connected is where pcManager SHOULD exist (Room.
    // connect() awaits waitForPCInitialConnection before emitting it),
    // so a snapshot here plus one at director start brackets the window
    // in which the engine is being torn down under us.
    function onConnected() { setRoomConnectionState(room.state); logHealthEvent('room_connected', { state: room.state, transport: describeTransport(room) }); }
    function onReconnecting() { setRoomConnectionState(room.state); logHealthEvent('room_reconnecting', { state: room.state }); }
    function onReconnected() {
      setRoomConnectionState(room.state);
      logHealthEvent('room_reconnected', { state: room.state });
      // Fix (a) (audio-reconnect round) -- a plain LiveKit-level
      // reconnect (RoomEvent.Reconnected, not fix (c)'s own explicit
      // disconnect+connect) was Phase 1's unverified case for whether
      // local track publications survive. Defensive either way:
      // ensureAudioPublished no-ops if the track's still there
      // (logged as 'already_published').
      ensureAudioPublished('room_reconnected');
    }
    function onDisconnected(reason) { setRoomConnectionState(room.state); logHealthEvent('room_disconnected', { state: room.state, reason: reason != null ? String(reason) : null, transport: describeTransport(room) }); }
    function onConnectionStateChanged(state) { setRoomConnectionState(state); logHealthEvent('room_connection_state_changed', { state: String(state) }); }

    function trackDetail(pubOrTrack, participant) {
      return {
        participantIdentity: participant?.identity ?? null,
        source: pubOrTrack?.source ?? null,
        kind: pubOrTrack?.kind ?? null,
        trackSid: pubOrTrack?.trackSid ?? pubOrTrack?.sid ?? null,
      };
    }
    function onLocalTrackPublished(pub, participant) { logHealthEvent('track_local_published', trackDetail(pub, participant)); }
    function onLocalTrackUnpublished(pub, participant) { logHealthEvent('track_local_unpublished', trackDetail(pub, participant)); }
    function onTrackPublished(pub, participant) { logHealthEvent('track_published', trackDetail(pub, participant)); }
    function onTrackUnpublished(pub, participant) { logHealthEvent('track_unpublished', trackDetail(pub, participant)); }
    function onTrackSubscribed(track, pub, participant) { logHealthEvent('track_subscribed', trackDetail(pub, participant)); }
    function onTrackUnsubscribed(track, pub, participant) { logHealthEvent('track_unsubscribed', trackDetail(pub, participant)); }
    function onTrackMuted(pub, participant) { logHealthEvent('track_muted', trackDetail(pub, participant)); }
    function onTrackUnmuted(pub, participant) { logHealthEvent('track_unmuted', trackDetail(pub, participant)); }

    room.on(RoomEvent.Connected, onConnected);
    room.on(RoomEvent.Reconnecting, onReconnecting);
    room.on(RoomEvent.Reconnected, onReconnected);
    room.on(RoomEvent.Disconnected, onDisconnected);
    room.on(RoomEvent.ConnectionStateChanged, onConnectionStateChanged);
    room.on(RoomEvent.LocalTrackPublished, onLocalTrackPublished);
    room.on(RoomEvent.LocalTrackUnpublished, onLocalTrackUnpublished);
    room.on(RoomEvent.TrackPublished, onTrackPublished);
    room.on(RoomEvent.TrackUnpublished, onTrackUnpublished);
    room.on(RoomEvent.TrackSubscribed, onTrackSubscribed);
    room.on(RoomEvent.TrackUnsubscribed, onTrackUnsubscribed);
    room.on(RoomEvent.TrackMuted, onTrackMuted);
    room.on(RoomEvent.TrackUnmuted, onTrackUnmuted);

    // Anchor point: this device's room state as observed at the moment
    // this listener attached (mount), so a rejoin's very first data point
    // doesn't depend on catching a live transition after the fact.
    logHealthEvent('room_state_at_mount', { state: room.state, transport: describeTransport(room) });

    return () => {
      room.off(RoomEvent.Connected, onConnected);
      room.off(RoomEvent.Reconnecting, onReconnecting);
      room.off(RoomEvent.Reconnected, onReconnected);
      room.off(RoomEvent.Disconnected, onDisconnected);
      room.off(RoomEvent.ConnectionStateChanged, onConnectionStateChanged);
      room.off(RoomEvent.LocalTrackPublished, onLocalTrackPublished);
      room.off(RoomEvent.LocalTrackUnpublished, onLocalTrackUnpublished);
      room.off(RoomEvent.TrackPublished, onTrackPublished);
      room.off(RoomEvent.TrackUnpublished, onTrackUnpublished);
      room.off(RoomEvent.TrackSubscribed, onTrackSubscribed);
      room.off(RoomEvent.TrackUnsubscribed, onTrackUnsubscribed);
      room.off(RoomEvent.TrackMuted, onTrackMuted);
      room.off(RoomEvent.TrackUnmuted, onTrackUnmuted);
    };
  }, [room, ensureAudioPublished]);

  const [camOn, setCamOn] = useState(true);
  const isCamFeed = typeof role === 'string' && role.startsWith('camfeed-');
  const [facingMode, setFacingMode] = useState(isCamFeed ? 'environment' : 'user');
  const [left, setLeft] = useState(false);
  const [comments, setComments] = useState([]);
  const [commentsExpanded, setCommentsExpanded] = useState(false);
  const [activeCamera, setActiveCamera] = useState({}); // slot -> identity of the live feed (generalized: no fixed a/b keys, any slot letter works as a plain lookup)
  const [activeShot, setActiveShot] = useState({}); // slot -> full SHOT_COMMAND (shot, transition, targetIdentity, params...)

  // Page lifecycle -> health_events (Phase 2). All roles -- a viewer's
  // dropout is as diagnostically useful as the performer's. audioContext
  // state (performer only, null otherwise) rides along on visibility
  // changes specifically because that's the documented moment mobile
  // Safari/Chrome suspend/resume an AudioContext.
  useEffect(() => {
    function onVisibilityChange() {
      logHealthEvent(document.visibilityState === 'hidden' ? 'visibility_hidden' : 'visibility_visible', {
        audioContextState: audioHandleRef.current?.audioContext?.state ?? null,
      });
    }
    function onPageHide() { logHealthEvent('page_hide', {}); }
    function onFocus() { logHealthEvent('window_focus', {}); }
    function onBlur() { logHealthEvent('window_blur', {}); }

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  // Phase 4 (redesign) -- mutual exclusivity between the three floating
  // content panels (SHOTS/AUDIO/VIDEO tech panel, comments, ADD CAMERA):
  // opening any one auto-collapses the other two, so their footprints
  // can never functionally compete for the same screen space even where
  // they're positioned close together. Not a hard lock -- each panel's
  // own control still opens/closes it individually at any time, it just
  // also nudges the other two shut. deckCollapsed lived in
  // BroadcastStage.jsx before this; moved here so it's a sibling of
  // commentsCollapsed/qrPanelOpen and all three can coordinate directly,
  // matching the existing pattern sidebarCollapsed already established
  // (owned by whichever component needs to coordinate it with siblings,
  // threaded down as a prop + setter). Defaults: deck starts collapsed,
  // comments starts open -- avoids an initial-load overlap without
  // either default feeling arbitrary (comments is the lighter-weight,
  // ambient one; SHOTS/AUDIO/VIDEO is opt-in when actually needed).
  const [deckCollapsed, setDeckCollapsed] = useState(true);
  const [commentsCollapsed, setCommentsCollapsed] = useState(false);
  const [qrPanelOpen, setQrPanelOpen] = useState(false);

  // Bug fix: the original version of this only handled the OPENING side
  // of deck/QR (auto-collapse comments) and never restored comments when
  // the thing that displaced it closed again -- exactly the reported
  // symptom ("comment disappears once I maximize tech panel and I cannot
  // seem to bring it back"). Fixed with an explicit "was this collapse
  // the artist's OWN action, or a side effect of something else taking
  // the spotlight" flag -- distinguishing those needs its own bit,
  // there's no way to infer it from commentsCollapsed alone. Only
  // toggleCommentsCollapsed (the artist's own control) ever sets this;
  // the auto-collapse branches below never do, so it correctly survives
  // across any number of auto-collapse/auto-restore cycles until the
  // artist explicitly touches comments' own arrow again.
  const commentsManuallyHiddenRef = useRef(false);

  const toggleDeckCollapsed = useCallback(() => {
    setDeckCollapsed((prev) => {
      const next = !prev;
      if (!next) {
        // Opening -- auto-collapse comments/QR (mutual exclusivity).
        setCommentsCollapsed(true);
        setQrPanelOpen(false);
      } else if (!commentsManuallyHiddenRef.current) {
        // Closing -- pop comments back up, UNLESS the artist had
        // deliberately minimized it themselves (that's a real,
        // requested exception, not an oversight).
        setCommentsCollapsed(false);
      }
      return next;
    });
  }, []);

  const toggleCommentsCollapsed = useCallback(() => {
    setCommentsCollapsed((prev) => {
      const next = !prev;
      commentsManuallyHiddenRef.current = next;
      if (!next) {
        setDeckCollapsed(true);
        setQrPanelOpen(false);
      }
      return next;
    });
  }, []);

  const toggleQrPanel = useCallback(() => {
    setQrPanelOpen((prev) => {
      const next = !prev;
      if (next) {
        setDeckCollapsed(true);
        setCommentsCollapsed(true);
      } else if (!commentsManuallyHiddenRef.current) {
        setCommentsCollapsed(false);
      }
      return next;
    });
  }, []);

  // Mobile declutter (post-Stage-5 fix, MULTI_PERFORMER_SPEC.md) -- the
  // feeds strip and device controls collapse INDEPENDENTLY of each
  // other and of the deck/comments/QR group above: they occupy a
  // completely separate screen region (the shared bottom band split
  // left/right, mobile only), so there's no footprint competition to
  // coordinate. Both default open.
  const [feedsCollapsed, setFeedsCollapsed] = useState(false);
  const [controlsCollapsed, setControlsCollapsed] = useState(false);
  const toggleFeedsCollapsed = useCallback(() => setFeedsCollapsed((v) => !v), []);
  const toggleControlsCollapsed = useCallback(() => setControlsCollapsed((v) => !v), []);

  // Matching half of the outer LiveDemo's own sidebar-collapse effect --
  // entering fullscreen declutters these three too, once, on the
  // FALSE->TRUE transition only.
  const prevMaximizedForPanelsRef = useRef(maximized);
  useEffect(() => {
    if (maximized && !prevMaximizedForPanelsRef.current) {
      setDeckCollapsed(true);
      setCommentsCollapsed(true);
      setQrPanelOpen(false);
    }
    prevMaximizedForPanelsRef.current = maximized;
  }, [maximized]);

  // Generalized off the a/b whitelist (MULTI_PERFORMER_SPEC.md's
  // generalization pass) -- this was the actual root cause of the
  // slot-c-falls-through-to-viewer bug: a successful claim sets role to
  // whatever slot letter the server resolved (Stage 3's
  // handleClaimAndGoLive), but this check only ever recognized 'a'/'b'.
  // `role` only ever holds a raw slot letter AFTER a successful claim;
  // before that (or for viewers/camfeed) it's one of the three known
  // sentinels below.
  const isMainPerformer = role !== 'viewer' && role !== 'performer' && !role.startsWith('camfeed-');
  const camFeedSlot = isCamFeed ? role.split('-')[1] : null;

  // Fix (c) (SHOW-1 diagnosis round) -- publish-failure recovery.
  // Root cause (confirmed against the compiled livekit-client source):
  // RTCEngine.ensurePublisherConnected() memoizes its connection-
  // establishment promise in this.publisherConnectionPromise on first
  // call and never resets it except via a transport onStateChange
  // callback that never gets attached if the very first call failed
  // because pcManager wasn't constructed yet. Once poisoned, EVERY
  // subsequent publishData call on that engine replays the same cached
  // rejection forever, regardless of room.state genuinely reading
  // 'connected' -- confirmed against a real health_events capture from
  // the main-performer-refresh test (shot_publish_failure with
  // connectionState:"connected" repeating for 2+ minutes, including
  // decisionSource:"human" taps).
  //
  // The only way to clear it is a fresh RTCEngine -- confirmed via
  // Room.maybeCreateEngine()/recreateEngine() in the SDK source: a
  // proper room.disconnect() followed by room.connect() on this SAME
  // Room object (not a new React-level LiveKitRoom mount) creates a
  // genuinely new engine with a fresh, unpoisoned
  // publisherConnectionPromise. Staying on the same Room/RoomInner
  // instance is also what makes "preserve show/session state" free --
  // role, sessionToken, activeShot, audioNodes/audioContext (soundcheck
  // tuning) all live in this component's own state, untouched by a
  // reconnect on the room object underneath it.
  //
  // Known, accepted side effect this round (audio fix explicitly
  // deferred -- see the Part 3 finding): a reconnect re-fires
  // RoomEvent.SignalConnected, which LiveKitRoom's own internal handler
  // uses to call setMicrophoneEnabled(audio prop) -- audio={false} here
  // means an already-published processed audio track gets muted again,
  // and nothing re-publishes it (same gap Phase 1 found for a plain
  // network-blip reconnect). A recovery here can therefore interrupt
  // audio as a side effect of fixing video-shot delivery. Not fixed in
  // this round by design; flagged so it isn't mistaken for a new bug
  // when observed during testing.
  const publishRecoveryStateRef = useRef({ consecutiveFailures: 0, recoveryAttempted: false, automaticRecoveries: 0 });
  const [publishWarning, setPublishWarning] = useState(false);
  const [recoveringPublish, setRecoveringPublish] = useState(false);

  const attemptPublishRecovery = useCallback(async (trigger) => {
    if (!connToken || !connServerUrl) return; // shouldn't happen once joined, but never throw into a click handler
    // Fix (b6.3) -- a recovery fired while the room is not Connected
    // cannot help and actively PRESERVES the damage. Confirmed in the
    // SDK: Room.maybeCreateEngine() reuses the existing engine whenever
    // it is `!isClosed`, and an engine that is mid-connect is not
    // closed -- so disconnect()/connect() racing an in-flight connect
    // hands the SAME engine, poisoned publisherConnectionPromise and
    // all, to the connection that eventually succeeds. That is exactly
    // how the 15:46 capture ended up Connected on an already-poisoned
    // engine, with every later publishData replaying one 10-second-old
    // rejection.
    //
    // Only a recovery that starts from Connected gets a clean engine:
    // disconnect() closes it (isClosed true), so the following connect()
    // constructs a genuinely new RTCEngine with a fresh memo.
    if (room.state !== ConnectionState.Connected) {
      logHealthEvent('publish_recovery_skipped', {
        trigger,
        reason: 'not_connected',
        connectionState: String(room.state),
        transport: describeTransport(room),
      });
      return;
    }
    setRecoveringPublish(true);
    logHealthEvent('publish_recovery_attempt', { trigger, connectionState: room.state });
    try {
      await room.disconnect();
      await room.connect(connServerUrl, connToken);
      logHealthEvent('publish_recovery_outcome', { trigger, outcome: 'reconnected', connectionState: room.state });
      // Fix (a) (audio-reconnect round) -- confirmed by a real capture
      // that this disconnect()/connect() cycle unpublishes the processed
      // audio track (track_local_unpublished, kind:"audio") and nothing
      // else ever republishes it. Awaited, not fire-and-forget, so
      // publish_recovery_outcome's timestamp reflects video+data+audio
      // all being handled, not just the room connection.
      await ensureAudioPublished(trigger === 'auto' ? 'recovery_auto' : 'recovery_manual');
      // Reset the counter so the NEXT publish attempt gets a clean read --
      // whether the recovery actually fixed things is confirmed by that
      // next shot_publish_success/failure, not assumed here.
      publishRecoveryStateRef.current.consecutiveFailures = 0;
    } catch (err) {
      logHealthEvent('publish_recovery_outcome', { trigger, outcome: 'failed', error: String(err?.message || err) });
      setPublishWarning(true);
    } finally {
      setRecoveringPublish(false);
    }
  }, [room, connToken, connServerUrl, ensureAudioPublished]);

  // ─── Fix (b1): start-sequence pre-flight ────────────────────
  // The first auto cut must never be the thing that DISCOVERS a poisoned
  // publisher. Two consecutive fresh-session shows failed at the first
  // cut ~7s after room_connected with 'PC manager is closed', which
  // means (a) every recording opened with a recovery hole in it, and (b)
  // the show's single automatic recovery was spent in its first ten
  // seconds, leaving only the manual banner for the rest of the show.
  //
  // This probes the EXACT publishData path the director uses, before the
  // director starts and before egress is told to record. A clean engine
  // costs one already-connected round trip. A poisoned one is recovered
  // here, pre-recording, where a reconnect costs nothing anyone is
  // watching -- and, because attemptPublishRecovery builds a fresh
  // RTCEngine, it clears the memoized publisherConnectionPromise that
  // the SDK itself never clears (see lib/transportDiagnostics.js).
  //
  // Memoized on a ref, not just guarded: BOTH the director effect and
  // the SHOW_LIVE/egress effect await this, and they must share one
  // probe rather than each firing their own. Deliberately never rejects
  // -- callers .then() it and proceed regardless, because failing to
  // start the show is strictly worse than starting it with the warning
  // banner up.
  const preflightActiveRef = useRef(false);
  const startPreflightRef = useRef(null);

  const runStartPreflight = useCallback(() => {
    if (startPreflightRef.current) return startPreflightRef.current;
    const promise = (async () => {
      preflightActiveRef.current = true;
      // Fix (b6.1/b6.4) -- wait for Connected BEFORE probing, and make
      // the wait itself visible in the timeline. start_preflight_begin
      // is deliberately emitted AFTER the wait resolves, so a healthy
      // capture reads room_connected -> start_preflight_begin in that
      // order; seeing it the other way round again means this gate has
      // failed and nothing downstream should be trusted.
      if (room?.state !== ConnectionState.Connected) {
        logHealthEvent('start_preflight_waiting', {
          roomState: room?.state ? String(room.state) : null,
          transport: describeTransport(room),
        });
      }
      const connectWait = await waitForRoomConnected(room);
      logHealthEvent('start_preflight_begin', {
        waited: connectWait.waited,
        timedOut: connectWait.timedOut,
        transport: describeTransport(room),
      });
      // Never connected within the backstop: probing now would repeat
      // the exact mistake this fix exists to remove -- publishing into a
      // transport that does not exist, poisoning the memo for whenever
      // the connection DOES land. Bail without touching publishData, and
      // let the show start with the warning banner.
      if (connectWait.timedOut) {
        logHealthEvent('start_preflight_outcome', {
          outcome: 'skipped_not_connected',
          recovered: false,
          transport: describeTransport(room),
        });
        setPublishWarning(true);
        preflightActiveRef.current = false;
        return { ok: false, recovered: false };
      }
      try {
        try {
          await probeWithTimeout(room);
          logHealthEvent('start_preflight_outcome', {
            outcome: 'clean',
            recovered: false,
            transport: describeTransport(room),
          });
          return { ok: true, recovered: false };
        } catch (firstErr) {
          logHealthEvent('start_preflight_probe_failed', {
            error: String(firstErr?.message || firstErr),
            transport: describeTransport(room),
          });
          await attemptPublishRecovery('preflight');
          try {
            await probeWithTimeout(room);
            logHealthEvent('start_preflight_outcome', {
              outcome: 'recovered',
              recovered: true,
              transport: describeTransport(room),
            });
            return { ok: true, recovered: true };
          } catch (secondErr) {
            logHealthEvent('start_preflight_outcome', {
              outcome: 'failed',
              recovered: true,
              error: String(secondErr?.message || secondErr),
              transport: describeTransport(room),
            });
            setPublishWarning(true);
            return { ok: false, recovered: true };
          }
        }
      } finally {
        // The pre-flight's own probe failure is not the show's first
        // failure -- start the show on a clean counter either way, so
        // the in-show 3-failure threshold measures the SHOW.
        publishRecoveryStateRef.current.consecutiveFailures = 0;
        preflightActiveRef.current = false;
      }
    })();
    startPreflightRef.current = promise;
    return promise;
  }, [room, attemptPublishRecovery]);

  // Timing accelerant (audio-reconnect round) -- a real capture showed 3
  // consecutive failures taking 53s wall-clock to accumulate, purely
  // because the director's own cuts are spaced 9-18s apart
  // (autoDirector.js's HOLD_RANGE_MS), not because of retries. During
  // that whole window viewers see nothing and the performer isn't told.
  // On the FIRST failure of an episode, schedules two small probe
  // publishes (not real shots -- see publishHealthProbe) to reach the
  // 3-failure threshold in ~4-6s instead. Capped at exactly two per
  // episode; cancelled the instant a real publish succeeds (episode
  // resolved on its own) or the threshold is reached (no longer needed).
  const probeTimersRef = useRef([]);

  useEffect(() => {
    if (!isMainPerformer) return undefined;

    function clearProbeTimers() {
      probeTimersRef.current.forEach(clearTimeout);
      probeTimersRef.current = [];
    }

    function scheduleProbes() {
      clearProbeTimers(); // never stack multiple episodes
      logHealthEvent('health_probe_episode_started', {});
      [2000, 4000].forEach((delay) => {
        const id = setTimeout(() => {
          publishHealthProbe(room).catch(() => {}); // outcome already logged/notified inside publishHealthProbe -- swallow here so it never becomes an unhandled rejection
        }, delay);
        probeTimersRef.current.push(id);
      });
    }

    const unsubscribe = onPublishOutcome(({ success, connectionState }) => {
      const state = publishRecoveryStateRef.current;
      // Fix (b1) -- while the pre-flight runs it OWNS the recovery
      // decision. Its own probe failure would otherwise open an episode
      // here, whose scheduled probes (2s/4s) would reach the threshold
      // and fire a second, concurrent recovery straight into the one the
      // pre-flight is already awaiting.
      if (preflightActiveRef.current) return;
      if (success) {
        const hadFailures = state.consecutiveFailures > 0;
        state.consecutiveFailures = 0;
        setPublishWarning(false);
        if (hadFailures) {
          clearProbeTimers(); // real recovery happened on its own -- no need to probe
          // Fix (b2) -- an episode that RESOLVES releases the automatic
          // recovery for the next one. Previously recoveryAttempted was
          // set once at 1524 and reset nowhere, so it was effectively
          // once-per-mount: the first episode of a show consumed the
          // entire automatic budget and every later episode fell
          // straight through to the manual banner, however healthy the
          // connection had been in between.
          state.recoveryAttempted = false;
          logHealthEvent('publish_episode_resolved', {
            automaticRecoveriesUsed: state.automaticRecoveries,
          });
        }
        return;
      }
      const wasFirstFailure = state.consecutiveFailures === 0;
      state.consecutiveFailures += 1;
      if (wasFirstFailure && connectionState === ConnectionState.Connected) {
        scheduleProbes();
      }
      if (state.consecutiveFailures < 3) return;
      clearProbeTimers(); // threshold reached -- no more probes needed for this episode
      if (state.recoveryAttempted) {
        // Already used the one automatic attempt -- per spec, no further
        // automatic retries. Surface the persistent warning instead.
        setPublishWarning(true);
        return;
      }
      if (connectionState !== ConnectionState.Connected) return; // trigger is scoped to "connected but failing", not a visible disconnect
      // Fix (b2) -- the per-episode reset above is bounded here. Without
      // this cap, a connection that fails and resolves repeatedly could
      // reconnect on its own forever, and every one of those interrupts
      // the performer's audio.
      if (state.automaticRecoveries >= MAX_AUTOMATIC_RECOVERIES) {
        setPublishWarning(true);
        logHealthEvent('publish_recovery_capped', {
          automaticRecoveriesUsed: state.automaticRecoveries,
          transport: describeTransport(room),
        });
        return;
      }
      state.recoveryAttempted = true;
      state.automaticRecoveries += 1;
      attemptPublishRecovery('auto');
    });
    return () => {
      unsubscribe();
      clearProbeTimers();
    };
  }, [isMainPerformer, attemptPublishRecovery, room]);

  // Phase 2 diagnostic instrumentation -- OS/browser-level audio input
  // device changes (e.g. a Bluetooth headset connecting/disconnecting, or
  // the OS default input switching). 'devicechange' itself doesn't say
  // WHICH device changed or what's currently active -- that's why the mic
  // level sampler below also logs the active deviceId/label on every
  // sample; this event's job is just "something changed, here is the
  // device list at that moment" for correlation against a silence window.
  useEffect(() => {
    if (!isMainPerformer || typeof navigator === 'undefined' || !navigator.mediaDevices) return undefined;
    async function onDeviceChange() {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioInputs = devices
          .filter((d) => d.kind === 'audioinput')
          .map((d) => ({ deviceId: d.deviceId, label: d.label || null }));
        logHealthEvent('audio_devicechange', { audioInputs });
      } catch {
        logHealthEvent('audio_devicechange', { audioInputs: null });
      }
    }
    navigator.mediaDevices.addEventListener('devicechange', onDeviceChange);
    return () => navigator.mediaDevices.removeEventListener('devicechange', onDeviceChange);
  }, [isMainPerformer]);

  // Phase 2 diagnostic instrumentation -- mic-level sampling. Reads
  // outputAnalyser/inputAnalyser (lib/audioProcessing.js's own metering
  // taps, already wired in parallel to the signal path -- see that
  // file's comments) so this never adds a new tap to the graph, only
  // reads existing ones. Output RMS is what's actually published
  // (destination.stream, i.e. what a viewer would hear); input RMS is
  // the pre-processing raw mic level, logged alongside it so a silent
  // OUTPUT with a live INPUT points at the processing chain, not capture.
  const micSilenceStateRef = useRef({ silentSince: null, loggedSilent: false });
  useEffect(() => {
    if (!isMainPerformer || !audioNodes) return undefined;
    const SILENCE_RMS_THRESHOLD = 0.001;
    const SILENCE_LOG_AFTER_MS = 10_000;
    const outputBuf = new Float32Array(audioNodes.outputAnalyser.fftSize);
    const inputBuf = new Float32Array(audioNodes.inputAnalyser.fftSize);

    function rms(analyser, buf) {
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      return Math.sqrt(sum / buf.length);
    }

    const id = setInterval(() => {
      const outputRms = rms(audioNodes.outputAnalyser, outputBuf);
      const inputRms = rms(audioNodes.inputAnalyser, inputBuf);
      const rawTrack = audioHandleRef.current?.rawStream?.getAudioTracks?.()[0] ?? null;
      const settings = rawTrack?.getSettings?.() ?? {};
      const audioContextState = audioHandleRef.current?.audioContext?.state ?? null;

      logHealthEvent('mic_level_sample', {
        outputRms,
        inputRms,
        audioContextState,
        deviceId: settings.deviceId ?? null,
        deviceLabel: rawTrack?.label ?? null,
      });

      const state = micSilenceStateRef.current;
      if (outputRms < SILENCE_RMS_THRESHOLD) {
        if (state.silentSince == null) state.silentSince = Date.now();
        if (!state.loggedSilent && Date.now() - state.silentSince >= SILENCE_LOG_AFTER_MS) {
          state.loggedSilent = true;
          logHealthEvent('mic_silent', {
            outputRms,
            inputRms,
            audioContextState,
            silentSinceMs: state.silentSince,
          });
        }
      } else if (state.silentSince != null) {
        if (state.loggedSilent) {
          logHealthEvent('mic_recovered', {
            outputRms,
            inputRms,
            audioContextState,
            silentDurationMs: Date.now() - state.silentSince,
          });
        }
        state.silentSince = null;
        state.loggedSilent = false;
      }
    }, 5000);

    return () => clearInterval(id);
  }, [isMainPerformer, audioNodes]);

  // Stage 1 of the portrait capture work -- what the local camera is
  // ACTUALLY delivering right now, read live off the real track, never
  // assumed from role/device. Debug-only surface for verifying capture
  // on real hardware.
  const myCameraPublication = room.localParticipant.getTrackPublication(Track.Source.Camera);
  const sourceDims = useSourceDimensions(myCameraPublication);

  // Portrait-everything work -- auto-attaches createPortraitProcessor
  // (lib/rotationProcessor.js) whenever this device's OWN camera is
  // landscape (a laptop webcam or capture card standing in for a
  // contestant), so its published track becomes genuinely portrait, not
  // just displayed that way. No manual UI here unlike CamPage.jsx's
  // rotation picker -- LiveDemo's own camera has no by-eye rotation
  // problem to correct, this is purely the auto crop (degrees=0). A
  // native-portrait phone (the common case) never resolves isLandscape
  // true, so this effect is a no-op for it -- zero processor, zero cost.
  // Keyed on trackSid (not a single latch) so a facingMode toggle or
  // device change that lands on a different-shaped source re-decides.
  // implausibleAspect: this source's raw dims claimed portrait but
  // matched no real camera aspect ratio -- see useNativeIsLandscape's
  // own comment. Drives the acquisition-side re-request effect below
  // (landscapeNativeCaptureOptions), not the crop processor -- a
  // downstream resample was tried and overcorrected on real hardware
  // (Sony via capture card: faces went from narrow to stretched wide).
  const { isLandscape, implausibleAspect } = useNativeIsLandscape(myCameraPublication);
  const myCameraTrackSid = myCameraPublication?.trackSid;
  const autoPortraitTrackSidRef = useRef(null);
  useEffect(() => {
    if (isLandscape !== true) return undefined;
    const trackSid = myCameraTrackSid;
    if (!trackSid || autoPortraitTrackSidRef.current === trackSid) return undefined;
    autoPortraitTrackSidRef.current = trackSid;
    let cancelled = false;
    (async () => {
      const videoTrack = myCameraPublication?.videoTrack;
      if (!videoTrack) return;
      try {
        const processor = createPortraitProcessor(0);
        await videoTrack.setProcessor(processor, true);
      } catch (e) {
        // Confirmed against the compiled SDK source (same as CamPage's
        // rotation failure handling): setProcessor only replaces the
        // published track after init() resolves, so a failure here
        // never touches what's already publishing -- the raw landscape
        // track keeps flowing uncropped rather than dropping.
        if (!cancelled) console.error('[portrait] crop processor failed to attach', e);
      }
    })();
    return () => {
      cancelled = true;
    };
    // myCameraPublication deliberately omitted -- it's a fresh object
    // reference every render (getTrackPublication() isn't memoized), so
    // depending on it would re-run this effect constantly; myCameraTrackSid
    // is the stable identity that actually matters, same pattern
    // useTrackAspect/useNativeIsLandscape key their own effects on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLandscape, myCameraTrackSid]);

  // Acquisition-side fix for a squeezed source -- see the matching
  // effect + comment in CamPage.jsx for the real-hardware reasoning
  // (Sony via capture card) this avoids re-litigating here. Same latch
  // pattern as autoPortraitTrackSidRef above: one re-acquire attempt per
  // trackSid, not a retry loop.
  const reacquiredForSqueezeRef = useRef(null);
  useEffect(() => {
    if (!implausibleAspect) return;
    const trackSid = myCameraTrackSid;
    if (!trackSid || reacquiredForSqueezeRef.current === trackSid) return;
    reacquiredForSqueezeRef.current = trackSid;
    const videoTrack = myCameraPublication?.videoTrack;
    const mst = videoTrack?.mediaStreamTrack;
    if (!videoTrack || !mst) return;
    videoTrack.restartTrack(landscapeNativeCaptureOptions(mst)).catch((e) => {
      console.error('[portrait] landscape re-acquire failed', e);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [implausibleAspect, myCameraTrackSid]);

  // Counts RoomEvent.SignalConnected occurrences (Part 3) and, per fix
  // (b), re-asserts our desired audio state on every occurrence --
  // confirmed against the compiled @livekit/components-react source that
  // LiveKitRoom's own SignalConnected handler calls
  // localParticipant.setMicrophoneEnabled(false) here (audio={false} is
  // passed unconditionally), which mutes an already-published track it
  // doesn't know is ours. Rather than fight LiveKitRoom to stop calling
  // that (not controllable without dropping audio={false}, which would
  // make it try to acquire its OWN raw mic track instead -- not what we
  // want given the Case 2 processing chain), this listener runs after
  // LiveKitRoom's (registered earlier, in the parent component) and
  // simply re-asserts: republish if missing (ensureAudioPublished), then
  // unmute if muted and the performer's own toggle says it should be on.
  // The unmute itself isn't separately logged here -- it fires
  // RoomEvent.TrackUnmuted, already captured generically by the room+
  // track lifecycle effect's onTrackUnmuted above.
  const signalConnectedCountRef = useRef(0);
  useEffect(() => {
    if (!isMainPerformer) return undefined;
    async function onSignalConnected() {
      signalConnectedCountRef.current += 1;
      logHealthEvent('signal_connected', {
        occurrence: signalConnectedCountRef.current,
        transport: describeTransport(room),
      });
      await ensureAudioPublished('signal_connected');
      const pub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
      // Fix (2c) -- no longer conditional on micOn. Under the new model
      // OUR mute lives in the audio graph, so a muted PUBLICATION here is
      // never ours: it is LiveKitRoom's own SignalConnected handler
      // calling setMicrophoneEnabled(false) (see this effect's header).
      // Leaving it muted whenever the artist happened to be mic-muted
      // would take the backing track off air too, and would survive the
      // artist un-muting.
      //
      // Fix (1b) -- except once the show has ended, where a muted
      // publication is deliberate and must stay that way.
      if (pub?.isMuted && !showEndedRef.current) {
        pub.unmute();
      }
    }
    room.on(RoomEvent.SignalConnected, onSignalConnected);
    return () => room.off(RoomEvent.SignalConnected, onSignalConnected);
  }, [isMainPerformer, room, ensureAudioPublished]);

  // Only the main performer publishes the Case 2 processed audio track.
  // Extra camera-feed devices are video-only, never audio.
  useEffect(() => {
    if (!isMainPerformer) return;
    (async () => {
      const handle = await createPilotAudioTrack();
      audioHandleRef.current = handle;
      // audioHandleRef is a ref, not state -- setting it alone doesn't
      // trigger a re-render, so AudioDeckPanel (rendered via SwipePages in
      // BroadcastStage.jsx) would never see the live Web Audio nodes once
      // the async setup above resolves.
      // This state mirror is what actually gets them there. audioContext
      // is needed too now, for BackingTrackPanel to decode/play a file
      // into the same graph.
      setAudioNodes(handle.nodes);
      setAudioContext(handle.audioContext);

      // Phase 2 diagnostic instrumentation (log-only, see
      // attachAudioTrackHealthListeners above) -- taps both the raw
      // capture track and the published track for 'ended'/'mute'/'unmute',
      // and the AudioContext for state transitions. None of this changes
      // what's captured, processed, or published.
      detachAudioTrackHealthListenersRef.current = attachAudioTrackHealthListeners(
        handle.rawStream?.getAudioTracks?.()[0] ?? null,
        handle.processedTrack
      );
      handle.audioContext.onstatechange = () => {
        logHealthEvent('audiocontext_statechange', { state: handle.audioContext.state });
      };

      // Phase 2 diagnostic instrumentation (SHOW-1 diagnosis round, Part
      // 3) -- logging only, per explicit scope: the audio={false}-vs-
      // manual-publish conflict found this round is NOT fixed here. This
      // wraps the existing publishTrack call with timing/outcome logging
      // and rethrows exactly as before (an unhandled rejection on this
      // un-awaited IIFE, same as pre-existing behavior) so control flow
      // is unchanged either way -- the absence of track_local_published
      // previously left no direct signal that this call itself hung or
      // rejected; this closes that gap.
      // Fix (1b) -- this effect publishes DIRECTLY rather than through
      // ensureAudioPublished, so it needs its own copy of the guard.
      // Checked here, after the createPilotAudioTrack() await, because
      // the show can end during graph construction -- and because a
      // performer rejoining an already-ended show reaches this line with
      // the ended teardown having already run and found nothing to stop.
      // Without this, either case puts the mic back on air.
      if (showEndedRef.current) {
        logHealthEvent('audio_publish_attempt', { action: 'skipped_show_ended' });
        return;
      }
      const publishStartedAt = Date.now();
      logHealthEvent('audio_publish_attempt', {});
      try {
        await room.localParticipant.publishTrack(handle.processedTrack, {
          source: Track.Source.Microphone,
        });
        logHealthEvent('audio_publish_success', { durationMs: Date.now() - publishStartedAt });
      } catch (err) {
        logHealthEvent('audio_publish_failure', {
          durationMs: Date.now() - publishStartedAt,
          error: String(err?.message || err),
        });
        throw err;
      }
    })();
    return () => {
      detachAudioTrackHealthListenersRef.current?.();
      detachAudioTrackHealthListenersRef.current = null;
      if (audioHandleRef.current) {
        if (audioHandleRef.current.audioContext) audioHandleRef.current.audioContext.onstatechange = null;
        room.localParticipant.unpublishTrack(audioHandleRef.current.processedTrack);
      }
    };
  }, [isMainPerformer, room]);

  // Fix (2b) -- mutes the MIC inside the Web Audio graph rather than
  // disabling the published track. The published track is the graph's
  // combined output (vocals + backing track), so `track.enabled = false`
  // -- what this did before -- took the backing track off air too, which
  // is never what "mute my mic" means mid-performance.
  const toggleMic = useCallback(() => {
    const nodes = audioHandleRef.current?.nodes;
    if (!nodes) return;
    const nextMicOn = !micOn;
    tuneMicMuted(nodes, !nextMicOn);
    setMicOn(nextMicOn);
    logHealthEvent('mic_mute_toggled', { micOn: nextMicOn });
  }, [micOn]);

  const toggleCam = useCallback(async () => {
    await room.localParticipant.setCameraEnabled(!camOn);
    setCamOn((v) => !v);
  }, [camOn, room]);

  // Clean live swap: replaceTrack under the hood via LocalVideoTrack.restartTrack,
  // no unpublish/republish and no renegotiation, so viewers see a straight cut
  // rather than a freeze or a drop.
  const toggleFacingMode = useCallback(async () => {
    const videoTrack = room.localParticipant.getTrackPublication(Track.Source.Camera)?.videoTrack;
    if (!videoTrack) return;
    const next = facingMode === 'user' ? 'environment' : 'user';
    await videoTrack.restartTrack({ facingMode: next, ...HIGH_RES_VIDEO_CAPTURE });
    setFacingMode(next);
  }, [facingMode, room]);

  const leaveCall = useCallback(() => {
    room.disconnect();
    setLeft(true);
  }, [room]);

  // SHOW_LIVE/SHOW_ENDED receipt (SHOW_LIFECYCLE_SPEC.md 3a/L3) -- belt-
  // and-braces sync for clients whose own cached `show` row hasn't
  // caught up yet (see displayShowState below). Once true, stays true
  // for the rest of this device's session; there's no path back to an
  // earlier phase within one show.
  const [receivedShowLive, setReceivedShowLive] = useState(false);
  const [receivedShowEnded, setReceivedShowEnded] = useState(false);

  // Comments and camera-switch signals travel as data messages,
  // distinguished by `type`. Camera-feed devices have canPublishData:
  // false server-side, so they never send any of these -- they can still
  // receive, which is harmless and unused by their UI.
  const { send } = useDataChannel((msg) => {
    const text = new TextDecoder().decode(msg.payload);
    let payload;
    try { payload = JSON.parse(text); } catch { return; }

    if (payload.type === 'comment') {
      setComments((prev) => [...prev, payload.comment]);
    }
    if (payload.type === 'SHOT_COMMAND') {
      // DEBUG (bug 2 investigation -- viewer stuck on main) -- viewer-side
      // only. First link in the chain: did the SHOT_COMMAND actually
      // arrive over the data channel at all. If a director cuts to a
      // camfeed and this line never appears, it's a delivery problem
      // (data channel / reliability), not a match-logic problem -- no
      // point looking at renderSlot's matched=false if the command never
      // showed up here in the first place.
      if (CUT_DEBUG_ENABLED && role === 'viewer') {
        logCutDebug(`[dataChannel] SHOT_COMMAND received: slot=${payload.slot} shot=${payload.shot} targetIdentity=${payload.targetIdentity || 'none'} transition=${payload.transition}`);
      }
      setActiveShot((prev) => ({ ...prev, [payload.slot]: payload }));
    }
    if (payload.type === 'SHOW_LIVE') {
      setReceivedShowLive(true);
    }
    if (payload.type === 'SHOW_ENDED') {
      setReceivedShowEnded(true);
    }
    if (payload.type === 'ACTIVE_PERFORMER_SWITCH') {
      // Stage 4 (MULTI_PERFORMER_SPEC.md section 5) -- this message is
      // NEVER applied directly. shows.active_performer_slot (written
      // only by the session-token-checked server route) is the sole
      // source of truth; this is just a low-latency nudge to re-fetch
      // it now instead of waiting for the next poll. A forged broadcast
      // (still possible -- canPublishData is unchanged) triggers a
      // harmless re-fetch of the real value, nothing more.
      console.log('[active-performer] poke received, refetching');
      onRefetchShow?.();
    }
  });

  // effectiveState can only derive 'live' from a cached 'soundcheck' row,
  // and the receiving client won't necessarily have picked that up yet
  // (see the L1 polling fix) -- so treat EITHER the local derivation OR
  // a SHOW_LIVE/SHOW_ENDED receipt as authoritative, per 3a. 'ended'
  // wins over everything else; it's the only terminal state.
  const displayShowState = receivedShowEnded
    ? 'ended'
    : receivedShowLive
      ? 'live'
      : showState;

  // ─── Fix (1a/1b): take the mic off air when the show ends ──────
  // END SHOW previously updated show state, broadcast SHOW_ENDED and
  // stopped egress -- but never touched the published audio track, which
  // stayed live until the artist happened to click Leave. Anything said
  // off-air in that window went out to every viewer still in the room.
  // A privacy defect, and the reason this runs at the SOURCE: it must not
  // depend on every client choosing to stop rendering.
  //
  // Mute first, then unpublish. Muting is immediate and local; unpublish
  // is the authoritative removal but involves a round trip, so doing it
  // in that order means the audio is off air at the earliest possible
  // moment even if the unpublish is slow or fails outright.
  //
  // Keyed on displayShowState, so a versus show's non-director performer
  // stops on the SHOW_ENDED broadcast too, not only on its own clock.
  useEffect(() => {
    showEndedRef.current = displayShowState === 'ended';
  }, [displayShowState]);

  const audioStoppedForEndRef = useRef(false);
  useEffect(() => {
    // Fix (1d) -- runs for EVERY publishing role, not just the main
    // performer. Camfeed devices publish camera too, and they learn the
    // show ended from the same SHOW_ENDED broadcast, so a main-performer-
    // only guard would leave every extra camera transmitting after End
    // Show. The audio half below simply finds nothing on a camfeed (they
    // are video-only by construction) and no-ops.
    if (role === 'viewer') return;
    if (displayShowState !== 'ended' || audioStoppedForEndRef.current) return;
    audioStoppedForEndRef.current = true;
    (async () => {
      const handle = audioHandleRef.current;
      try {
        const pub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
        if (pub && !pub.isMuted) pub.mute();
        if (handle?.processedTrack) {
          await room.localParticipant.unpublishTrack(handle.processedTrack);
        }
        logHealthEvent('audio_stopped_on_show_end', { hadPublication: !!pub });

        // Fix (1d) -- the camera keeps TRANSMITTING after End Show for the
        // same reason the mic did: nothing stopped it. Viewers merely stop
        // rendering it (the ended card replaces the stage), which is not
        // the same thing as being off air.
        //
        // `stopOnUnpublish: false` -- stop the transmission, leave the
        // local MediaStreamTrack alive. Stopping transmission and stopping
        // the DEVICE are two different operations, and this is the first
        // place that distinction is drawn explicitly in the code. It is
        // the same distinction the planned broadcast window is built on
        // (docs/BUILD_AUDIT_2026-08.md G.1): camera fully functional
        // locally, zero publishing outside Go Live -> End Show.
        const camPub = room.localParticipant.getTrackPublication(Track.Source.Camera);
        if (camPub?.track) {
          await room.localParticipant.unpublishTrack(camPub.track, false);
        }
        onBroadcastEnded?.();
        logHealthEvent('video_stopped_on_show_end', { hadPublication: !!camPub });
      } catch (err) {
        // Never let this throw into the ended transition -- the mute
        // above has almost certainly already taken the audio off air.
        logHealthEvent('audio_stopped_on_show_end', { action: 'failed', error: String(err?.message || err) });
      }
    })();
  }, [role, displayShowState, room]);

  // 'ended' has no other fallback path: L1's polling stops once the
  // cache reaches 'soundcheck', and from there the clock derives 'live'
  // forever -- a viewer who misses the single SHOW_ENDED broadcast would
  // otherwise watch an empty room indefinitely, since there's no clock
  // signal for a show ending. Viewer devices only (performers already
  // know their own End Show tap locally); slow (30s) since this is purely
  // a safety net, not the primary signal, plus one immediate re-fetch
  // whenever the tab regains visibility -- the case where a viewer left
  // the tab and the 30s poll didn't get a chance to run in the
  // background. Stops itself the moment displayShowState reaches 'ended'.
  useEffect(() => {
    if (isMainPerformer || isCamFeed) return undefined;
    if (displayShowState !== 'live') return undefined;

    const onVisibility = () => {
      if (document.visibilityState === 'visible') onRefetchShow?.();
    };
    document.addEventListener('visibilitychange', onVisibility);
    const id = setInterval(() => onRefetchShow?.(), 30000);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      clearInterval(id);
    };
  }, [isMainPerformer, isCamFeed, displayShowState, onRefetchShow]);

  // Tags every shot command fired from this device -- 'soundcheck' taps
  // must not pollute Layer 3 training data as 'live' ones. Uses
  // displayShowState (not raw showState) so a device that's only learned
  // it's live via the SHOW_LIVE broadcast doesn't keep tagging its own
  // taps 'soundcheck'. auto's own fireShot doesn't need this: it can
  // only ever run during 'live' once L4 wires its start trigger to the
  // lifecycle, so its default ('live') is already correct.
  const showPhase = displayShowState === 'soundcheck' ? 'soundcheck' : 'live';

  // Artist-side End Show (SHOW_LIFECYCLE_SPEC.md 3e). Optimistically
  // updates this device's own cached `show` immediately (same reasoning
  // as Go Live's optimistic update), writes to Supabase best-effort, and
  // broadcasts SHOW_ENDED for other clients -- receiving that broadcast
  // is L3's job, not built yet.
  const endShow = useCallback(() => {
    onShowUpdate?.((prev) => (prev ? { ...prev, state: 'ended' } : prev));
    onShowWriteErrorChange?.(null);
    // Same reasoning as Go Live: not awaited, resolves in the background,
    // warns on final failure -- silently failing here means viewers never
    // learn the show ended.
    updateShowStateWithRetry('ended').then((ok) => {
      onShowWriteErrorChange?.(ok ? null : 'ended');
    });
    send(new TextEncoder().encode(JSON.stringify({ type: 'SHOW_ENDED' })), {});
    triggerEgress('stop', ROOM_NAME); // Stage 3: stop the recording started at the live transition
  }, [onShowUpdate, onShowWriteErrorChange, send]);

  const sendComment = useCallback((text, replyTarget) => {
    const comment = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      author: selfName,
      text,
      replyMode: replyTarget?.mode || null,
      replyAuthor: replyTarget?.author || null,
      quoteText: replyTarget?.mode === 'quote' ? replyTarget.text : null,
    };
    setComments((prev) => [...prev, comment]);
    send(new TextEncoder().encode(JSON.stringify({ type: 'comment', comment })), {});
  }, [send, selfName]);

  // All video tracks (main performer + any extra camera feeds) tagged to a
  // given slot, for the director panel to list and for the audience view
  // to pick the currently-active one from. A muted track is treated as
  // unavailable (SHOW_LIFECYCLE_SPEC.md L6-1) -- a participant can mute
  // without unpublishing/leaving, and a muted track renders as a frozen
  // or black frame, not a real feed. useTracks already re-renders on
  // mute/unmute (RoomEvent.TrackMuted/TrackUnmuted are both in its
  // default event set -- verified against @livekit/components-core's
  // source, not assumed), so this filter alone is enough to make
  // availability live, no separate event subscription needed.
  // Finding 1 -- the same liveness blacklist the recorder applies. The
  // promotion flapping was reported against the recording, but this is
  // shared selection logic and the live stage had the identical hole: a
  // dead camera's publication lingering in the list makes it selectable
  // again the instant it reappears, with nothing damping the transition.
  const tracksForSlot = useCallback((letter) =>
    filterEligible(
      tracks.filter((t) =>
        (t.participant.identity.startsWith(`contestant-${letter}-`) ||
          t.participant.identity.startsWith(`camfeed-${letter}-`)) &&
        !t.publication?.isMuted
      ),
      ineligibleTracks
    ), [tracks, ineligibleTracks]);

  // MULTI_PERFORMER_SPEC.md's generalization pass -- the set of
  // performer slots CURRENTLY PRESENT (a published camera track exists
  // for them right now), derived live from `tracks`, not from
  // show_slots (which only tells you what's SEEDED, not who's actually
  // connected -- a seeded-but-unclaimed slot shouldn't get a thumbnail).
  // Deliberately NOT filtered on isMuted, unlike tracksForSlot above --
  // muting mid-show is a normal live action, not a disconnect, and
  // shouldn't make a performer vanish from the spotlight/switcher.
  // Sorted for a stable, deterministic render order (SpotlightStage's
  // thumbnail row and the switcher both key off array order).
  const presentSlots = useMemo(() => {
    const set = new Set();
    tracks.forEach((t) => {
      const identity = t.participant.identity;
      if (identity.startsWith('contestant-')) {
        const slot = identity.split('-')[1];
        if (slot) set.add(slot);
      }
    });
    return Array.from(set).sort();
  }, [tracks]);

  // Which camera roles ('main' | camRole values like 'wide'/'close'/'side')
  // are actually publishing -- AND unmuted -- for a slot right now --
  // drives which shots the director panel and auto-director can legally
  // pick. trackList defaults to the current render's `tracks`; auto's
  // own callbacks pass tracksRef.current explicitly instead (see below)
  // so they read live data without needing `tracks` itself as a
  // dependency anywhere.
  const availableRoles = (slot, trackList = tracks) => {
    const roles = new Set();
    trackList.forEach((t) => {
      if (t.publication?.isMuted) return;
      const id = t.participant.identity;
      if (id.startsWith(`contestant-${slot}-`)) roles.add('main');
      if (id.startsWith(`camfeed-${slot}-`)) roles.add(id.split('-')[2]);
    });
    return [...roles];
  };

  // Rewired per the shot-integration spec: a direct feed pick (from
  // VideoDeckPanel's own picker, untouched -- this is just the callback it
  // already calls, now threaded through SwipePages/BroadcastStage instead
  // of PerformerDeck since Phase 3's redesign) is now a human SHOT_COMMAND
  // using the nearest shot for that feed's role, not the old untracked
  // 'active-camera' message -- so direct picks get logged to the flywheel
  // like every other cut, and 'active-camera' (now unused on both send
  // and receive) is fully retired.
  const setActiveForSlot = useCallback((letter, identity) => {
    // Local-only UI highlight for VideoDeckPanel's own picker -- no longer
    // broadcast; each device only needs to know what IT last picked.
    setActiveCamera((prev) => ({ ...prev, [letter]: identity }));

    const role = identity.startsWith('contestant-')
      ? 'main'
      : identity.startsWith('camfeed-')
        ? identity.split('-')[2] || null
        : null;
    const shotKey = (role && NEAREST_SHOT_FOR_ROLE[role]) || 'wide';

    const command = buildShotCommand({
      showId: ROOM_NAME,
      slot: letter,
      shotKey,
      fromShotKey: activeShot[letter]?.shot ?? null,
      sourceRole: role,
      targetIdentity: identity, // already the exact participant picked -- no resolution needed
      decisionSource: 'human',
      showPhase,
      availableRoles: availableRoles(letter),
    });
    setActiveShot((prev) => ({ ...prev, [letter]: command }));
    broadcastShotCommand(room, command);
  }, [room, activeShot, showPhase]);

  // Stage 4 (MULTI_PERFORMER_SPEC.md) -- which performer slot is
  // "on stage." Derived directly from `show`, never separate state:
  // show.active_performer_slot is the sole source of truth, kept fresh
  // by the existing lifecycle poll plus the ACTIVE_PERFORMER_SWITCH
  // poke above. Defaults to 'a' before the column has ever been read
  // (matches the column's own DB default).
  const activePerformerSlot = show?.active_performer_slot || 'a';
  const [switchingPerformer, setSwitchingPerformer] = useState(false);

  // Only ever meaningfully callable from slot 'a' -- SpotlightStage's
  // thumbnail strip is only interactive for role 'a' (BroadcastStage
  // passes onSwitch only there), but the real authorization is
  // server-side regardless (section 5 of the spec):
  // a stale/foreign sessionToken is rejected by the route itself.
  const handleSwitchActivePerformer = useCallback(async (targetSlot) => {
    if (!show?.id || !sessionToken) return;
    setSwitchingPerformer(true);
    try {
      const res = await fetch('/api/show/active-performer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ show_id: show.id, sessionToken, targetSlot }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Switch failed');
      console.log('[active-performer] switched ->', data.activePerformerSlot);
      onShowUpdate((prev) => (prev ? { ...prev, active_performer_slot: data.activePerformerSlot } : prev));
      // Low-latency nudge only -- every receiver (including this
      // device's own other tabs, if any) re-fetches the real row rather
      // than trusting this payload; see the ACTIVE_PERFORMER_SWITCH
      // handler above.
      room?.localParticipant?.publishData(
        new TextEncoder().encode(JSON.stringify({ type: 'ACTIVE_PERFORMER_SWITCH' })),
        { reliable: true }
      );
    } catch (e) {
      console.error('[active-performer] switch failed:', e);
    } finally {
      setSwitchingPerformer(false);
    }
  }, [show?.id, sessionToken, room, onShowUpdate]);

  // Per-slot memory of whether the LAST render was showing the "be right
  // back" interstitial -- lets renderSlot force a hard cut specifically
  // on the frame recovering FROM it (L6-3's "hard cut back when a feed
  // returns"), regardless of whatever transition the underlying command
  // happens to carry (e.g. bRoll's default fade). Only the recovery
  // direction is forced; dropping INTO the interstitial keeps whatever
  // transition was already active, since the spec only specifies "hard
  // cut back", not "hard cut out".
  const wasInterstitialRef = useRef({});

  // DEBUG (bug 2 investigation -- "viewer stuck on main") -- last logged
  // {targetIdentity, matched, chosen} tuple per slot, so renderSlot only
  // logs when the RESOLVED result actually changes, not on every render
  // (renderSlot's inner function runs once per VersusSplit render, which
  // is often). Declared here, at RoomInner's own level -- renderSlot's
  // returned function executes during VersusSplit's render, not
  // RoomInner's own, so it can't call hooks itself; this ref is created
  // once, outside the closure, and only READ/written inside it, same
  // pattern as wasInterstitialRef above.
  const chosenDebugRef = useRef({});

  const renderSlot = (letter) => () => {
    const candidates = tracksForSlot(letter);
    const cmd = activeShot[letter];
    const matched = cmd?.targetIdentity
      ? candidates.find((t) => t.participant.identity === cmd.targetIdentity)
      : undefined;
    const chosen =
      matched ||
      candidates.find((t) => t.participant.identity.startsWith(`contestant-${letter}-`)) ||
      candidates[0];

    // DEBUG (bug 2 investigation) -- viewer-side only (role === 'viewer';
    // the director already has other debug coverage). Shows exactly what
    // targetIdentity the received SHOT_COMMAND carried, whether it
    // matched a track this viewer currently has as a candidate, and
    // which branch `chosen` actually came from. If a director cut to a
    // camfeed but this logs matched=false while the camfeed's identity
    // IS present in the candidates list, that's the fallback-to-main bug
    // confirmed, not a candidates-timing issue.
    if (CUT_DEBUG_ENABLED && role === 'viewer') {
      const chosenVia = matched
        ? 'targetIdentity match'
        : chosen
          ? (chosen.participant.identity.startsWith(`contestant-${letter}-`)
            ? 'FALLBACK: prefer contestant'
            : 'FALLBACK: candidates[0]')
          : 'none (no candidates)';
      const key = `${cmd?.targetIdentity || 'none'}|${!!matched}|${chosen?.participant.identity || 'none'}`;
      if (chosenDebugRef.current[letter] !== key) {
        chosenDebugRef.current[letter] = key;
        // candidates here include sub/track state (same shape as the
        // [tracks] log above) so a candidate that's PRESENT but not yet
        // actually subscribed is distinguishable from one that's fully
        // live -- third link in the chain, after [dataChannel] and
        // [tracks].
        const candidatesDetailed = candidates
          .map((t) => `${t.participant.identity}(sub=${t.publication?.isSubscribed},track=${!!t.publication?.track})`)
          .join(', ') || 'none';
        logCutDebug(`[renderSlot:${letter}] targetIdentity=${cmd?.targetIdentity || 'none'} matched=${!!matched} candidates=[${candidatesDetailed}] chosen=${chosen?.participant.identity || 'none'} via=${chosenVia}`);
      }
    }

    const isInterstitial = displayShowState === 'live' && candidates.length === 0;
    const wasInterstitial = wasInterstitialRef.current[letter];
    wasInterstitialRef.current[letter] = isInterstitial;

    const placeholder = isInterstitial
      ? BE_RIGHT_BACK_PLACEHOLDER
      : <span>waiting for {performanceMode === 'solo' ? 'performer' : `contestant ${letter}`}...</span>;

    const effectiveCommand = !isInterstitial && wasInterstitial && cmd ? { ...cmd, transition: 'cut' } : cmd;

    // Selfie mirror -- display-only, local to this device, never touches
    // the published track. Gated on this being MY OWN track (not e.g. a
    // camfeed device the director has picked for this slot) and my own
    // camera currently facing 'user'. Wrapping ShotVideo's whole output
    // in an outer transform, rather than threading a prop through
    // ShotVideo/ShotFadeLayer/ShotTransformFrame, keeps shot-director
    // internals (crop/zoom/pan) completely untouched -- the mirror just
    // composes as an ancestor transform in the DOM. One side effect:
    // a pan shot appears to move in the opposite direction on the
    // artist's own mirrored self-view -- correct mirror behavior (same
    // as any selfie camera app), never visible to viewers.
    const mirror = chosen?.participant.identity === room.localParticipant.identity && facingMode === 'user';

    return (
      <div style={{ width: '100%', height: '100%', transform: mirror ? 'scaleX(-1)' : 'none' }}>
        <ShotVideo candidates={candidates} activeTrackRef={chosen} command={effectiveCommand} placeholder={placeholder} lostOverlay={CAMERA_LOST_OVERLAY} />
      </div>
    );
  };

  // Tapping the video collapses an expanded (mobile) comments drawer --
  // a no-op on desktop, where the comments column has no expand/collapse
  // state to begin with.
  const collapseComments = useCallback(() => {
    if (commentsExpanded) setCommentsExpanded(false);
  }, [commentsExpanded]);

  if (left) {
    return (
      <div style={{ maxWidth: 400, margin: '60px auto', textAlign: 'center' }}>
        <p>You left the show.</p>
      </div>
    );
  }

  // Camera-feed devices get a minimal screen: their own preview, a camera
  // toggle, and leave. They are not part of the audience-facing layout and
  // don't see comments (they have no publish-data permission).
  if (isCamFeed) {
    const myTrack = tracks.find((t) => t.participant.identity === room.localParticipant.identity);
    return (
      <div style={{ maxWidth: 400, margin: '40px auto', textAlign: 'center' }}>
        <h3>Camera feed -- side {camFeedSlot?.toUpperCase()}</h3>
        <p style={{ color: 'rgba(253, 255, 252, 0.55)', fontSize: 13 }}>Keep this open and propped in place. The performer picks when this shot goes live.</p>
        <div style={{ position: 'relative', height: 220, background: '#011627', clipPath: 'polygon(16px 0,100% 0,100% 100%,0 100%,0 16px)', overflow: 'hidden' }}>
          {myTrack ? (
            <VideoTrack
              trackRef={myTrack}
              style={{ width: '100%', height: '100%', objectFit: 'cover', transform: facingMode === 'user' ? 'scaleX(-1)' : 'none' }}
            />
          ) : (
            <span>starting camera...</span>
          )}
          <SourceDimsDebugLabel state={sourceDims} />
        </div>
        <div className="mic-cam-controls">
          <button className={`control-btn ${!camOn ? 'off' : ''}`} onClick={toggleCam}>
            {camOn ? <VideoCamera size={16} weight="bold" /> : <VideoCameraSlash size={16} weight="bold" />}
            {camOn ? 'Camera off' : 'Camera on'}
          </button>
          <button className="control-btn" onClick={toggleFacingMode}>
            <CameraRotate size={16} weight="bold" />
            {facingMode === 'user' ? 'Front' : 'Rear'}
          </button>
          <button className="control-btn" onClick={leaveCall}>
            <PhoneDisconnect size={16} weight="bold" /> Leave
          </button>
        </div>
      </div>
    );
  }

  // availableRoles(role) returns a fresh array every call -- memoized here
  // so DirectorShotPanel's own useMemo (which depends on this array) only
  // sees a new reference when `tracks` actually changes, not on every
  // unrelated re-render. Without this, the sequencer would get torn down
  // and recreated constantly, killing an in-progress staccato run.
  const directorAvailableRoles = useMemo(() => availableRoles(role), [tracks, role]);

  // Read inside auto's fireShot closure via .current rather than a plain
  // closure over `activeShot` -- fireShot itself calls setActiveShot on
  // every cut, so if `activeShot` were a useMemo dependency below, auto
  // would tear itself down and get recreated on every single cut it
  // fires (same class of bug fixed for the staccato sequencer in Edit 5).
  const activeShotRef = useRef(activeShot);
  useEffect(() => {
    activeShotRef.current = activeShot;
  }, [activeShot]);

  // Same pattern for tracks: `auto` must NOT be recreated every time a
  // camera joins/drops (a camfeed connecting/disconnecting mid-show is
  // normal, not rare) -- recreating it stops the old instance's timer
  // (see the cleanup effect below) with nothing to restart the new one,
  // which would silently kill auto-rotation for the rest of the show on
  // the very first camera hiccup. fireShot/getAvailableShots read
  // tracksRef.current instead, so per-cut resolution still sees live
  // data without `tracks` needing to be a dependency at all.
  const tracksRef = useRef(tracks);
  useEffect(() => {
    tracksRef.current = tracks;
  }, [tracks]);

  // Auto-director: created once per (room, role) and survives camera
  // churn -- see tracksRef/activeShotRef above for why tracks/activeShot
  // aren't dependencies. Only the director's own device creates one
  // (gated on isMainPerformer, the same condition that shows the panel
  // below) -- if every client ran its own auto, viewers would each
  // broadcast duplicate commands.
  // Extracted out of the `auto` useMemo below (SHOW_LIFECYCLE_SPEC.md
  // L6-2) so the forced-failover effect can fire an auto-labelled cut
  // through the exact same path createAutoDirector's own scheduled cuts
  // use, without exposing internals from lib/autoDirector.js or
  // duplicating the command-building logic. Reads tracksRef/
  // activeShotRef (not tracks/activeShot directly), same reasoning as
  // everywhere else in this file: stays a stable reference across
  // unrelated re-renders.
  // Shared by fireAutoShot and fireCueShot below -- both need the exact
  // same resolve-and-broadcast steps, they just differ in which health
  // event (if any) they log afterward.
  //
  // meta.framingHint is auto's own concept: the intended FRAMING (a
  // SHOT_TYPES key, e.g. 'wide') even when shotKey is a technique
  // (zoomIn/zoomOut/pan) standing in for it -- resolving against the
  // hint, not the technique's own ambiguous 'currentOrSelected' source,
  // is what makes a themed zoom/pan land on the SAME feed the cycle
  // actually chose instead of an arbitrary first-available role.
  //
  // meta.sourceRole is a DIFFERENT thing, added for Cue-Sheet Director:
  // an already-resolved camera ROLE ('main'/'wide'/'close'/'side'), used
  // as-is with no resolveSourceRole lookup at all. A cue's slot_role is
  // exactly this -- an authored role intent, not a framing -- and must
  // never be passed as framingHint: SHOT_TYPES has no entries named
  // 'main'/'wide'/'close'/'side' (those are role names, not shot names,
  // even though 'wide' happens to spell the same both ways), so
  // resolveSourceRole(meta.framingHint) would look up a nonexistent shot
  // and silently return null -- confirmed via a device-test health-
  // events capture where a 'side'-role cue resolved to the main
  // performer with no cue_fallback logged (resolveTargetIdentity treats
  // a falsy role as "no override," not "resolution failed," and falls
  // through to main). autoDirector never sets meta.sourceRole, so its
  // own behavior is completely unchanged by this.
  //
  // meta.params (Cue-Sheet Director) forwards a cue's motion (direction/
  // vertigo) onto the command's params field -- autoDirector never sets
  // this either.
  const buildAndFireCommand = useCallback((shotKey, decisionSource, meta = {}) => {
    const roles = availableRoles(role, tracksRef.current);
    const sourceRole = meta.sourceRole ?? resolveSourceRole(meta.framingHint || shotKey, roles);
    const targetIdentity = resolveTargetIdentity(tracksRef.current, role, sourceRole);
    const command = buildShotCommand({
      showId: ROOM_NAME,
      slot: role,
      shotKey,
      fromShotKey: activeShotRef.current[role]?.shot ?? null,
      sourceRole,
      targetIdentity,
      decisionSource,
      params: meta.params || {},
      availableRoles: roles,
    });
    broadcastShotCommand(room, command);
    setActiveShot((prev) => ({ ...prev, [command.slot]: command }));
    return command;
  }, [room, role]);

  const fireAutoShot = useCallback((shotKey, decisionSource = 'auto', meta = {}) => {
    const command = buildAndFireCommand(shotKey, decisionSource, meta);
    // Phase 2 diagnostic instrumentation -- every command the director
    // loop itself emits (scheduled cuts + the L6-2 forced failover both
    // route through here). Human taps from DirectorShotPanel are a
    // separate path and deliberately not logged under this event --
    // this one specifically answers "is the director loop still
    // producing commands."
    logHealthEvent('director_shot_emitted', {
      shot: command.shot,
      slot: command.slot,
      decisionSource: command.decisionSource,
      targetIdentity: command.targetIdentity,
      sourceRole: command.sourceRole,
    });
  }, [buildAndFireCommand]);

  // Cue-Sheet Director (Phase 1) -- cueDirector owns its own health
  // events (cue_fired/cue_fallback), not 'director_shot_emitted' (that
  // name specifically means "the auto loop is alive," which this isn't),
  // so this skips fireAutoShot's logging and just returns the built
  // command for cueDirector to log against.
  const fireCueShot = useCallback((shotKey, decisionSource, meta = {}) => (
    buildAndFireCommand(shotKey, decisionSource, meta)
  ), [buildAndFireCommand]);

  const getAutoAvailableShots = useCallback(() => {
    const roles = availableRoles(role, tracksRef.current);
    return Object.keys(SHOT_TYPES).filter((k) => {
      const src = SHOT_TYPES[k].source;
      if (src === 'currentOrSelected') return roles.length > 0;
      if (src === 'multi') return false; // staccato is never auto-picked
      return src.some((r) => roles.includes(r));
    });
  }, [role]);

  // The concrete feed (participant identity) a shot key would resolve to
  // right now -- lets autoDirector's cycle compare "would this step land
  // on a different camera than what's showing" without knowing about
  // roles/tracks itself, and without a second resolver: same
  // resolveSourceRole + resolveTargetIdentity Item 1 already fixed.
  const resolveAutoFeed = useCallback((shotKey) => {
    const roles = availableRoles(role, tracksRef.current);
    const sourceRole = resolveSourceRole(shotKey, roles);
    return resolveTargetIdentity(tracksRef.current, role, sourceRole);
  }, [role]);

  // What's ACTUALLY showing for this slot right now -- reflects the last
  // command from ANY source (auto or human), not just auto's own last
  // pick, so the cycle's same-feed check stays correct across human
  // interruptions and resumes.
  const getCurrentFeed = useCallback(
    () => activeShotRef.current[role]?.targetIdentity ?? null,
    [role]
  );

  const auto = useMemo(() => {
    if (!isMainPerformer || !room) return null;
    return createAutoDirector({
      fireShot: fireAutoShot,
      getAvailableShots: getAutoAvailableShots,
      resolveFeed: resolveAutoFeed,
      getCurrentFeed,
    });
  }, [isMainPerformer, room, fireAutoShot, getAutoAvailableShots, resolveAutoFeed, getCurrentFeed]);

  // ─── Cue-Sheet Director (CD-3/CD-4) ───────────────────────────
  // cueSheet is the last SAVED sheet for whatever track is currently
  // loaded -- AudioDeckPanel (via BroadcastStage) reports it here
  // whenever it changes (on track load and after a successful editor
  // Save), never for in-progress unsaved edits. null means either no
  // track is loaded yet or no sheet has ever been saved for this
  // track+artist.
  const [cueSheet, setCueSheet] = useState(null);
  const cueModeAvailable = !!cueSheet?.cues?.length;

  // CD-4: Manual/Auto/Cue -- three mutually exclusive top-level modes.
  // Default 'auto' preserves the pre-CD-4 behavior ("auto runs by
  // default when a show starts," lib/autoDirector.js's own rule 1).
  const [mode, setMode] = useState('auto');

  // The backing-track player instance is otherwise private to
  // AudioDeckPanel/BackingTrackPanel (components/AudioDeckPanel.jsx) --
  // this ref is the one place it surfaces up to where shot commands are
  // actually built. getElapsed() returns seconds (Web Audio
  // AudioContext.currentTime arithmetic, lib/audioProcessing.js); cue
  // timestamp_ms is milliseconds, hence the *1000 below.
  const backingTrackPlayerRef = useRef(null);
  const handleBackingPlayerChange = useCallback((player) => {
    backingTrackPlayerRef.current = player;
  }, []);
  const getBackingTrackState = useCallback(() => {
    const player = backingTrackPlayerRef.current;
    if (!player) return { elapsedMs: 0, isPlaying: false };
    return { elapsedMs: player.getElapsed() * 1000, isPlaying: player.isPlaying() };
  }, []);

  const cueDirector = useMemo(() => {
    if (!isMainPerformer || !room || !cueSheet) return null;
    return createCueDirector({
      sheet: cueSheet,
      fireShot: fireCueShot,
      getAvailableRoles: () => availableRoles(role, tracksRef.current),
      getPlayerState: getBackingTrackState,
      // Same suspend()/resume() pair onExclusiveMode already drives for
      // staccato -- cue playback is another exclusive mode, not a
      // special case (see the phase-gate plan, point (d)).
      suspendAuto: () => auto?.suspend(),
      resumeAuto: () => auto?.resume(),
    });
  }, [isMainPerformer, room, cueSheet, fireCueShot, getBackingTrackState, auto, role]);

  useEffect(() => () => cueDirector?.dispose(), [cueDirector]);

  // Re-engages Cue mode's engine whenever the underlying cueDirector
  // instance itself changes (a track swap, or a fresh Save producing a
  // new sheet reference) while mode is already 'cue' -- e.g. saving an
  // edit mid-show should pick up seamlessly, not require re-toggling the
  // mode. Safe to call on every such change: cueDirector.start() is
  // idempotent-guarded (a no-op if already started), unlike
  // auto.start() below, which is why applyMode (not a reactive effect)
  // is what drives auto.
  useEffect(() => {
    if (mode === 'cue') cueDirector?.start();
  }, [mode, cueDirector]);

  // Safety: stop whatever timer the previous instance had pending on
  // real unmount (or the rare case room/role itself changes) -- a stale
  // timer firing from an object nothing references anymore would be a
  // leak. Mirrors the sequencer's own cleanup in DirectorShotPanel.
  useEffect(() => () => {
    auto?.stop();
    // Phase 2 diagnostic instrumentation -- this cleanup path fires on
    // genuine unmount (e.g. a refresh) as well as the rare room/role
    // change; the 'ended' path below logs its own, more specific reason,
    // so a healthy show produces both a 'show_ended' stop and this
    // 'unmount' stop back to back -- an 'unmount' stop with NO preceding
    // 'show_ended' stop is the signature this instrumentation exists to
    // catch (Phase 1 hypothesis 1).
    if (auto) logHealthEvent('director_loop_stopped', { reason: 'unmount' });
  }, [auto]);

  // CD-4: single intended entry point for engaging any of the three
  // modes -- nothing else should call auto.start()/disable() or
  // cueDirector.start()/stop() directly. Both engines' own start/stop/
  // enable/disable already no-op safely when called redundantly, so
  // this can run on every transition without needing to diff against
  // the previous mode.
  //
  // auto.disable() only fires for 'manual' -- NOT for every non-'auto'
  // transition (a bug found via a device-test health-events capture:
  // director_heartbeat read 'off' throughout a whole cue-playback
  // session, never 'suspended'). auto.disable() sets started=false, and
  // autoDirector's `state` getter checks `!started` BEFORE it checks
  // `suspended` -- so calling disable() on the 'cue' transition was
  // stomping the state before cueDirector.start()'s own suspendAuto()
  // call (Phase 1's actual mechanism) got a chance to make 'suspended'
  // observable, even though suspendAuto() still ran and auto genuinely
  // wasn't emitting. Entering 'cue' now relies on suspendAuto()/
  // resumeAuto() alone, exactly as designed -- auto stays suspended
  // (resumable), not stopped, while cues play.
  function applyMode(next) {
    if (!isMainPerformer) return; // only the director's own device runs either engine
    if (next === 'manual') auto?.disable();
    if (next !== 'cue') cueDirector?.stop();
    if (next === 'auto') auto?.start();
    if (next === 'cue') cueDirector?.start();
    setMode(next);
    logHealthEvent('mode_changed', { mode: next });
  }

  // Phase 2 diagnostic instrumentation -- proof-of-life heartbeat,
  // independent of whether a cut actually fires (auto's hold times run
  // up to ~18s, and the human-override cooldown is 45s -- long enough
  // that "no shot_command for a while" is ambiguous between "loop is
  // dead" and "loop is alive and just holding/cooling down" without
  // this).
  useEffect(() => {
    if (!auto) return undefined;
    const id = setInterval(() => {
      logHealthEvent('director_heartbeat', { state: auto.state });
    }, 10_000);
    return () => clearInterval(id);
  }, [auto]);

  // Re-keys auto's start trigger from "first video appears" (Edit 6's
  // original plan) to the show lifecycle (SHOW_LIFECYCLE_SPEC.md 3d):
  // start on the soundcheck->live transition, from WHICHEVER signal
  // arrives first -- displayShowState already folds together the local
  // clock derivation and the SHOW_LIVE broadcast receipt (see above), so
  // reading it here for free gets "whichever first" without this effect
  // needing to know which source won. autoStartedRef guards against
  // firing twice: displayShowState settling on 'live' shouldn't restart
  // an already-running auto just because this effect re-evaluates for an
  // unrelated reason. Stop-on-unmount is already covered by the
  // useEffect above this one (auto's own cleanup); this effect only
  // needs to cover the 'ended' transition, a normal state change, not a
  // teardown.
  //
  // Phase 2 diagnostic instrumentation -- directorEffectHasRunRef marks
  // whether THIS invocation is the first time this effect has run since
  // mount, which is what lets classifyDirectorStartReason distinguish a
  // start observed on the very first run (this tab's first look at the
  // show -- 'mount', or 'recovery' if sessionStorage shows this tab
  // already ran the director for this show before, i.e. a same-tab
  // refresh) from a start observed on a later run (displayShowState
  // genuinely flipped to 'live' while already mounted and watching --
  // unambiguously 'transition', no sessionStorage needed).
  //
  // Fix (b) (SHOW-1 diagnosis round) -- also require roomConnectionState
  // === Connected before starting. Confirmed by both the Phase 1 audit
  // and a real health_events capture: displayShowState can already read
  // 'live' the instant this component mounts (a rejoining client's show
  // row is fetched independently of the room's own connect handshake),
  // which raced director_loop_started ahead of RoomEvent.Connected and
  // set up the first publishData call to land while the engine's
  // publisher transport wasn't ready yet -- see broadcastShotCommand's
  // shot_publish_failure handling (lib/shotCommands.js) and the
  // publish-failure recovery effect below for what happens if a cut
  // still gets fired into a not-actually-ready connection. Gating here
  // narrows how often that can happen; it isn't a guarantee by itself
  // (room.state flips to Connected on signaling success, which can still
  // race the engine's own internal transport setup) -- the recovery
  // effect below is what actually detects and recovers from that
  // remaining window. roomConnectionState (not room.state read directly)
  // is the dependency so this effect re-evaluates the moment connection
  // state changes, without needing a live property read as a dep.
  const autoStartedRef = useRef(false);
  const directorEffectHasRunRef = useRef(false);
  useEffect(() => {
    const isFirstRun = !directorEffectHasRunRef.current;
    directorEffectHasRunRef.current = true;

    if (!isMainPerformer) return;
    if (
      displayShowState === 'live' &&
      roomConnectionState === ConnectionState.Connected &&
      !autoStartedRef.current
    ) {
      autoStartedRef.current = true;
      const reason = isFirstRun ? classifyDirectorStartReason(ROOM_NAME, role) : 'transition';
      // Fix (b1) -- the director does not start until the publisher path
      // has been proven, or repaired. roomConnectionState === Connected
      // demonstrably does NOT cover engine/publisher-transport
      // readiness (see lib/transportDiagnostics.js's header); this does,
      // because it exercises the same publishData every cut uses.
      runStartPreflight().then((result) => {
        applyMode(mode); // engages whichever mode is currently selected (default 'auto')
        logHealthEvent('director_loop_started', {
          reason,
          preflight: result.ok ? (result.recovered ? 'recovered' : 'clean') : 'failed',
          transport: describeTransport(room),
        });
      });
    }
    if (displayShowState === 'ended') {
      auto?.disable();
      cueDirector?.stop();
      logHealthEvent('director_loop_stopped', { reason: 'show_ended' });
    }
  }, [isMainPerformer, displayShowState, role, roomConnectionState]);

  // The SHOW_LIVE send side, deferred here from L2/L3 (3a: "the director
  // device also broadcasts... at the moment soundcheck->live flips").
  // Deliberately keyed on the raw, clock-derived showState -- not
  // displayShowState -- so this device only broadcasts on ITS OWN
  // observed flip, not merely because it already learned 'live' from
  // someone else's broadcast (which would be a redundant, delayed echo).
  // In a versus show both performer devices independently satisfy
  // isMainPerformer and will each send this once their own clock agrees;
  // receiving it twice is a harmless no-op (setReceivedShowLive(true)).
  const showLiveBroadcastSentRef = useRef(false);
  useEffect(() => {
    if (!isMainPerformer) return;
    // Fix (b6.2) -- `roomConnectionState === Connected` added. This
    // effect keying on the clock-derived showState ALONE is the specific
    // hole that let the pre-flight run 10s early: it fires the moment
    // this device's own clock says live, which can be well before the
    // room has connected, and it was the first caller into the memoized
    // pre-flight.
    //
    // It is also the historical explanation for the poisonings that
    // predate the pre-flight entirely -- SHOW_LIVE is a publishData, so
    // every show was already firing an ungated publish straight into a
    // possibly-still-connecting engine at exactly this moment. The
    // pre-flight did not introduce that race; it inherited it, and made
    // it legible.
    //
    // Correct on its own terms regardless: broadcasting SHOW_LIVE into a
    // room that has not connected cannot reach anyone.
    if (showState === 'live' && roomConnectionState === ConnectionState.Connected && !showLiveBroadcastSentRef.current) {
      showLiveBroadcastSentRef.current = true;
      // Fix (b1) -- SHOW_LIVE is itself a publishData, so it fails in a
      // poisoned engine exactly the way a cut does; and starting the
      // recording before the publisher is known-good is precisely what
      // put the recovery hole INSIDE the recording. Both wait on the
      // same memoized pre-flight the director effect uses, so this is
      // one probe for the whole start sequence, not two.
      runStartPreflight().then(() => {
        send(new TextEncoder().encode(JSON.stringify({ type: 'SHOW_LIVE' })), {});
        triggerEgress('start', ROOM_NAME, performanceMode); // Stage 4: directed portrait recording, same once-only guard as the broadcast above
      });
    }
    // roomConnectionState added (b6.2) so this re-evaluates the moment
    // the connection lands -- without it the new gate would latch this
    // effect off for a device that goes live before connecting, and
    // SHOW_LIVE/egress would never fire at all.
  }, [isMainPerformer, showState, send, performanceMode, roomConnectionState]);

  // Forced failover (SHOW_LIFECYCLE_SPEC.md L6-2): if the track behind
  // the slot's currently-shown targetIdentity mutes or drops mid-live,
  // fire an immediate auto cut to the best available shot (wide first)
  // instead of leaving a dead frame up until whatever the next
  // scheduled auto cut (up to ~18s away, per autoDirector's
  // HOLD_RANGE_MS) or the next human tap happens to be. Gated on
  // autoStartedRef.current (not just displayShowState === 'live') so
  // this can never fire before L4's start trigger has actually run --
  // same "started" boundary the L4 bugfix made autoDirector itself
  // enforce internally, mirrored here at the call site. Goes straight
  // through fireAutoShot with decisionSource 'auto', not 'human' -- a
  // forced failover is a safety net, not a deliberate human override.
  useEffect(() => {
    if (!isMainPerformer) return;
    if (!autoStartedRef.current) return;
    if (displayShowState !== 'live') return;

    const cmd = activeShot[role];
    const targetId = cmd?.targetIdentity;
    if (!targetId) return; // nothing chosen yet -- nothing to fail over from

    const stillAvailable = tracks.some(
      (t) => t.participant.identity === targetId && !t.publication?.isMuted
    );
    if (stillAvailable) return;

    const availableShots = getAutoAvailableShots();
    const failoverShot = availableShots.includes('wide') ? 'wide' : availableShots[0];
    if (!failoverShot) return; // nothing available at all -- L6-3's interstitial covers this

    fireAutoShot(failoverShot, 'auto');
  }, [isMainPerformer, displayShowState, activeShot, role, tracks, getAutoAvailableShots, fireAutoShot]);

  // Auto.state is a plain getter, not React state -- polled at a cheap
  // interval so the Auto segment's "suspended" sub-label actually
  // reflects staccato transitions that happen off-render (setTimeout-
  // driven). Function over polish; fine for a badge that updates within
  // half a second.
  const [autoState, setAutoState] = useState('off');
  useEffect(() => {
    if (!auto) {
      setAutoState('off');
      return undefined;
    }
    setAutoState(auto.state);
    const id = setInterval(() => setAutoState(auto.state), 500);
    return () => clearInterval(id);
  }, [auto]);

  // Desktop portrait stage (display-only) -- resolves the SAME track the
  // centre stage is currently showing, for BlurFillBackground. Mirrors
  // what the centre stage actually renders for EVERY role uniformly
  // (SpotlightStage's activeSlot for versus, VersusSplit's fixed slot
  // 'a' for solo) rather than assuming "each performer sees their own
  // slot" -- in a versus show the artist's own centre stage can be
  // showing the OTHER performer if a switch happened, and the blur-fill
  // needs to track that, not role. Same targetIdentity-match-then-
  // fallback formula RoomInner's own renderSlot (above) and
  // EgressPage.jsx's renderSlot already duplicate independently --
  // matching that existing pattern rather than introducing a shared
  // export for one more consumer.
  const blurFillSlot = performanceMode === 'versus' ? activePerformerSlot : 'a';
  const blurFillCandidates = tracksForSlot(blurFillSlot);
  const blurFillCmd = activeShot[blurFillSlot];
  const blurFillMatched = blurFillCmd?.targetIdentity
    ? blurFillCandidates.find((t) => t.participant.identity === blurFillCmd.targetIdentity)
    : undefined;
  const blurFillTrackRef =
    blurFillMatched ||
    blurFillCandidates.find((t) => t.participant.identity.startsWith(`contestant-${blurFillSlot}-`)) ||
    blurFillCandidates[0];

  const stageProps = {
    performanceMode,
    renderSlot,
    activePerformerSlot,
    presentSlots,
    maximized,
    onToggleMaximize,
    sidebarCollapsed,
    onStageClick: collapseComments,
    comments,
    sendComment,
    commentsExpanded,
    onCommentsExpand: () => setCommentsExpanded(true),
    onCommentsCollapse: () => setCommentsExpanded(false),
    // Phase 4 -- the minimize/restore control on the comments panel
    // itself (separate from commentsExpanded's tall/compact toggle
    // above); shared by both BroadcastStage and ViewerStage since both
    // render their own comments column. Viewer has nothing else to stay
    // mutually exclusive WITH (no deck/QR panel on that screen), but
    // reuses the exact same state/control for a consistent declutter
    // affordance on both roles.
    commentsCollapsed,
    onToggleCommentsCollapsed: toggleCommentsCollapsed,
  };

  return (
    <div style={{ position: 'relative', width: '100%', minHeight: '100vh' }}>
      {/* Desktop portrait stage (display-only) -- ambient blur-fill,
          hidden entirely below 1025px (reactions.css). Mounted once here
          regardless of role (viewer or artist both get it, item 4/5 of
          the spec); harmless no-op if blurFillTrackRef isn't resolved
          yet (no video published, show not live) -- BlurFillBackground
          itself no-ops on a null track. */}
      {/* Fix (1c) -- relocated from the outer LiveDemo (see the note at
          that call site). Same rule as before for viewers, now keyed on
          displayShowState: audio only while genuinely live, so it can
          neither leak during soundcheck (3c) nor keep playing after the
          show has ended. Performers/camfeed devices are unaffected --
          always rendered, exactly as before. */}
      {(role !== 'viewer' || displayShowState === 'live') && <RoomAudioRenderer />}
      <BlurFillBackground trackRef={blurFillTrackRef} />
      <CutTimingDebugOverlay />
      {notice && <div className="stage-notice">{notice}</div>}

      {/* Soundcheck/live banner (SHOW_LIFECYCLE_SPEC.md 3b/3e) -- artist
          side only. Uses displayShowState, not raw showState -- in a
          versus show, the non-director performer's own device learns
          about the live flip from the SHOW_LIVE broadcast, potentially
          before its own local clock/cache would derive it. */}
      {isMainPerformer && show && displayShowState === 'soundcheck' && (
        <div className="lifecycle-banner soundcheck">
          <span>SOUNDCHECK — you go public in {formatCountdown(new Date(show.slated_at).getTime() - now)}</span>
          {/* Soundcheck checklist (SHOW_LIFECYCLE_SPEC.md L6-6) -- just
              the one reminder line for the pilot. */}
          <span className="soundcheck-reminder">Turn on Do Not Disturb</span>
          {showWriteError === 'soundcheck' && (
            <span className="lifecycle-warning">⚠ Viewers may not see your show — check connection</span>
          )}
        </div>
      )}
      {isMainPerformer && displayShowState === 'live' && (
        <div className="lifecycle-banner live">
          <span>● LIVE</span>
          <button type="button" className="end-show-btn" onClick={endShow}>END SHOW</button>
          {/* Fix (c) (SHOW-1 diagnosis round) -- persistent, visible warning
              for the "publishes are silently failing" state. Ships
              regardless of whether the one automatic recovery attempt
              already ran and failed, or hasn't run at all (e.g. connToken/
              connServerUrl weren't available) -- silent failure is the
              part that's unacceptable, not any one specific recovery path. */}
          {publishWarning && (
            <>
              <span className="lifecycle-warning">⚠ Viewers can&apos;t see your cuts — tap to reconnect</span>
              <button
                type="button"
                className="reconnect-btn"
                onClick={() => attemptPublishRecovery('manual')}
                disabled={recoveringPublish}
              >
                {recoveringPublish ? 'Reconnecting…' : 'Reconnect'}
              </button>
            </>
          )}
        </div>
      )}
      {isMainPerformer && displayShowState === 'ended' && (
        <div className="lifecycle-banner ended">
          <span>SHOW ENDED</span>
          {showWriteError === 'ended' && (
            <span className="lifecycle-warning">⚠ Show may not have ended for viewers — check connection</span>
          )}
        </div>
      )}

      {isMainPerformer ? (
        <BroadcastStage
          {...stageProps}
          role={role}
          leaveCall={leaveCall}
          micOn={micOn}
          camOn={camOn}
          facingMode={facingMode}
          toggleFacingMode={toggleFacingMode}
          toggleMic={toggleMic}
          toggleCam={toggleCam}
          tracksForSlot={tracksForSlot}
          activeCamera={activeCamera}
          setActiveForSlot={setActiveForSlot}
          switchingPerformer={switchingPerformer}
          onSwitchActivePerformer={handleSwitchActivePerformer}
          audioNodes={audioNodes}
          audioContext={audioContext}
          showEnded={displayShowState === 'ended'}
          showPhase={showPhase}
          room={room}
          showId={ROOM_NAME}
          availableRoles={directorAvailableRoles}
          tracks={tracks}
          onExclusiveMode={(on) => {
            // Phase 2 diagnostic instrumentation -- log-only, call
            // unchanged from before.
            logHealthEvent(on ? 'director_suspend' : 'director_resume', {});
            if (on) auto?.suspend(); else auto?.resume();
          }}
          onCommand={(cmd) => setActiveShot((prev) => ({ ...prev, [cmd.slot]: cmd }))}
          mode={mode}
          onModeChange={applyMode}
          cueModeAvailable={cueModeAvailable}
          autoState={autoState}
          onBackingPlayerChange={handleBackingPlayerChange}
          artistEmail={email}
          artistAccessToken={artistAccessToken}
          onCueSheetChange={setCueSheet}
          deckCollapsed={deckCollapsed}
          onToggleDeckCollapsed={toggleDeckCollapsed}
          feedsCollapsed={feedsCollapsed}
          onToggleFeedsCollapsed={toggleFeedsCollapsed}
          controlsCollapsed={controlsCollapsed}
          onToggleControlsCollapsed={toggleControlsCollapsed}
        />
      ) : displayShowState === 'ended' ? (
        <EndedCard />
      ) : displayShowState === 'scheduled' || displayShowState === 'soundcheck' ? (
        <HoldingScreen show={show} now={now} />
      ) : (
        <ViewerStage {...stageProps} />
      )}

      {/* Add-camera QR panel (SHOW_LIFECYCLE_SPEC.md section 4) -- top-right,
          repositioned below .stage-topbar (Phase 4) so it no longer
          overlaps the maximize button (both were fighting for the same
          top-right ~54px strip before). Setup-time only, collapsed by
          default; toggleQrPanel (above) is part of the deck/comments/QR
          mutual-exclusivity group, not a bare boolean flip anymore. */}
      {isMainPerformer && (
        <div className={`camera-qr-panel ${qrPanelOpen ? 'open' : ''}`}>
          <button
            type="button"
            className="director-panel-toggle"
            onClick={toggleQrPanel}
          >
            {qrPanelOpen ? 'HIDE CAMERAS' : 'ADD CAMERA'}
          </button>
          {qrPanelOpen && (
            <div className="camera-qr-panel-body">
              <CameraQRPanel roomName={ROOM_NAME} slot={role} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
