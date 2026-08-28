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
// USES the declarative <LiveKitRoom video={...}> prop, passing it the
// full VideoCaptureOptions object (deviceId + 1080p resolution) rather
// than a boolean -- @livekit/components-react's LiveKitRoom forwards a
// non-boolean `video` prop straight through as setCameraEnabled's
// options argument (verified against its compiled source), so this
// gets the exact constrained acquisition previously done via a manual
// setCameraEnabled(true, {...}) call, without a second caller.
//
// That manual call used to run from video={false} plus an effect in a
// child component (CamPublisher) -- deliberately, to allow picking a
// device/resolution the boolean prop can't express. It regressed hard:
// LiveKitRoom's OWN internal effect calls setCameraEnabled(false, ...)
// on every RoomEvent.SignalConnected specifically because video={false}
// told it camera-should-be-off -- including on a mid-session reconnect,
// which raced against the manual enable that was still mid-acquisition
// and killed the track, confirmed via the on-screen event log below
// (real timestamps: enable starts, SignalConnected+disable fires while
// still pending, enable "succeeds" with what's now a dead track).
// video={<options>} removes the second caller entirely -- there's only
// ever one thing telling LiveKit what the camera should be, so nothing
// is left to fight it, on the initial connect OR a later reconnect.
// ─────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  LiveKitRoom,
  VideoTrack,
  useTracks,
  useRoomContext,
} from '@livekit/components-react';
import { Track, TrackEvent, RoomEvent } from 'livekit-client';
import '@livekit/components-styles';
import ReleaseOnShowEnd from './ReleaseOnShowEnd';
import { useSourceDimensions, useNativeIsLandscape, landscapeNativeCaptureOptions } from '../lib/useSourceDimensions';
import { createPortraitProcessor, ROTATION_OPTIONS_DEG } from '../lib/rotationProcessor';

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
//
// aspectRatio + a single dimension (height), NOT width+height as two
// independent ideals -- confirmed on real hardware (Sony via capture
// card) that the old {width:1080, height:1920} pair invites a driver
// with continuous/software resolution scaling to hit both axes exactly
// by non-uniformly stretching a native 16:9 sensor frame into a
// 1080x1920 buffer (an anamorphic squeeze baked into the delivered
// pixels -- observed live as getSettings() reporting 1080x1200 for what
// was actually a 1920x1080 source). aspectRatio expresses "keep this
// shape" rather than handing the solver two unrelated free axes, so a
// landscape-only source is no longer asked for a literal portrait (w,h)
// pair that isn't one of its real modes. A phone already delivering
// ~9:16 content sees no behavior change from this.
const HIGH_RES_VIDEO_CAPTURE = { resolution: { height: 1920, aspectRatio: 9 / 16 }, frameRate: { ideal: 30 } };

const ROLE_OPTIONS = [
  { value: 'wide', label: 'Wide' },
  { value: 'close', label: 'Close' },
  { value: 'side', label: 'Side' },
];

export default function CamPage() {
  const searchParams = useSearchParams();
  // No default room (Go Live threading round). The QR panel always
  // encodes the show's own room_name; a link arriving without one is a
  // stale/hand-edited link, and quietly publishing this camera into a
  // fixed fallback room is the worst possible answer to that -- same
  // reasoning, and now the same treatment, as a missing slot below.
  const room = searchParams.get('room');
  const slot = searchParams.get('slot');
  // Stage 1 (portrait capture + rotation) is verified on real hardware --
  // the verbose on-screen diagnostic panel that found the LiveKitRoom
  // video={false} race is off by default now, reachable again via
  // ?debug=1 if a future stage needs it. The bounded-retry detection and
  // its operator-facing failure banners are NOT gated -- those are a
  // permanent safety net, not debug tooling.
  const debugMode = searchParams.get('debug') === '1';

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
  // Surfaced via <LiveKitRoom onError>, which fires if the declarative
  // video-prop acquisition below rejects -- passed down to CamPublisher
  // purely for the DEBUG panel's "ACQUIRE" line, same as the manual
  // try/catch this replaces used to show on screen.
  const [liveKitRoomError, setLiveKitRoomError] = useState(null);
  // Terminal once set: the show is over, the camera is released, and
  // there is nothing this page can usefully do next.
  const [showOver, setShowOver] = useState(false);

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

  // ── RETIRED: this page can no longer publish ─────────────────
  //
  // Security round, 2026-08-28. This was the only caller of
  // `/api/token?camfeed=`, which handed out CAMERA-publish rights into
  // any room to anyone who asked — no code, no account, no check. That
  // branch is closed (app/api/token/route.js), so asking again would
  // now return a subscribe-only token and this page would sit there
  // failing to publish for reasons nobody could see.
  //
  // Saying so is better than a mystery. Pairing is the replacement and
  // it is strictly better: a six-character code, a per-device secret,
  // and a phone that follows the artist from Kit Check into the show
  // without being picked up again.
  function handleGoLive() {
    setConnectError(
      'This camera link is retired. Open Kit Check on your main device, tap ADD A CAMERA, and scan the code it shows you.'
    );
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

  if (!room || !slot) {
    return (
      <div style={pageStyle}>
        <p>
          This link is missing a {!room ? 'show' : 'slot'} -- scan the QR code from the artist&apos;s broadcast
          screen again.
        </p>
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

  // If the operator explicitly picked a device from the L5 dropdown,
  // honor that deviceId. Otherwise default to the rear camera via
  // facingMode instead of enumerateDevices()'s arbitrary first entry.
  // This is now the ONLY place camera constraints get decided -- passed
  // straight into LiveKitRoom's video prop below, not called again
  // manually anywhere.
  const videoCaptureOptions = deviceChosen
    ? { deviceId, ...HIGH_RES_VIDEO_CAPTURE }
    : { facingMode: 'environment', ...HIGH_RES_VIDEO_CAPTURE };

  if (showOver) {
    return (
      <div style={{ minHeight: '100vh', background: '#011627', color: '#fdfffc', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center' }}>
        <div style={{ maxWidth: 320 }}>
          <div style={{ fontSize: 10, letterSpacing: '0.14em', color: 'rgba(253,255,252,0.5)' }}>LOUDENTIFY</div>
          <div style={{ fontSize: 22, fontWeight: 700, marginTop: 6 }}>The show has ended</div>
          <div style={{ fontSize: 12.5, color: 'rgba(253,255,252,0.6)', marginTop: 8, lineHeight: 1.55 }}>
            This camera is off — the light on this device should be out. Nothing is being sent.
          </div>
        </div>
      </div>
    );
  }

  return (
    <LiveKitRoom
      token={conn.token}
      serverUrl={conn.url}
      connect
      audio={false}
      video={videoCaptureOptions}
      onError={(e) => setLiveKitRoomError({ name: e?.name, message: e?.message })}
      data-lk-theme="default"
      style={{ height: '100vh', width: '100%' }}
    >
      {/* End of show releases this camera too. /cam runs none of the
          live show's components, so before this nothing here was
          listening for SHOW_ENDED and the light stayed on indefinitely
          after End Show. */}
      <ReleaseOnShowEnd label="camfeed" onEnded={() => setShowOver(true)} />
      <CamPublisher onDeviceIdChange={setDeviceId} role={role} liveKitRoomError={liveKitRoomError} debugMode={debugMode} />
    </LiveKitRoom>
  );
}

function CamPublisher({ onDeviceIdChange, role, liveKitRoomError, debugMode }) {
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
  // Portrait-everything work -- RAW native orientation (never the
  // processor's own output; see useNativeIsLandscape's own comment for
  // why that distinction matters), used below to auto-attach the crop
  // processor for a landscape source and to gate the 0deg rotation
  // button's meaning (see applyRotation).
  // implausibleAspect: this source's raw dims claimed portrait but
  // matched no real camera aspect ratio -- see useNativeIsLandscape's
  // own comment. Drives the acquisition-side re-request effect below
  // (landscapeNativeCaptureOptions), not the crop processor -- a
  // downstream resample was tried and overcorrected on real hardware
  // (Sony via capture card: faces went from narrow to stretched wide).
  const { isLandscape, implausibleAspect } = useNativeIsLandscape(myCameraPublication);

  // DEBUG -- single unified timeline. Defined up here (not down by the
  // lifecycle effect that also uses it) so every acquisition/mute/
  // restart/reconnect call site below can log into the SAME sequence in
  // the order they actually happen -- the whole point is seeing whether
  // OUR OWN setCameraEnabled call fires more than once, versus something
  // internal to LiveKit (mute/unmute/restart, a reconnect) doing it
  // independently. Capped at the last 40 entries (generous -- these are
  // rare lifecycle events, not per-frame/per-poll noise) and rendered in
  // a scrollable box (see the panel below) so a long sequence never gets
  // silently cut off.
  const [eventLog, setEventLog] = useState([]);
  const mountedAtRef = useRef(Date.now());

  const logEvent = useCallback((label) => {
    if (!debugMode) return;
    const t = `+${Date.now() - mountedAtRef.current}ms`;
    console.error(`[cam][lifecycle] ${t} ${label}`);
    setEventLog((prev) => [...prev.slice(-39), `${t} ${label}`]);
  }, [debugMode]);

  // `rotation` is the operator's own by-eye pick (0/90/180/270, see the
  // picker below) for a source whose pixel content is sideways relative
  // to what it claims -- still manual/opt-in, there's no reliable way to
  // auto-detect that specific problem (see lib/rotationProcessor.js's
  // own comment). Separately, and NOT manual: any source whose RAW
  // native dimensions are landscape (isLandscape, above) gets
  // createPortraitProcessor auto-attached regardless of `rotation` --
  // that's the portrait-everything crop, not a rotation, and doesn't
  // need by-eye judgment, just "is it wider than it is tall". The two
  // compose in ONE processor (see rotationProcessor.js): `rotation`
  // supplies the degrees, `isLandscape` decides whether a processor is
  // attached at all. rotationProcessorRef holds the currently-attached
  // processor instance (or null) so a later call can stop/replace it;
  // not component state, since the processor object itself isn't meant
  // to trigger re-renders.
  const [rotation, setRotation] = useState(0);
  const [rotationError, setRotationError] = useState('');
  const rotationProcessorRef = useRef(null);

  // A native-portrait source (isLandscape === false) at 0deg gets NO
  // processor at all -- the original, proven, processor-free pipeline,
  // unchanged from before this feature existed. Every other combination
  // (any landscape source, even at 0deg/no manual rotation pick; or any
  // non-zero manual rotation pick regardless of isLandscape, since
  // isLandscape might still be resolving) goes through
  // createPortraitProcessor. Runs both from the buttons' onClick below
  // (manual `degrees` change) and automatically once isLandscape first
  // resolves true (see the effect below) -- same function either way.
  const applyRotation = useCallback(async (degrees) => {
    const videoTrack = room.localParticipant.getTrackPublication(Track.Source.Camera)?.videoTrack;
    if (!videoTrack) return;
    setRotationError('');
    logEvent(`applyRotation(${degrees}) called (isLandscape=${isLandscape})`);
    try {
      if (degrees === 0 && isLandscape === false) {
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
        const processor = createPortraitProcessor(degrees);
        // showProcessedStreamLocally: true -- the operator's own preview
        // shows the corrected result too, so they can pick the right
        // rotation by eye rather than guessing blind (and so a
        // landscape source's auto-applied crop is visible in their own
        // preview too, not just to viewers).
        await videoTrack.setProcessor(processor, true);
        rotationProcessorRef.current = processor;
      }
      setRotation(degrees);
      setRotationVersion((v) => v + 1);
    } catch (e) {
      // Confirmed against the compiled SDK source: setProcessor only
      // calls sender.replaceTrack() AFTER processor.init() resolves, so
      // a failure here never touches what's currently published --
      // whatever was working before stays working. Deliberately NOT
      // resetting `rotation` state to 0 here: it should keep reflecting
      // whatever's actually still live, not silently imply the failed
      // pick took effect.
      console.error('[cam] rotation/crop failed', e);
      setRotationError('Rotation/crop failed -- feed is still publishing normally.');
      logEvent(`applyRotation(${degrees}) FAILED: ${e?.name}: ${e?.message}`);
    }
  }, [room, logEvent, isLandscape]);

  // Auto-attach: the first time a given track's RAW orientation resolves
  // to landscape, apply the crop processor automatically at whatever
  // rotation is currently selected (0 unless the operator's already
  // touched the picker) -- this is what actually fixes a landscape
  // camfeed publishing raw/uncropped. Keyed on trackSid (not just a
  // single boolean latch) so a device swap to a NEW landscape source
  // re-triggers this for the new track too. A native-portrait source
  // never enters this branch at all -- isLandscape resolves false, this
  // effect is a no-op, exactly requirement 1 (zero processor, zero cost).
  const autoAppliedTrackSidRef = useRef(null);
  const myCameraTrackSid = myCameraPublication?.trackSid;
  useEffect(() => {
    if (isLandscape !== true) return;
    if (!myCameraTrackSid || autoAppliedTrackSidRef.current === myCameraTrackSid) return;
    autoAppliedTrackSidRef.current = myCameraTrackSid;
    applyRotation(rotation);
    // myCameraPublication/applyRotation/rotation deliberately omitted --
    // myCameraTrackSid is the stable identity that should actually
    // re-trigger this (getTrackPublication() isn't memoized, so the
    // object itself is a fresh reference every render); applyRotation
    // reads the live videoTrack itself when it runs, and re-including it
    // here would re-run this effect on every rotation state change too,
    // which is exactly the manual-picker path, not this auto one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLandscape, myCameraTrackSid]);

  // Acquisition-side fix for a squeezed source: implausibleAspect means
  // the driver anamorphically distorted the buffer trying to satisfy the
  // portrait ideal every source is normally requested with (see
  // HIGH_RES_VIDEO_CAPTURE, above) -- confirmed on real hardware (Sony
  // via capture card) that correcting this downstream, in the crop
  // processor, overcorrects (the resample factor doesn't match the
  // driver's actual distortion). The real fix is not asking a
  // landscape-only device for a shape it has to fake in the first place:
  // re-acquire the SAME device (landscapeNativeCaptureOptions reads its
  // deviceId off the current track) with its native landscape capability
  // instead, so the buffer arrives already correct and the existing
  // crop -- already proven on genuine landscape sources -- has nothing
  // left to correct for. Latched per trackSid (one attempt, not a
  // retry loop) -- same pattern as autoAppliedTrackSidRef above; if the
  // re-acquired track is STILL implausible, useNativeIsLandscape's
  // TrackEvent.Restarted rebind will report that and this won't fire
  // again for the same track, just stays flagged and cropped.
  const reacquiredForSqueezeRef = useRef(null);
  useEffect(() => {
    if (!implausibleAspect) return;
    if (!myCameraTrackSid || reacquiredForSqueezeRef.current === myCameraTrackSid) return;
    reacquiredForSqueezeRef.current = myCameraTrackSid;
    const videoTrack = room.localParticipant.getTrackPublication(Track.Source.Camera)?.videoTrack;
    const mst = videoTrack?.mediaStreamTrack;
    if (!videoTrack || !mst) return;
    const constraints = landscapeNativeCaptureOptions(mst);
    logEvent(`squeeze detected -- re-acquiring native landscape: ${JSON.stringify(constraints)}`);
    videoTrack.restartTrack(constraints).catch((e) => {
      console.error('[cam] landscape re-acquire failed', e);
      logEvent(`landscape re-acquire FAILED: ${e?.name}: ${e?.message}`);
    });
  }, [implausibleAspect, myCameraTrackSid, room, logEvent]);

  // Acquisition itself now happens declaratively via LiveKitRoom's video
  // prop (see CamPage, above) -- there's no manual setCameraEnabled call
  // here anymore, which is the actual fix: only one caller ever tells
  // LiveKit what the camera should be, so nothing can race it. The
  // "ACQUIRE" line in the DEBUG panel below is derived from chainSnapshot
  // (is there currently a live track) plus liveKitRoomError (surfaced via
  // LiveKitRoom's onError, which fires if that declarative acquisition
  // itself rejects) -- not from a separate try/catch anymore, since there's
  // no call left here to wrap.
  useEffect(() => {
    if (!liveKitRoomError) return;
    logEvent(`LiveKitRoom onError: ${liveKitRoomError.name}: ${liveKitRoomError.message}`);
  }, [liveKitRoomError, logEvent]);

  // Clean live swap: LocalVideoTrack.restartTrack replaces the sender's
  // MediaStreamTrack in place (RTCRtpSender.replaceTrack under the hood)
  // -- no unpublish/republish, no renegotiation, no dropped frame for
  // viewers. Resyncs deviceId afterwards so the (deviceId-based) L5
  // dropdown never goes stale against a facingMode-driven swap.
  const toggleFacingMode = useCallback(async () => {
    const videoTrack = room.localParticipant.getTrackPublication(Track.Source.Camera)?.videoTrack;
    if (!videoTrack) return;
    const next = facingMode === 'environment' ? 'user' : 'environment';
    logEvent(`toggleFacingMode() called, next=${next}`);
    try {
      await videoTrack.restartTrack({ facingMode: next, ...HIGH_RES_VIDEO_CAPTURE });
      setFacingMode(next);
      onDeviceIdChange(videoTrack.mediaStreamTrack.getSettings().deviceId ?? null);
      logEvent('toggleFacingMode() succeeded');
    } catch (e) {
      console.error('[cam] facingMode restartTrack failed', e);
      logEvent(`toggleFacingMode() FAILED: ${e?.name}: ${e?.message}`);
    }
  }, [facingMode, room, onDeviceIdChange, logEvent]);

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
    if (!debugMode) return undefined;
    const interval = setInterval(() => {
      const pub = room.localParticipant.getTrackPublication(Track.Source.Camera);
      const videoTrack = pub?.videoTrack;
      const mst = videoTrack?.mediaStreamTrack;
      const settings = mst?.getSettings?.();
      const videoEl = videoElRef.current;
      const srcObject = videoEl?.srcObject;
      // Aspect-ratio squeeze diagnostic (Sony/capture-card horizontal-
      // squeeze bug): distinguishes a CSS problem (rendered box's aspect
      // doesn't match the decoded frame's aspect, or object-fit isn't
      // 'cover') from a pipeline problem (getSettings()/videoWidth
      // already report a squeezed shape, so no CSS fix downstream can
      // recover it -- the distortion is baked into the delivered pixels
      // before this element ever sees them). Logged to console (not just
      // the on-screen panel) so a Sony-feed session and a phone-feed
      // session can be captured side by side and diffed directly.
      const computedObjectFit = videoEl ? getComputedStyle(videoEl).objectFit : null;
      const rect = videoEl ? videoEl.getBoundingClientRect() : null;
      const snapshot = {
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
        computedObjectFit,
        renderedBoxWidth: rect ? Math.round(rect.width) : null,
        renderedBoxHeight: rect ? Math.round(rect.height) : null,
      };
      setChainSnapshot(snapshot);
      console.log('[cam-diag]', {
        settings: settings ? { width: settings.width, height: settings.height } : null,
        decodedFrame: videoEl ? { videoWidth: videoEl.videoWidth, videoHeight: videoEl.videoHeight } : null,
        renderedBox: rect ? { width: Math.round(rect.width), height: Math.round(rect.height) } : null,
        computedObjectFit,
      });
    }, 400);
    return () => clearInterval(interval);
  }, [room, debugMode]);

  // DEBUG -- WHY does the track go from 'live' to 'ended'? The prior
  // version of this instrumentation captured the raw MediaStreamTrack
  // ONCE via closure (keyed only on trackSid, which stays stable across
  // a restart/track-swap) and never rebound -- so it silently watched
  // an ABANDONED track while the wrapper moved on to a new one, which is
  // exactly the "two different track ids" mismatch that showed up: line
  // 4 (polls fresh every 400ms) tracked the CURRENT track; line 11
  // (closure-captured once) was stuck on the ORIGINAL one. This version
  // rebinds on TrackEvent.Restarted -- the same event
  // lib/useSourceDimensions.js already correctly handles -- so it always
  // reflects whichever track is actually current, and logs every
  // restart (old id -> new id) instead of silently going stale again.
  //
  // Also logs TrackEvent.Muted/Unmuted and RoomEvent.SignalConnected
  // (below): LocalVideoTrack.unmute() unconditionally reacquires the
  // camera via restart() when source is Camera (confirmed against the
  // compiled SDK) -- so if this track gets muted and later unmuted, a
  // NEW MediaStreamTrack gets created. And <LiveKitRoom video={false}>
  // (used deliberately here to avoid its declarative publish path) still
  // calls setCameraEnabled(false, ...) on every SignalConnected --
  // confirmed to fire on reconnects, not just the initial connect -- a
  // real candidate for muting an already-published track out from under
  // CamPublisher's own setCameraEnabled(true, ...). Logging both
  // together shows whether that's actually what's happening.
  const [endedInfo, setEndedInfo] = useState(null);
  const trackSidForLifecycle = myCameraPublication?.trackSid;

  useEffect(() => {
    if (!debugMode) return undefined;
    const videoTrack = myCameraPublication?.videoTrack;
    if (!videoTrack) return undefined;

    let detachCurrent = null;

    function shortId(mst) {
      return mst?.id ? mst.id.slice(0, 8) : 'none';
    }
    function shortStack(stack) {
      return (stack || '').split('\n').slice(1, 6).join(' | ');
    }

    function attachTo(mst) {
      if (!mst) return null;
      const originalRawStop = mst.stop.bind(mst);
      mst.stop = function (...args) {
        const stack = new Error().stack;
        logEvent(`MediaStreamTrack.stop() called on id=${shortId(mst)}`);
        setEndedInfo((prev) => ({ ...(prev || {}), rawStopAt: Date.now(), rawStopStack: shortStack(stack) }));
        return originalRawStop(...args);
      };
      function handleEnded() {
        logEvent(`'ended' event fired on id=${shortId(mst)}`);
        setEndedInfo((prev) => ({ ...(prev || {}), endedEventAt: Date.now(), status: 'ended' }));
      }
      mst.addEventListener('ended', handleEnded);
      return () => {
        mst.stop = originalRawStop;
        mst.removeEventListener('ended', handleEnded);
      };
    }

    function bindCurrent(reason) {
      detachCurrent?.();
      const mst = videoTrack.mediaStreamTrack;
      logEvent(`${reason}: now watching id=${shortId(mst)} (readyState=${mst?.readyState})`);
      setEndedInfo({ acquiredAt: Date.now(), status: mst?.readyState === 'ended' ? 'ended' : 'live', trackId: shortId(mst) });
      detachCurrent = attachTo(mst);
    }

    const originalWrapperStop = typeof videoTrack.stop === 'function' ? videoTrack.stop.bind(videoTrack) : null;
    if (originalWrapperStop) {
      videoTrack.stop = function (...args) {
        const stack = new Error().stack;
        logEvent('LocalVideoTrack.stop() (wrapper) called');
        setEndedInfo((prev) => ({ ...(prev || {}), wrapperStopAt: Date.now(), wrapperStopStack: shortStack(stack) }));
        return originalWrapperStop(...args);
      };
    }

    function handleRestarted() {
      bindCurrent('TrackEvent.Restarted fired');
    }
    function handleMuted() {
      logEvent('TrackEvent.Muted fired');
    }
    function handleUnmuted() {
      logEvent('TrackEvent.Unmuted fired (unmute() reacquires via restart() for Camera source)');
    }

    bindCurrent('initial bind');
    videoTrack.on(TrackEvent.Restarted, handleRestarted);
    videoTrack.on(TrackEvent.Muted, handleMuted);
    videoTrack.on(TrackEvent.Unmuted, handleUnmuted);

    return () => {
      detachCurrent?.();
      if (originalWrapperStop) videoTrack.stop = originalWrapperStop;
      videoTrack.off(TrackEvent.Restarted, handleRestarted);
      videoTrack.off(TrackEvent.Muted, handleMuted);
      videoTrack.off(TrackEvent.Unmuted, handleUnmuted);
    };
  }, [trackSidForLifecycle, logEvent, debugMode]);

  // Historical: this is what confirmed the LiveKitRoom video={false} vs
  // manual setCameraEnabled race (now fixed -- acquisition is declarative
  // via the video prop, so there's no second caller left to race).
  // Harmless to keep logging reconnects for future debugging.
  useEffect(() => {
    if (!debugMode) return undefined;
    function handleSignalConnected() {
      logEvent('RoomEvent.SignalConnected fired');
    }
    room.on(RoomEvent.SignalConnected, handleSignalConnected);
    return () => room.off(RoomEvent.SignalConnected, handleSignalConnected);
  }, [room, logEvent, debugMode]);

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
          chain, on screen, in order. This is what found the LiveKitRoom
          video={false} race -- Stage 1 is verified working now, so this
          is off by default, reachable again via ?debug=1 for whatever
          comes up in Stage 2+. */}
      {debugMode && (
        <div
          style={{
            position: 'absolute',
            bottom: 8,
            left: 8,
            right: 8,
            // Bounded + scrollable, not just bottom-anchored -- with no
            // height cap this panel just grows upward as more numbered
            // lines get added, past the top of the viewport with nothing
            // to indicate more content exists above. maxHeight + bottom
            // keeps it anchored to the same spot while guaranteeing
            // everything (including line 12's full event log) stays
            // reachable by scrolling THIS one box.
            maxHeight: '55vh',
            overflowY: 'auto',
            padding: '8px 10px',
            borderRadius: 6,
            background: liveKitRoomError || sourceDims?.status === 'failed' ? 'rgba(231, 29, 54, 0.85)' : 'rgba(1, 22, 39, 0.8)',
            color: PORCELAIN,
            fontFamily: 'monospace',
            fontSize: 10,
            lineHeight: 1.5,
          }}
        >
          <div>
            1. ACQUIRE (declarative, via LiveKitRoom video prop): {liveKitRoomError
              ? `ERROR -- ${liveKitRoomError.name}: ${liveKitRoomError.message}`
              : chainSnapshot?.mstFound && chainSnapshot?.mstReadyState === 'live'
                ? 'success (live track present)'
                : 'pending...'}
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
            10. detection: {sourceDims?.status === 'ready'
              ? `${sourceDims.width}x${sourceDims.height} -- ${sourceDims.isPortraitSource ? 'native portrait' : 'landscape (cropped)'}${sourceDims.attempts > 1 ? ` (${sourceDims.attempts} tries)` : sourceDims.attempts === 1 ? ' (1st try)' : ''}`
              : sourceDims?.status === 'failed'
                ? `FAILED after ${sourceDims.attempts} tries`
                : `detecting...${sourceDims?.attempts ? ` (retry ${sourceDims.attempts})` : ''}`}
          </div>
          <div>
            11. render box: {chainSnapshot?.renderedBoxWidth}x{chainSnapshot?.renderedBoxHeight} (object-fit: {chainSnapshot?.computedObjectFit ?? '--'}) -- decoded frame {chainSnapshot?.videoWidth}x{chainSnapshot?.videoHeight}
          </div>
          {endedInfo && (
            <div style={{ marginTop: 4, borderTop: '1px solid rgba(253,255,252,0.25)', paddingTop: 4 }}>
              <div>
                11. TRACK LIFECYCLE: watching id={endedInfo.trackId}
                {endedInfo.status === 'ended'
                  ? ` -- ENDED ${endedInfo.endedEventAt - endedInfo.acquiredAt}ms after this bind`
                  : ' -- live'}
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
          {eventLog.length > 0 && (
            // No separate scroll region here on purpose -- one nested
            // scrollbox fighting the outer one for wheel/touch events is
            // worse than just letting the whole panel (bounded above)
            // scroll as a single unit.
            <div style={{ marginTop: 4, borderTop: '1px solid rgba(253,255,252,0.25)', paddingTop: 4 }}>
              <div>12. EVENT LOG ({eventLog.length} entries, oldest first -- setCameraEnabled/restart/mute/unmute/reconnect):</div>
              {eventLog.map((line, i) => (
                <div key={i}>{line}</div>
              ))}
            </div>
          )}
        </div>
      )}
      {/* Permanent safety net, NOT gated behind debugMode -- a visible
          failure beats an infinite silent wait or a mysterious frozen
          feed, for any operator, not just someone debugging. */}
      {liveKitRoomError && (
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
          Camera access failed ({liveKitRoomError.name}) -- try reselecting the device or reloading.
        </div>
      )}
      {!liveKitRoomError && sourceDims?.status === 'failed' && (
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

      {/* Manual rotation for a source whose pixel content is sideways
          relative to what it claims -- there's no reliable way to
          auto-detect THAT, so it's opt-in and by-eye: pick whichever
          option makes the preview above look upright. The portrait CROP
          itself (landscape -> portrait) is separate and automatic --
          applied as soon as isLandscape resolves true, with no picker
          needed; this row only ever adjusts rotation on top of that.
          Not phone-relevant (phones already deliver correct portrait,
          isLandscape stays false, no processor ever attaches), but left
          always-visible here rather than gated behind a device-type
          guess -- small and clearly optional, doesn't block or
          complicate the common case where nobody touches it. */}
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
