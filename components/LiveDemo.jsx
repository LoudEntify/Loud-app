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
import { VideoCamera, VideoCameraSlash, PhoneDisconnect } from '@phosphor-icons/react';
import '@livekit/components-styles';

import PageShell from './PageShell';
import BroadcastStage from './BroadcastStage';
import ViewerStage from './ViewerStage';
import DirectorShotPanel from './DirectorShotPanel';
import CameraQRPanel from './CameraQRPanel';
import { createPilotAudioTrack } from '../lib/audioProcessing';
import { SHOT_TYPES, FADE_MS, NEAREST_SHOT_FOR_ROLE, resolveSourceRole } from '../lib/shotTypes';
import { buildShotCommand, broadcastShotCommand, resolveTargetIdentity } from '../lib/shotCommands';
import { createAutoDirector } from '../lib/autoDirector';
import { effectiveState, canGoLive } from '../lib/showState';
import './reactions.css';

const ROOM_NAME = 'pilot-room';

const trackKey = (t) => t ? `${t.participant.identity}:${t.publication?.trackSid || ''}` : null;

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

// Pan direction -> start/end translate offsets (percent of overscan
// slack). Ported from ShotRenderer.jsx.
const PAN_VECTORS = {
  left: { from: [8, 0], to: [-8, 0] },
  right: { from: [-8, 0], to: [8, 0] },
  up: { from: [0, 8], to: [0, -8] },
  down: { from: [0, -8], to: [0, 8] },
};

// Computes the crop/animatedZoom/animatedPan CSS transform for the active
// shot and applies it to a wrapper div around the video. Ported from
// ShotRenderer.jsx's transform effect -- the track attach/detach and
// opacity-fade parts of that file don't apply here: VideoTrack handles
// attach/detach itself, and fades are handled a layer up, by
// ShotFadeLayer's opacity, not by this wrapper.
function ShotTransformFrame({ trackRef, command, placeholder }) {
  const [style, setStyle] = useState({});
  const rafRef = useRef(null);

  useEffect(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);

    const shot = command && SHOT_TYPES[command.shot];
    if (!shot) {
      // No live command for this layer -- either a fresh mount (style
      // starts at {}, so it renders untransformed) or an outgoing fade
      // layer that ShotVideo demoted to command=null. The latter must
      // freeze at whatever transform it last had, not snap to scale(1)
      // mid-fade, so leave `style` exactly as it is.
      return undefined;
    }

    const t = shot.transform;

    if (!t || (t.optional && !command.params?.vertigo)) {
      setStyle({ transform: 'scale(1)', transition: 'none' });
      return undefined;
    }

    if (t.kind === 'crop') {
      setStyle({
        transform: `scale(${t.scale})`,
        transformOrigin: `${t.originX}% ${t.originY}%`,
        transition: 'none', // static crops snap -- they are framings, not moves
      });
      return undefined;
    }

    if (t.kind === 'animatedZoom') {
      setStyle({
        transform: `scale(${t.from})`,
        transformOrigin: `${t.originX}% ${t.originY}%`,
        transition: 'none',
      });
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = requestAnimationFrame(() => {
          setStyle({
            transform: `scale(${t.to})`,
            transformOrigin: `${t.originX}% ${t.originY}%`,
            transition: `transform ${t.durationMs}ms ${t.easing}`,
          });
        });
      });
      return undefined;
    }

    if (t.kind === 'animatedPan') {
      const dir = command.params?.direction || t.direction;
      const vec = PAN_VECTORS[dir] || PAN_VECTORS.left;
      setStyle({
        transform: `scale(${t.overscan}) translate(${vec.from[0]}%, ${vec.from[1]}%)`,
        transition: 'none',
      });
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = requestAnimationFrame(() => {
          setStyle({
            transform: `scale(${t.overscan}) translate(${vec.to[0]}%, ${vec.to[1]}%)`,
            transition: `transform ${t.durationMs}ms ${t.easing}`,
          });
        });
      });
      return undefined;
    }

    // hardCutSequence never reaches here -- the sequencer emits concrete
    // static-shot commands, so viewers only ever see wide/closeUp/bRoll cuts.
    return undefined;
  }, [command]);

  useEffect(() => () => rafRef.current && cancelAnimationFrame(rafRef.current), []);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', background: '#011627' }}>
      <div style={{ width: '100%', height: '100%', willChange: 'transform', ...style }}>
        {trackRef ? (
          <VideoTrack trackRef={trackRef} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : placeholder}
      </div>
    </div>
  );
}

// A single video layer that fades itself in on mount -- used for the
// 'fade' transition path only; 'cut' layers render at opacity 1
// immediately (see ShotVideo). Stacking one of these per recent track is
// what produces the dissolve -- the old layer stays fully visible
// underneath while the new one fades in on top, so there's never a
// dark/empty frame between them.
function ShotFadeLayer({ trackRef, command, placeholder, instant }) {
  const [visible, setVisible] = useState(instant);
  useEffect(() => {
    if (instant) return undefined;
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
  }, [instant]);
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        opacity: visible ? 1 : 0,
        transition: instant ? 'none' : `opacity ${FADE_MS}ms ease`,
      }}
    >
      <ShotTransformFrame trackRef={trackRef} command={command} placeholder={placeholder} />
    </div>
  );
}

// Renders whichever track is "current" for a slot. A 'cut' transition
// (staccato, zoom, any shot whose grammar demands it) replaces the layer
// instantly -- no stacking, no overlap, no opacity transition. A 'fade'
// keeps the previous track mounted just long enough to crossfade into the
// new one (the same dissolve this always did, now timed to FADE_MS from
// the shot grammar instead of a hardcoded value). Only the top (newest)
// layer ever receives the live `command` -- an older layer mid-exit is
// frozen at whatever transform it last had; it's about to disappear.
function ShotVideo({ trackRef, command, placeholder }) {
  const [layers, setLayers] = useState(() => (trackRef ? [{ key: 'init', trackRef }] : []));
  const currentKeyRef = useRef(trackKey(trackRef));

  useEffect(() => {
    const newKey = trackKey(trackRef);
    if (newKey === currentKeyRef.current) return undefined;
    currentKeyRef.current = newKey;
    const layerKey = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    if (command?.transition === 'cut') {
      // One atomic state set: no fade layer, no overlap, no opacity
      // transition -- an instant swap.
      setLayers([{ key: layerKey, trackRef }]);
      return undefined;
    }

    setLayers((prev) => [...prev, { key: layerKey, trackRef }]);
    const timer = setTimeout(() => {
      setLayers((prev) => prev.slice(-1));
    }, FADE_MS + 100); // slightly longer than the fade so it never clips
    return () => clearTimeout(timer);
  }, [trackRef, command]);

  if (layers.length === 0) return placeholder;

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
      {layers.map((l, i) => (
        <ShotFadeLayer
          key={l.key}
          trackRef={l.trackRef}
          command={i === layers.length - 1 ? command : null}
          placeholder={placeholder}
          instant={command?.transition === 'cut'}
        />
      ))}
    </div>
  );
}

// --- Join flow: performance mode first, then role -----------------------
// PRD ref: Multi-Camera & Production (Artist, Should/Phase 2).
// Scaling ref: Real-time video/audio -- camera feeds are just additional
// LiveKit participants in the same room; no architecture change needed,
// this scales the same way the rest of the room does.

export default function LiveDemo() {
  const [step, setStep] = useState('mode');
  const [performanceMode, setPerformanceMode] = useState(null);
  const [name, setName] = useState('');
  const [role, setRole] = useState('viewer'); // 'viewer' | 'a' | 'b' | 'camfeed-a' | 'camfeed-b'
  const [camRole, setCamRole] = useState('wide'); // camera position for camfeed devices: 'wide' | 'close' | 'side'
  const [conn, setConn] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [maximized, setMaximized] = useState(false);
  const toggleMaximize = useCallback(() => setMaximized((v) => !v), []);

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
  // Only a plain fan viewer gets the auto-hiding mobile sidebar -- main
  // performers and camera-feed devices keep the sidebar's normal behavior.
  const isViewerRole = conn.assignedRole === 'viewer';

  return (
    <PageShell active="live" hideSidebar={maximized} autoHideSidebar={isViewerRole}>
      <div className="live-room-shell">
        <LiveKitRoom
          token={conn.token}
          serverUrl={conn.url}
          connect
          audio={false}
          video={publishesVideo}
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

function RoomInner({ performanceMode, role, notice, selfName, maximized, onToggleMaximize, show, showState, now, onShowUpdate, onRefetchShow, showWriteError, onShowWriteErrorChange }) {
  const room = useRoomContext();
  const tracks = useTracks([Track.Source.Camera]);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [left, setLeft] = useState(false);
  const [comments, setComments] = useState([]);
  const [commentsExpanded, setCommentsExpanded] = useState(false);
  const [activeCamera, setActiveCamera] = useState({ a: null, b: null }); // slot -> identity of the live feed
  const [activeShot, setActiveShot] = useState({}); // slot -> full SHOT_COMMAND (shot, transition, targetIdentity, params...)
  const [audioNodes, setAudioNodes] = useState(null);
  const [audioContext, setAudioContext] = useState(null);
  const audioHandleRef = useRef(null);

  // Collapsed by default so it never covers the video on mobile -- see
  // the .director-panel rules in reactions.css. Function over polish
  // per the shot-integration spec; restyle once the test plan passes.
  const [directorPanelOpen, setDirectorPanelOpen] = useState(false);

  // Same collapsed-by-default reasoning as directorPanelOpen -- QR codes
  // are a setup-time tool, not something that needs to stay on screen
  // once cameras are paired.
  const [qrPanelOpen, setQrPanelOpen] = useState(false);

  const isMainPerformer = role === 'a' || role === 'b';
  const isCamFeed = typeof role === 'string' && role.startsWith('camfeed-');
  const camFeedSlot = isCamFeed ? role.split('-')[1] : null;

  // Only the main performer publishes the Case 2 processed audio track.
  // Extra camera-feed devices are video-only, never audio.
  useEffect(() => {
    if (!isMainPerformer) return;
    (async () => {
      const handle = await createPilotAudioTrack();
      audioHandleRef.current = handle;
      // audioHandleRef is a ref, not state -- setting it alone doesn't
      // trigger a re-render, so PerformerDeck's AudioDeckPanel would never
      // see the live Web Audio nodes once the async setup above resolves.
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
  // PerformerDeck's own picker, untouched -- this is just the callback it
  // already calls) is now a human SHOT_COMMAND using the nearest shot for
  // that feed's role, not the old untracked 'active-camera' message --
  // so direct picks get logged to the flywheel like every other cut, and
  // 'active-camera' (now unused on both send and receive) is fully retired.
  const setActiveForSlot = useCallback((letter, identity) => {
    // Local-only UI highlight for PerformerDeck's own picker -- no longer
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

  const renderSlot = (letter) => () => {
    const candidates = tracksForSlot(letter);
    const cmd = activeShot[letter];
    const chosen =
      (cmd?.targetIdentity &&
        candidates.find((t) => t.participant.identity === cmd.targetIdentity)) ||
      candidates.find((t) => t.participant.identity.startsWith(`contestant-${letter}-`)) ||
      candidates[0];

    const isInterstitial = displayShowState === 'live' && candidates.length === 0;
    const wasInterstitial = wasInterstitialRef.current[letter];
    wasInterstitialRef.current[letter] = isInterstitial;

    const placeholder = isInterstitial
      ? BE_RIGHT_BACK_PLACEHOLDER
      : <span>waiting for {performanceMode === 'solo' ? 'performer' : `contestant ${letter}`}...</span>;

    const effectiveCommand = !isInterstitial && wasInterstitial && cmd ? { ...cmd, transition: 'cut' } : cmd;

    return <ShotVideo trackRef={chosen} command={effectiveCommand} placeholder={placeholder} />;
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
            <VideoTrack trackRef={myTrack} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <span>starting camera...</span>
          )}
        </div>
        <div className="mic-cam-controls">
          <button className={`control-btn ${!camOn ? 'off' : ''}`} onClick={toggleCam}>
            {camOn ? <VideoCamera size={16} weight="bold" /> : <VideoCameraSlash size={16} weight="bold" />}
            {camOn ? 'Camera off' : 'Camera on'}
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
    }
  }, [isMainPerformer, showState, send]);

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
    onStageClick: collapseComments,
    comments,
    sendComment,
    commentsExpanded,
    onCommentsExpand: () => setCommentsExpanded(true),
    onCommentsCollapse: () => setCommentsExpanded(false),
  };

  return (
    <div style={{ position: 'relative', width: '100%', minHeight: '100vh' }}>
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
          toggleMic={toggleMic}
          toggleCam={toggleCam}
          tracksForSlot={tracksForSlot}
          activeCamera={activeCamera}
          setActiveForSlot={setActiveForSlot}
          audioNodes={audioNodes}
          audioContext={audioContext}
        />
      ) : displayShowState === 'ended' ? (
        <EndedCard />
      ) : displayShowState === 'scheduled' || displayShowState === 'soundcheck' ? (
        <HoldingScreen show={show} now={now} />
      ) : (
        <ViewerStage {...stageProps} />
      )}

      {/* Sibling from RoomInner, not nested in BroadcastStage/PerformerDeck
          -- keeps PerformerDeck.jsx and VideoDeckPanel.jsx untouched.
          Fixed-position bottom drawer, collapsed by default: reachable
          while the show is visible, never covers the video on mobile. */}
      {isMainPerformer && (
        <div className={`director-panel ${directorPanelOpen ? 'open' : ''}`}>
          <button
            type="button"
            className="director-panel-toggle"
            onClick={() => setDirectorPanelOpen((v) => !v)}
          >
            {directorPanelOpen ? 'HIDE SHOTS' : 'SHOTS'}
          </button>
          {directorPanelOpen && (
            <div className="director-panel-body">
              <DirectorShotPanel
                room={room}
                showId={ROOM_NAME}
                slot={role}
                availableRoles={directorAvailableRoles}
                tracks={tracks}
                showPhase={showPhase}
                onExclusiveMode={(on) => (on ? auto?.suspend() : auto?.resume())}
                onHumanCommand={() => auto?.notifyHumanCommand()}
                onCommand={(cmd) => setActiveShot((prev) => ({ ...prev, [cmd.slot]: cmd }))}
                autoState={autoState}
                onToggleAuto={() => (autoState === 'off' ? auto?.enable() : auto?.disable())}
              />
            </div>
          )}
        </div>
      )}

      {/* Add-camera QR panel (SHOW_LIFECYCLE_SPEC.md section 4) -- same
          sibling-from-RoomInner placement rule as the shot panel above,
          top-right so it doesn't compete with the bottom drawer or the
          top-center lifecycle banner. Setup-time only, collapsed by
          default. */}
      {isMainPerformer && (
        <div className={`camera-qr-panel ${qrPanelOpen ? 'open' : ''}`}>
          <button
            type="button"
            className="director-panel-toggle"
            onClick={() => setQrPanelOpen((v) => !v)}
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
