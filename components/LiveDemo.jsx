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
import { Track } from 'livekit-client';
import { VideoCamera, VideoCameraSlash, PhoneDisconnect, CameraRotate } from '@phosphor-icons/react';
import '@livekit/components-styles';

import PageShell from './PageShell';
import BroadcastStage from './BroadcastStage';
import ViewerStage from './ViewerStage';
import CameraQRPanel from './CameraQRPanel';
import { CUT_DEBUG_ENABLED, logCutDebug, CutTimingDebugOverlay, ShotVideo } from './ShotRendering';
import { createPilotAudioTrack } from '../lib/audioProcessing';
import { useSourceDimensions, useNativeIsLandscape } from '../lib/useSourceDimensions';
import { createPortraitProcessor } from '../lib/rotationProcessor';
import { SHOT_TYPES, NEAREST_SHOT_FOR_ROLE, resolveSourceRole } from '../lib/shotTypes';
import { buildShotCommand, broadcastShotCommand, resolveTargetIdentity } from '../lib/shotCommands';
import { createAutoDirector } from '../lib/autoDirector';
import { effectiveState, canGoLive } from '../lib/showState';
import './reactions.css';

const ROOM_NAME = 'pilot-room';

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
const HIGH_RES_VIDEO_CAPTURE = { resolution: { width: 1080, height: 1920 }, frameRate: { ideal: 30 } };

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
  const [role, setRole] = useState('viewer'); // 'viewer' | 'a' | 'b' | 'camfeed-a' | 'camfeed-b'
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
  const isContestantRole = role === 'a' || role === 'b';
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

  async function handleGateSubmit() {
    setGateError('');
    const trimmed = email.trim();
    if (!trimmed) {
      setGateError('Enter your email to continue.');
      return;
    }
    if (!show?.id) {
      setGateError("Couldn't reach the show yet -- try again in a moment.");
      return;
    }
    setGateSubmitting(true);
    try {
      const res = await fetch('/api/participants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ show_id: show.id, email: trimmed, consent: marketingConsent }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not continue');
      setParticipantId(data.participantId);
      setStep('mode');
    } catch (e) {
      setGateError(e.message);
    } finally {
      setGateSubmitting(false);
    }
  }

  if (step === 'gate') {
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
          <input
            placeholder="your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={fieldStyle}
          />
          <select value={role} onChange={(e) => setRole(e.target.value)} style={fieldStyle}>
            <option value="viewer">Viewer</option>
            <option value="a">{performanceMode === 'solo' ? 'Performer (main phone)' : 'Performer A (main phone)'}</option>
            {performanceMode === 'versus' && <option value="b">Performer B (main phone)</option>}
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
          {isContestantRole ? (
            <>
              <button
                onClick={handleGoLive}
                disabled={!!goLiveDisabledReason}
                style={{
                  ...primaryBtnStyle,
                  opacity: goLiveDisabledReason ? 0.5 : 1,
                  cursor: goLiveDisabledReason ? 'not-allowed' : 'pointer',
                }}
              >
                Go Live
              </button>
              {goLiveDisabledReason && (
                <p style={{ color: 'rgba(253, 255, 252, 0.55)', fontSize: 13 }}>{goLiveDisabledReason}</p>
              )}
            </>
          ) : (
            <button onClick={handleJoin} style={primaryBtnStyle}>Join</button>
          )}
          {error && <p style={{ color: '#e71d36' }}>{error}</p>}
        </div>
      </PageShell>
    );
  }

  const isCamFeedRole = conn.assignedRole?.startsWith('camfeed-');
  const publishesVideo = conn.assignedRole === 'a' || conn.assignedRole === 'b' || isCamFeedRole;
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
          {/* Gated on the plain (non-broadcast-aware) showState, available
              here in the outer component -- deliberately conservative:
              this can only ever delay a viewer's audio starting slightly
              late (if they're relying on a SHOW_LIVE receipt their own
              clock hasn't caught up to yet), never leak it early, which
              is the actual requirement (3c: "soundcheck audio must not
              leak"). Performers/camfeed devices are unaffected -- always
              rendered, matching behavior before this lifecycle work. */}
          {(!isViewerRole || showState === 'live') && <RoomAudioRenderer />}
          <RoomInner
            performanceMode={performanceMode}
            role={conn.assignedRole}
            notice={notice}
            selfName={conn.name}
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

function RoomInner({ performanceMode, role, notice, selfName, maximized, onToggleMaximize, sidebarCollapsed, show, showState, now, onShowUpdate, onRefetchShow, showWriteError, onShowWriteErrorChange }) {
  const room = useRoomContext();
  const tracks = useTracks([Track.Source.Camera]);

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

  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const isCamFeed = typeof role === 'string' && role.startsWith('camfeed-');
  const [facingMode, setFacingMode] = useState(isCamFeed ? 'environment' : 'user');
  const [left, setLeft] = useState(false);
  const [comments, setComments] = useState([]);
  const [commentsExpanded, setCommentsExpanded] = useState(false);
  const [activeCamera, setActiveCamera] = useState({ a: null, b: null }); // slot -> identity of the live feed
  const [activeShot, setActiveShot] = useState({}); // slot -> full SHOT_COMMAND (shot, transition, targetIdentity, params...)
  const [audioNodes, setAudioNodes] = useState(null);
  const [audioContext, setAudioContext] = useState(null);
  const audioHandleRef = useRef(null);

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

  const isMainPerformer = role === 'a' || role === 'b';
  const camFeedSlot = isCamFeed ? role.split('-')[1] : null;

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
  const isLandscape = useNativeIsLandscape(myCameraPublication);
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
      await room.localParticipant.publishTrack(handle.processedTrack, {
        source: Track.Source.Microphone,
      });
    })();
    return () => {
      if (audioHandleRef.current) {
        room.localParticipant.unpublishTrack(audioHandleRef.current.processedTrack);
      }
    };
  }, [isMainPerformer, room]);

  const toggleMic = useCallback(() => {
    const track = audioHandleRef.current?.processedTrack;
    if (!track) return;
    track.enabled = !micOn;
    setMicOn((v) => !v);
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
  const tracksForSlot = useCallback((letter) =>
    tracks.filter((t) =>
      (t.participant.identity.startsWith(`contestant-${letter}-`) ||
        t.participant.identity.startsWith(`camfeed-${letter}-`)) &&
      !t.publication?.isMuted
    ), [tracks]);

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
        <ShotVideo candidates={candidates} activeTrackRef={chosen} command={effectiveCommand} placeholder={placeholder} />
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
  const fireAutoShot = useCallback((shotKey, decisionSource = 'auto', meta = {}) => {
    const roles = availableRoles(role, tracksRef.current);
    // meta.framingHint is the cycle's intended framing (e.g. 'wide') even
    // when shotKey is a technique (zoomIn/zoomOut/pan) standing in for
    // it -- resolving against the hint, not the technique's own ambiguous
    // 'currentOrSelected' source, is what makes a themed zoom/pan land on
    // the SAME feed the cycle actually chose instead of an arbitrary
    // first-available role.
    const sourceRole = resolveSourceRole(meta.framingHint || shotKey, roles);
    const targetIdentity = resolveTargetIdentity(tracksRef.current, role, sourceRole);
    const command = buildShotCommand({
      showId: ROOM_NAME,
      slot: role,
      shotKey,
      fromShotKey: activeShotRef.current[role]?.shot ?? null,
      sourceRole,
      targetIdentity,
      decisionSource,
      availableRoles: roles,
    });
    broadcastShotCommand(room, command);
    setActiveShot((prev) => ({ ...prev, [command.slot]: command }));
  }, [room, role]);

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

  // Safety: stop whatever timer the previous instance had pending on
  // real unmount (or the rare case room/role itself changes) -- a stale
  // timer firing from an object nothing references anymore would be a
  // leak. Mirrors the sequencer's own cleanup in DirectorShotPanel.
  useEffect(() => () => auto?.stop(), [auto]);

  // Single intended entry points for auto's lifecycle -- nothing else
  // should call auto.start()/auto.stop() directly. Wired below (L4).
  function startAutoIfDirector() {
    if (!isMainPerformer) return; // only the director's own device runs auto
    auto?.start();
  }
  function stopAuto() {
    auto?.stop();
  }

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
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (!isMainPerformer) return;
    if (displayShowState === 'live' && !autoStartedRef.current) {
      autoStartedRef.current = true;
      startAutoIfDirector();
    }
    if (displayShowState === 'ended') {
      stopAuto();
    }
  }, [isMainPerformer, displayShowState]);

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
    if (showState === 'live' && !showLiveBroadcastSentRef.current) {
      showLiveBroadcastSentRef.current = true;
      send(new TextEncoder().encode(JSON.stringify({ type: 'SHOW_LIVE' })), {});
      triggerEgress('start', ROOM_NAME, performanceMode); // Stage 4: directed portrait recording, same once-only guard as the broadcast above
    }
  }, [isMainPerformer, showState, send, performanceMode]);

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
  // through fireAutoShot with decisionSource 'auto', NOT
  // auto.notifyHumanCommand() -- a forced failover is not a human
  // override and must not arm the 45s human-override cooldown that
  // would suppress auto's own next scheduled cut.
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
  // interval so the indicator below actually reflects cooldown/suspend
  // transitions that happen off-render (setTimeout-driven). Function
  // over polish; fine for a badge that updates within half a second.
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

  const stageProps = {
    performanceMode,
    renderSlot,
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
          audioNodes={audioNodes}
          audioContext={audioContext}
          showEnded={displayShowState === 'ended'}
          showPhase={showPhase}
          room={room}
          showId={ROOM_NAME}
          availableRoles={directorAvailableRoles}
          tracks={tracks}
          onExclusiveMode={(on) => (on ? auto?.suspend() : auto?.resume())}
          onHumanCommand={() => auto?.notifyHumanCommand()}
          onCommand={(cmd) => setActiveShot((prev) => ({ ...prev, [cmd.slot]: cmd }))}
          autoState={autoState}
          onToggleAuto={() => (autoState === 'off' ? auto?.enable() : auto?.disable())}
          deckCollapsed={deckCollapsed}
          onToggleDeckCollapsed={toggleDeckCollapsed}
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
