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

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  LiveKitRoom,
  VideoTrack,
  useTracks,
  useRoomContext,
} from '@livekit/components-react';
import { Track } from 'livekit-client';
import '@livekit/components-styles';

const INK = '#011627';
const PORCELAIN = '#fdfffc';
const TEAL = '#2ec4b6';

// Ideal (not exact) so a device that can't hit 1080p/30fps or lacks the
// requested facing camera still gets a working track -- getUserMedia only
// hard-fails on {exact: ...}/min/max constraints, never on bare values.
const HIGH_RES_VIDEO_CAPTURE = { resolution: { width: 1920, height: 1080 }, frameRate: { ideal: 30 } };

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
        if (!cancelled) setDeviceError('Camera permission is required to pair this device.');
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

  useEffect(() => {
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
    room.localParticipant.setCameraEnabled(
      true,
      deviceChosen
        ? { deviceId, ...HIGH_RES_VIDEO_CAPTURE }
        : { facingMode: 'environment', ...HIGH_RES_VIDEO_CAPTURE }
    );
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
    await videoTrack.restartTrack({ facingMode: next, ...HIGH_RES_VIDEO_CAPTURE });
    setFacingMode(next);
    onDeviceIdChange(videoTrack.mediaStreamTrack.getSettings().deviceId ?? null);
  }, [facingMode, room, onDeviceIdChange]);

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

  return (
    <div style={{ position: 'fixed', inset: 0, background: INK }}>
      {myTrack ? (
        <VideoTrack
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
    </div>
  );
}
