'use client';

// components/CamPage.jsx
// ─────────────────────────────────────────────────────────────
// QR-paired extra camera device (SHOW_LIFECYCLE_SPEC.md L5, "camera
// device picker + 1080p constraints" amendment folded in).
//
// URL shape: /cam?room={room_name}&slot={slot}&role={wide|close|side}
// If `role` is missing, shows the Wide/Close/Side picker first (same
// visual pattern as the join flow's picker from Edit 1 -- not literally
// shared code, since that one is inline JSX in LiveDemo.jsx, not an
// extracted component).
//
// Deliberately does NOT use the declarative <LiveKitRoom video> prop --
// that publishes the browser's default camera with default constraints,
// with no way to pick a device or resolution. Instead connects with
// video={false} and manually calls localParticipant.setCameraEnabled()
// with an explicit deviceId + 1080p resolution once the operator has
// chosen a camera, inside a small child component (CamPublisher) that
// has room context via the same useRoomContext()/useTracks() pattern
// already used for camfeed devices in LiveDemo.jsx.
// ─────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  LiveKitRoom,
  VideoTrack,
  useTracks,
  useRoomContext,
} from '@livekit/components-react';
import { Track } from 'livekit-client';
import '@livekit/components-styles';
import { useSourceDimensions } from '../lib/useSourceDimensions';
import { createRotationProcessor, ROTATION_OPTIONS_DEG } from '../lib/rotationProcessor';

const INK = '#011627';
const PORCELAIN = '#fdfffc';
const TEAL = '#2ec4b6';

// Portrait is the output target always (Stage 1 of the portrait capture
// work) -- requested uniformly, for every source picked from the device
// list below, not just phones. Ideal (not exact): a phone delivers
// portrait already based on how it's held, regardless of this request;
// a fixed landscape-only source (webcam, capture card, picked via the
// deviceId list below) simply can't satisfy a portrait ideal and falls
// back to its own best available landscape mode with no error --
// getUserMedia only hard-fails on {exact: ...}/min/max constraints,
// never on bare/ideal values. What actually gets delivered is read back
// afterwards via useSourceDimensions (lib/useSourceDimensions.js),
// never assumed from this request or from which device was picked.
const HIGH_RES_VIDEO_CAPTURE = { resolution: { width: 1080, height: 1920 }, frameRate: { ideal: 30 } };

const ROLE_OPTIONS = [
  { value: 'wide', label: 'Wide' },
  { value: 'close', label: 'Close' },
  { value: 'side', label: 'Side' },
];

export default function CamPage() {
  const searchParams = useSearchParams();
  const room = searchParams.get('room') || 'pilot-room';
  const slot = searchParams.get('slot');

  const [role, setRole] = useState(searchParams.get('role'));
  const [devices, setDevices] = useState([]);
  const [deviceId, setDeviceId] = useState(null);
  // Only true once the operator has actually touched the dropdown --
  // otherwise deviceId just holds enumerateDevices()'s arbitrary first
  // entry, and rear-by-default (via facingMode) should win instead.
  const [deviceChosen, setDeviceChosen] = useState(false);
  const [deviceError, setDeviceError] = useState('');
  const [conn, setConn] = useState(null);
  const [connectError, setConnectError] = useState('');

  // Device labels only populate after permission is granted, so a
  // throwaway getUserMedia call comes first -- the track from it is
  // stopped immediately; the real publish happens later via
  // setCameraEnabled once a role AND a device are both chosen.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const probe = await navigator.mediaDevices.getUserMedia({ video: true });
        probe.getTracks().forEach((t) => t.stop());
        const list = await navigator.mediaDevices.enumerateDevices();
        if (cancelled) return;
        const cams = list.filter((d) => d.kind === 'videoinput');
        setDevices(cams);
        setDeviceId((prev) => prev || cams[0]?.deviceId || null);
      } catch (e) {
        if (!cancelled) setDeviceError(`Camera permission is required to pair this device. (${e?.name}: ${e?.message})`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Re-enumerate on devicechange (e.g. a capture card plugged in after
  // the page already loaded) -- no getUserMedia re-probe needed here,
  // permission (and therefore labels) is already granted by this point
  // in any path that reaches this effect meaningfully.
  useEffect(() => {
    function handleDeviceChange() {
      navigator.mediaDevices.enumerateDevices().then((list) => {
        setDevices(list.filter((d) => d.kind === 'videoinput'));
      });
    }
    navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange);
    return () => navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange);
  }, []);

  async function handleGoLive() {
    setConnectError('');
    try {
      const identity = `camfeed-${slot}-${role}-${Date.now()}-qr`;
      const res = await fetch(
        `/api/token?room=${encodeURIComponent(room)}&identity=${encodeURIComponent(identity)}&camfeed=${slot}`
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Token request failed');
      setConn({ token: data.token, url: data.url });
    } catch (e) {
      setConnectError(e.message);
    }
  }

  const pageStyle = {
    minHeight: '100vh',
    width: '100%',
    background: INK,
    color: PORCELAIN,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    padding: 24,
    boxSizing: 'border-box',
    textAlign: 'center',
  };

  if (!slot) {
    return (
      <div style={pageStyle}>
        <p>This link is missing a slot -- scan the QR code from the artist&apos;s broadcast screen again.</p>
      </div>
    );
  }

  if (!role) {
    return (
      <div style={pageStyle}>
        <h2 style={{ margin: 0 }}>Camera position</h2>
        <div style={{ display: 'flex', gap: 8, width: '100%', maxWidth: 320 }}>
          {ROLE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setRole(opt.value)}
              style={{ flex: 1, padding: 14, borderRadius: 8, background: 'rgba(253, 255, 252, 0.06)', color: PORCELAIN, border: '1px solid rgba(253, 255, 252, 0.2)' }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (!conn) {
    return (
      <div style={pageStyle}>
        <h2 style={{ margin: 0 }}>Camera: {role.toUpperCase()}</h2>
        {deviceError ? (
          <p style={{ color: '#e71d36' }}>{deviceError}</p>
        ) : devices.length === 0 ? (
          <p style={{ opacity: 0.6, fontSize: 13 }}>Requesting camera access...</p>
        ) : devices.length > 1 ? (
          <select
            value={deviceId || ''}
            onChange={(e) => {
              setDeviceId(e.target.value);
              setDeviceChosen(true);
            }}
            style={{ width: '100%', maxWidth: 320, padding: 10, borderRadius: 8, background: 'rgba(253, 255, 252, 0.06)', color: PORCELAIN, border: '1px solid rgba(253, 255, 252, 0.2)' }}
          >
            {devices.map((d, i) => (
              <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera ${i + 1}`}</option>
            ))}
          </select>
        ) : (
          <p style={{ opacity: 0.6, fontSize: 13 }}>Using {devices[0].label || 'this device’s only camera'}</p>
        )}
        <button
          type="button"
          onClick={handleGoLive}
          disabled={!deviceId}
          style={{ padding: 14, width: '100%', maxWidth: 320, borderRadius: 8, background: TEAL, color: INK, fontWeight: 700, opacity: deviceId ? 1 : 0.5 }}
        >
          Go live as {role.toUpperCase()}
        </button>
        {connectError && <p style={{ color: '#e71d36' }}>{connectError}</p>}
      </div>
    );
  }

  return (
    <LiveKitRoom
      token={conn.token}
      serverUrl={conn.url}
      connect
      audio={false}
      video={false}
      data-lk-theme="default"
      style={{ height: '100vh', width: '100%' }}
    >
      <CamPublisher deviceId={deviceId} deviceChosen={deviceChosen} onDeviceIdChange={setDeviceId} role={role} />
    </LiveKitRoom>
  );
}

// 1080p target resolution + explicit device selection, per the L5
// amendment -- neither is possible via <LiveKitRoom>'s blunt `video`
// prop, which is why this connects with video={false} above and
// publishes manually here instead.
function CamPublisher({ deviceId, deviceChosen, onDeviceIdChange, role }) {
  const room = useRoomContext();
  const tracks = useTracks([Track.Source.Camera]);
  const myTrack = tracks.find((t) => t.participant.identity === room.localParticipant.identity);
  const [facingMode, setFacingMode] = useState('environment');
  // Real DOM <video> element VideoTrack renders -- VideoTrack forwards
  // its ref to the underlying element (confirmed against
  // @livekit/components-react's source), needed to inspect
  // srcObject/paused/readyState/videoWidth directly, none of which are
  // reachable through the LiveKit track objects alone.
  const videoElRef = useRef(null);
  // Stage 1 of the portrait capture work -- what's actually being
  // delivered right now, read live off the real track. Debug-only;
  // doesn't drive rendering here (object-fit: cover on the portrait-
  // shaped preview below already does the right thing either way).
  const myCameraPublication = room.localParticipant.getTrackPublication(Track.Source.Camera);
  // rotationVersion is bumped on every successful rotation change so
  // useSourceDimensions re-checks against the processor's (rotated)
  // output instead of the raw pre-rotation track -- see its own comment
  // for why this can't be discovered automatically.
  const [rotationVersion, setRotationVersion] = useState(0);
  const sourceDims = useSourceDimensions(myCameraPublication, rotationVersion);

  // Manual, opt-in rotation correction for a landscape/capture-card
  // source whose delivered frame lies about its own orientation (see
  // lib/rotationProcessor.js) -- default 0deg/off, never applied unless
  // the operator picks a non-zero option below by eye. rotationRef holds
  // the currently-attached processor instance (or null) so a later call
  // can stop/replace it; not component state, since the processor
  // object itself isn't meant to trigger re-renders.
  const [rotation, setRotation] = useState(0);
  const [rotationError, setRotationError] = useState('');
  const rotationProcessorRef = useRef(null);

  // No processor is ever attached unless the operator explicitly picks a
  // non-zero rotation below (the 0deg branch only ever calls
  // stopProcessor, never setProcessor) -- the default/untouched path is
  // the original, proven, processor-free pipeline: setCameraEnabled's
  // raw published track straight through, same as before this feature
  // existed. Nothing else in the codebase calls setProcessor (verified
  // by grep) or auto-invokes this function -- it only ever runs from
  // the buttons' onClick below.
  const applyRotation = useCallback(async (degrees) => {
    const videoTrack = room.localParticipant.getTrackPublication(Track.Source.Camera)?.videoTrack;
    if (!videoTrack) return;
    setRotationError('');
    try {
      if (degrees === 0) {
        // Ask the track itself, not just our own ref -- a ref can only
        // ever be as trustworthy as the render cycle that set it; the
        // track's own getProcessor() is the actual source of truth for
        // whether one is really attached, so cleanup can't silently
        // skip (or double-run) if the two ever drift.
        if (videoTrack.getProcessor?.()) {
          await videoTrack.stopProcessor();
        }
        rotationProcessorRef.current = null;
      } else {
        const processor = createRotationProcessor(degrees);
        // showProcessedStreamLocally: true -- the operator's own preview
        // shows the corrected result too, so they can pick the right
        // rotation by eye rather than guessing blind.
        await videoTrack.setProcessor(processor, true);
        rotationProcessorRef.current = processor;
      }
      setRotation(degrees);
      setRotationVersion((v) => v + 1);
    } catch (e) {
      // Confirmed against the compiled SDK source: setProcessor only
      // calls sender.replaceTrack() AFTER processor.init() resolves, so
      // a failure here never touches what's currently published --
      // whatever rotation (including 0/off) was working before stays
      // working. Deliberately NOT resetting `rotation` state to 0 here:
      // it should keep reflecting whatever's actually still live, not
      // silently imply the failed pick took effect.
      console.error('[cam] rotation failed', e);
      setRotationError('Rotation failed -- feed is still publishing normally.');
    }
  }, [room]);

  // DEBUG -- the real outcome of setCameraEnabled, on screen. This call
  // previously had no error handling at all: if it rejected for any
  // reason, the failure was completely silent -- myTrack would just
  // never resolve, with nothing to say why. This doesn't fix anything,
  // it makes the actual error (if there is one) visible instead of
  // guessed at.
  const [acquireResult, setAcquireResult] = useState({ status: 'pending' });

  useEffect(() => {
    let cancelled = false;
    // Verified against the installed livekit-client source
    // (constraintsForOptions in dist/livekit-client.esm.mjs): plain
    // numbers in `resolution` are flattened unwrapped into the
    // getUserMedia constraint set, and a bare number there is already
    // "ideal" per the Web platform's constraint algorithm -- only
    // {exact: ...} hard-fails. frameRate isn't part of VideoResolution
    // though, so it needs its own explicit {ideal: 30} here, on the
    // separate top-level frameRate field VideoCaptureOptions exposes
    // for exactly this (typed as a full ConstrainDouble, not a plain
    // number like width/height) -- explicit rather than relying on
    // implicit bare-number semantics, so the "never hard-fail" intent
    // is visible in the code itself.
    //
    // If the operator explicitly picked a device from the L5 dropdown,
    // honor that deviceId. Otherwise default to the rear camera via
    // facingMode instead of enumerateDevices()'s arbitrary first entry.
    (async () => {
      setAcquireResult({ status: 'pending' });
      try {
        await room.localParticipant.setCameraEnabled(
          true,
          deviceChosen
            ? { deviceId, ...HIGH_RES_VIDEO_CAPTURE }
            : { facingMode: 'environment', ...HIGH_RES_VIDEO_CAPTURE }
        );
        if (!cancelled) setAcquireResult({ status: 'success' });
      } catch (e) {
        console.error('[cam] setCameraEnabled failed', e);
        if (!cancelled) setAcquireResult({ status: 'error', name: e?.name, message: e?.message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [room, deviceChosen, deviceId]);

  // Clean live swap: LocalVideoTrack.restartTrack replaces the sender's
  // MediaStreamTrack in place (RTCRtpSender.replaceTrack under the hood)
  // -- no unpublish/republish, no renegotiation, no dropped frame for
  // viewers. Resyncs deviceId afterwards so the (deviceId-based) L5
  // dropdown never goes stale against a facingMode-driven swap.
  const toggleFacingMode = useCallback(async () => {
    const videoTrack = room.localParticipant.getTrackPublication(Track.Source.Camera)?.videoTrack;
    if (!videoTrack) return;
    const next = facingMode === 'environment' ? 'user' : 'environment';
    try {
      await videoTrack.restartTrack({ facingMode: next, ...HIGH_RES_VIDEO_CAPTURE });
      setFacingMode(next);
      onDeviceIdChange(videoTrack.mediaStreamTrack.getSettings().deviceId ?? null);
      setAcquireResult({ status: 'success' });
    } catch (e) {
      console.error('[cam] facingMode restartTrack failed', e);
      setAcquireResult({ status: 'error', name: e?.name, message: e?.message, context: 'facingMode toggle' });
    }
  }, [facingMode, room, onDeviceIdChange]);

  // DEBUG -- full acquisition -> attachment -> play -> dimensions chain,
  // on screen. The camera shows in Chrome's own device chooser but not
  // on this page, which means the stream IS being acquired -- something
  // downstream isn't rendering it. Rather than guess which link broke,
  // poll every 400ms and show every link at once: LiveKit's publication/
  // track wrapper, the raw MediaStreamTrack (readyState + getSettings),
  // and the actual DOM <video> element (srcObject/paused/readyState/
  // videoWidth) -- that last group is the part nothing else in this file
  // inspects directly, and is exactly where "acquired but not attached"
  // vs "attached but not playing" vs "playing but no dimensions" would
  // show up.
  const [chainSnapshot, setChainSnapshot] = useState(null);

  useEffect(() => {
    const interval = setInterval(() => {
      const pub = room.localParticipant.getTrackPublication(Track.Source.Camera);
      const videoTrack = pub?.videoTrack;
      const mst = videoTrack?.mediaStreamTrack;
      const settings = mst?.getSettings?.();
      const videoEl = videoElRef.current;
      const srcObject = videoEl?.srcObject;
      setChainSnapshot({
        publicationFound: !!pub,
        videoTrackFound: !!videoTrack,
        mstFound: !!mst,
        mstReadyState: mst?.readyState ?? null,
        mstId: mst?.id ?? null,
        settingsWidth: settings?.width ?? null,
        settingsHeight: settings?.height ?? null,
        videoElFound: !!videoEl,
        srcObjectSet: !!srcObject,
        srcObjectTrackCount: srcObject?.getVideoTracks?.().length ?? 0,
        paused: videoEl ? videoEl.paused : null,
        readyState: videoEl ? videoEl.readyState : null,
        videoWidth: videoEl ? videoEl.videoWidth : null,
        videoHeight: videoEl ? videoEl.videoHeight : null,
        currentTime: videoEl ? videoEl.currentTime : null,
      });
    }, 400);
    return () => clearInterval(interval);
  }, [room]);

  // DEBUG -- WHY does the track go from 'live' to 'ended'? The native
  // 'ended' event alone confirms WHEN but gives no stack, since the
  // browser dispatches it asynchronously regardless of what triggered
  // it. To catch WHERE, this monkey-patches .stop() on both the raw
  // MediaStreamTrack and the LiveKit LocalVideoTrack wrapper the moment
  // either becomes available -- reassigning an own-instance method
  // shadows the prototype's for this one track only, and is restored on
  // cleanup. Patching BOTH layers matters: if OUR code (or LiveKit's own
  // internals, e.g. a restart swapping tracks) calls either one, the
  // patched version runs first and records a real call stack before
  // deferring to the original. If the track still ends with NEITHER
  // patched stop() ever firing, that's strong evidence it's being ended
  // externally -- the browser, the OS, another tab, or the hardware
  // itself -- not by any JS running on this page.
  const [endedInfo, setEndedInfo] = useState(null);
  const trackSidForLifecycle = myCameraPublication?.trackSid;

  useEffect(() => {
    const videoTrack = myCameraPublication?.videoTrack;
    const mst = videoTrack?.mediaStreamTrack;
    if (!videoTrack || !mst) return undefined;

    const acquiredAt = Date.now();
    setEndedInfo({ acquiredAt, status: 'live' });

    function shortStack(stack) {
      return (stack || '').split('\n').slice(1, 6).join(' | ');
    }

    const originalWrapperStop = typeof videoTrack.stop === 'function' ? videoTrack.stop.bind(videoTrack) : null;
    const originalRawStop = mst.stop.bind(mst);

    if (originalWrapperStop) {
      videoTrack.stop = function (...args) {
        const stack = new Error().stack;
        console.error('[cam][lifecycle] LocalVideoTrack.stop() called', stack);
        setEndedInfo((prev) => ({ ...(prev || {}), wrapperStopAt: Date.now(), wrapperStopStack: shortStack(stack) }));
        return originalWrapperStop(...args);
      };
    }

    mst.stop = function (...args) {
      const stack = new Error().stack;
      console.error('[cam][lifecycle] MediaStreamTrack.stop() called', stack);
      setEndedInfo((prev) => ({ ...(prev || {}), rawStopAt: Date.now(), rawStopStack: shortStack(stack) }));
      return originalRawStop(...args);
    };

    function handleEnded() {
      console.error('[cam][lifecycle] MediaStreamTrack "ended" event fired');
      setEndedInfo((prev) => ({ ...(prev || {}), endedEventAt: Date.now(), status: 'ended' }));
    }
    mst.addEventListener('ended', handleEnded);

    return () => {
      if (originalWrapperStop) videoTrack.stop = originalWrapperStop;
      mst.stop = originalRawStop;
      mst.removeEventListener('ended', handleEnded);
    };
  }, [trackSidForLifecycle]);

  // Keeps a propped phone from sleeping mid-show. Not all browsers
  // support the Wake Lock API -- silently ignored where they don't,
  // exactly as the spec calls for.
  useEffect(() => {
    let wakeLock = null;
    (async () => {
      try {
        wakeLock = await navigator.wakeLock?.request('screen');
      } catch {
        // Unsupported or blocked -- no-op.
      }
    })();
    return () => {
      wakeLock?.release?.().catch(() => {});
    };
  }, []);

  // Release the canvas/video-element resources behind an active
  // rotation processor if this component ever unmounts without the
  // operator switching back to 0deg first (e.g. a disconnect, not just
  // a tab close, which would tear everything down on its own anyway).
  useEffect(() => {
    return () => {
      rotationProcessorRef.current?.destroy?.();
    };
  }, []);

  return (
    <div style={{ position: 'fixed', inset: 0, background: INK }}>
      {myTrack ? (
        <VideoTrack
          ref={videoElRef}
          trackRef={myTrack}
          style={{ width: '100%', height: '100%', objectFit: 'cover', transform: facingMode === 'user' ? 'scaleX(-1)' : 'none' }}
        />
      ) : (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: PORCELAIN }}>
          Starting camera...
        </div>
      )}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          padding: '18px 0',
          background: INK,
          color: PORCELAIN,
          fontSize: 22,
          fontWeight: 700,
          letterSpacing: '0.1em',
          textAlign: 'center',
        }}
      >
        {role.toUpperCase()}
      </div>
      {/* DEBUG -- the full acquisition -> attachment -> play -> dimensions
          chain, on screen, in order, so the exact broken link is
          visible instead of guessed at. Safe to delete once the real
          cause is found and fixed. */}
      <div
        style={{
          position: 'absolute',
          bottom: 8,
          left: 8,
          right: 8,
          padding: '8px 10px',
          borderRadius: 6,
          background: acquireResult.status === 'error' || sourceDims?.status === 'failed' ? 'rgba(231, 29, 54, 0.85)' : 'rgba(1, 22, 39, 0.8)',
          color: PORCELAIN,
          fontFamily: 'monospace',
          fontSize: 10,
          lineHeight: 1.5,
        }}
      >
        <div>
          1. ACQUIRE (setCameraEnabled): {acquireResult.status}
          {acquireResult.status === 'error' && ` -- ${acquireResult.name}: ${acquireResult.message}${acquireResult.context ? ` (${acquireResult.context})` : ''}`}
        </div>
        <div>2. publication: {chainSnapshot?.publicationFound ? 'found' : 'MISSING'}</div>
        <div>3. videoTrack (LiveKit wrapper): {chainSnapshot?.videoTrackFound ? 'found' : 'MISSING'}</div>
        <div>
          4. MediaStreamTrack: {chainSnapshot?.mstFound ? `found (readyState=${chainSnapshot.mstReadyState}, id=${chainSnapshot.mstId?.slice(0, 8)})` : 'MISSING'}
        </div>
        <div>
          5. getSettings(): {chainSnapshot?.settingsWidth ? `${chainSnapshot.settingsWidth}x${chainSnapshot.settingsHeight}` : 'no width/height'}
        </div>
        <div>6. &lt;video&gt; element (ref): {chainSnapshot?.videoElFound ? 'found' : 'MISSING -- ref never attached'}</div>
        <div>
          7. srcObject: {chainSnapshot?.srcObjectSet ? `set (${chainSnapshot.srcObjectTrackCount} video track${chainSnapshot.srcObjectTrackCount === 1 ? '' : 's'})` : 'NOT SET'}
        </div>
        <div>
          8. playback: paused={String(chainSnapshot?.paused)}, readyState={chainSnapshot?.readyState} (0=NOTHING..4=ENOUGH_DATA), currentTime={typeof chainSnapshot?.currentTime === 'number' ? chainSnapshot.currentTime.toFixed(2) : '--'}
        </div>
        <div>
          9. video element size: {chainSnapshot?.videoWidth}x{chainSnapshot?.videoHeight}
        </div>
        <div>
          10. detection ({'>'}Stage 1{'<'}): {sourceDims?.status === 'ready'
            ? `${sourceDims.width}x${sourceDims.height} -- ${sourceDims.isPortraitSource ? 'native portrait' : 'landscape (cropped)'}${sourceDims.attempts > 1 ? ` (${sourceDims.attempts} tries)` : sourceDims.attempts === 1 ? ' (1st try)' : ''}`
            : sourceDims?.status === 'failed'
              ? `FAILED after ${sourceDims.attempts} tries`
              : `detecting...${sourceDims?.attempts ? ` (retry ${sourceDims.attempts})` : ''}`}
        </div>
        {endedInfo && (
          <div style={{ marginTop: 4, borderTop: '1px solid rgba(253,255,252,0.25)', paddingTop: 4 }}>
            <div>
              11. TRACK LIFECYCLE: acquired
              {endedInfo.status === 'ended'
                ? ` -- ENDED ${endedInfo.endedEventAt - endedInfo.acquiredAt}ms later`
                : ' -- still live'}
            </div>
            {endedInfo.wrapperStopAt && (
              <div>-- LocalVideoTrack.stop() called at +{endedInfo.wrapperStopAt - endedInfo.acquiredAt}ms: {endedInfo.wrapperStopStack}</div>
            )}
            {endedInfo.rawStopAt && (
              <div>-- MediaStreamTrack.stop() called at +{endedInfo.rawStopAt - endedInfo.acquiredAt}ms: {endedInfo.rawStopStack}</div>
            )}
            {endedInfo.status === 'ended' && !endedInfo.wrapperStopAt && !endedInfo.rawStopAt && (
              <div>-- No .stop() intercepted on this page -- likely ended externally (browser/OS/hardware/another tab)</div>
            )}
          </div>
        )}
      </div>
      {/* A visible failure beats an infinite silent "detecting" wait --
          this is the actionable, operator-facing version of the same
          state the DEBUG label above reports more tersely. */}
      {sourceDims?.status === 'failed' && (
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            padding: '14px 18px',
            borderRadius: 8,
            background: 'rgba(1, 22, 39, 0.9)',
            border: '1px solid #e71d36',
            color: PORCELAIN,
            fontSize: 13,
            textAlign: 'center',
            maxWidth: 280,
          }}
        >
          Couldn&apos;t detect camera resolution -- try reselecting the device or reloading.
        </div>
      )}
      <button
        type="button"
        onClick={toggleFacingMode}
        style={{
          position: 'absolute',
          bottom: 24,
          right: 24,
          padding: '10px 16px',
          borderRadius: 8,
          background: 'rgba(1, 22, 39, 0.7)',
          color: PORCELAIN,
          border: '1px solid rgba(253, 255, 252, 0.3)',
          fontWeight: 700,
          fontSize: 13,
        }}
      >
        Flip to {facingMode === 'environment' ? 'front' : 'rear'}
      </button>

      {/* Manual rotation for a landscape/capture-card source whose
          delivered frame lies about its own orientation -- there's no
          reliable way to auto-detect this, so it's opt-in and by-eye:
          pick whichever option makes the preview above look upright.
          Not phone-relevant (phones already deliver correct portrait),
          but left always-visible here rather than gated behind a
          device-type guess -- small and clearly optional, doesn't
          block or complicate the common case where nobody touches it. */}
      <div style={{ position: 'absolute', top: 70, left: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {ROTATION_OPTIONS_DEG.map((deg) => (
            <button
              key={deg}
              type="button"
              onClick={() => applyRotation(deg)}
              style={{
                padding: '6px 10px',
                borderRadius: 6,
                background: rotation === deg ? TEAL : 'rgba(1, 22, 39, 0.7)',
                color: rotation === deg ? INK : PORCELAIN,
                border: '1px solid rgba(253, 255, 252, 0.3)',
                fontWeight: 700,
                fontSize: 12,
              }}
            >
              {deg}°
            </button>
          ))}
        </div>
        {rotationError && (
          <span style={{ fontSize: 11, color: '#e71d36', maxWidth: 200 }}>{rotationError}</span>
        )}
      </div>
    </div>
  );
}
