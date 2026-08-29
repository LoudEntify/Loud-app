'use client';

// components/CamViewfinder.jsx
// ─────────────────────────────────────────────────────────────
// What the paired phone shows the person who propped it up.
//
// Before this it showed a paragraph of text and no picture at all. The
// operator could not see their own framing, could not tell whether the
// shot was being used, and could not turn the phone around — the three
// things a camera operator does.
//
// ── LAYOUT: PREVIEW PRIMARY, STAGE AS AN INSET ────────────────
// Asked to choose, and choosing rather than building a toggle.
//
// This device's job is to produce ONE good frame. Framing is a
// continuous task — a phone gets knocked, a performer moves, the light
// changes — and it is the only task that cannot be done from anywhere
// else in the building. The composed stage is reference: useful for
// knowing whether you are on air and what the cut looks like, checked in
// glances, never adjusted against continuously.
//
// A toggle would put the job this device exists for one tap away, and
// would eventually be left on the wrong view at the wrong moment. So:
// preview fills the screen, stage sits in the corner, no control to get
// it wrong.
//
// ── THE STAGE INSET IS THE LIVE SOURCE, NOT THE COMPOSED FRAME ──
// Stated plainly because the difference matters and the honest version
// is worth more than a flattering one.
//
// The inset renders the video track the director has currently cut to.
// It does NOT apply the shot's transforms — the push-ins, the crops, the
// transitions ShotRenderer draws for viewers. Reproducing that on the
// phone means running the whole renderer on a device already encoding
// and uploading video, for a picture watched in one-second glances.
//
// So it answers "what source is going out, and is it mine" — which is
// the question an operator actually has — and does not pretend to be a
// programme monitor. The label says SOURCE for that reason.
//
// In REHEARSAL there is no inset at all: rehearsal tokens are minted
// with canSubscribe:false (lib/camfeedPairing.js), so this device
// genuinely cannot see other cameras, and a permanently black rectangle
// would read as a fault. It says what is true instead.
// ─────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  useConnectionState,
  useLocalParticipant,
  useRoomContext,
  useTracks,
  VideoTrack,
} from '@livekit/components-react';
import { ConnectionState, RoomEvent, Track } from 'livekit-client';
import { initHealthLog, logHealthEvent } from '../lib/healthLog';
import { readFacingMode, saveFacingMode } from '../lib/camfeedDevice';
import { usePublisherStats } from '../lib/publisherStats';

const INK = '#011627';
const PORCELAIN = '#fdfffc';
const TEAL = '#2ec4b6';
const ORANGE = '#ff9f1c';
const RED = '#e71d36';

// Matches the constraint the pairing page publishes with, so a rotate
// asks the new lens for the same shape as the old one.
const HIGH_RES_VIDEO_CAPTURE = { resolution: { height: 1920, aspectRatio: 9 / 16 }, frameRate: { ideal: 30 } };

/**
 * Connection state in WORDS, never a colour alone.
 *
 * A propped phone is read at a distance, at an angle, often by someone
 * who did not set it up, sometimes by someone who cannot reliably tell
 * a red dot from a green one. Colour carries the same meaning alongside
 * the words; it never carries it by itself.
 */
function connectionWords(state, inShow) {
  switch (state) {
    case ConnectionState.Connected:
      return {
        text: inShow ? 'Connected — in the show' : 'Connected — in the rehearsal room',
        tone: inShow ? RED : TEAL,
      };
    case ConnectionState.Connecting:
      return { text: 'Connecting…', tone: ORANGE };
    case ConnectionState.Reconnecting:
      return { text: 'Reconnecting — hold still', tone: ORANGE };
    case ConnectionState.Disconnected:
      return { text: 'Not connected', tone: RED };
    default:
      return { text: String(state || 'Unknown'), tone: ORANGE };
  }
}

export default function CamViewfinder({ conn, wake }) {
  const room = useRoomContext();
  const connectionState = useConnectionState();
  const { localParticipant } = useLocalParticipant();
  const inShow = (conn?.context || 'rehearsal') === 'show';

  // TASK 3 — restored from the device, not reset to a default.
  //
  // This used to initialise to 'environment' unconditionally, so a
  // reconnect (or a reopened tab, now that pairing survives one) silently
  // flipped an operator's phone back to the rear lens while the UI
  // claimed it was on the front. The button and the lens disagreed, which
  // is worse than either being wrong on its own.
  const [facingMode, setFacingMode] = useState(() => readFacingMode() || 'environment');
  const [rotating, setRotating] = useState(false);
  const [rotateError, setRotateError] = useState('');
  const [liveCut, setLiveCut] = useState(null);

  // ── ⚠️ WITHOUT THIS, EVERY EVENT BELOW IS DROPPED ─────────────
  // Found while working out what guard app/api/health-events could
  // safely take: logHealthEvent's first line is `if (!ctx.showId) return`
  // — it discards silently until initHealthLog has been called, and this
  // page had never called it.
  //
  // So the camfeed telemetry added last round (`camfeed_rotated`,
  // `camfeed_on_air`, the wake-lock rows) was being written into a queue
  // that never flushed. The Sitting 5 rotate test asks you to confirm
  // exactly one `camfeed_rotated` row in the timeline; it would have
  // found nothing, and the honest reading of that would have been
  // "rotate is broken" when rotate was fine.
  //
  // Keyed on the room name, matching what LiveDemo and EgressPage pass
  // (`showId: roomName`), so a camfeed's rows sit in the same bucket as
  // the show's and one query returns the whole picture.
  useEffect(() => {
    const identity = localParticipant?.identity;
    if (!conn?.room || !identity) return;
    initHealthLog({ showId: conn.room, participantIdentity: identity, role: `camfeed-${conn.role || 'wide'}` });
  }, [conn?.room, conn?.role, localParticipant?.identity]);

  // TASK 5 — a paired phone is a publisher too, and is the likeliest
  // device to be CPU-bound or on a weak uplink. Read-only, same as the
  // artist's own client. Without this the freeze capture would be
  // missing exactly the cameras most likely to be freezing.
  usePublisherStats(room, { enabled: true, label: `camfeed:${conn?.role || 'wide'}` });

  // ── AM I ON AIR? ──────────────────────────────────────────────
  // The director broadcasts SHOT_COMMAND over the LiveKit data channel
  // (lib/shotCommands.js) and every command names the identity it cut
  // to. This device already has an identity it keeps across reconnects
  // and rotations, so the comparison is exact.
  //
  // Listening costs nothing and needs no new permission: a camfeed token
  // is minted with canPublishData:false, which stops this device SENDING
  // commands — it was never a restriction on receiving them. The same
  // channel already carries SHOW_ENDED to this page
  // (components/ReleaseOnShowEnd.jsx), which is the proof it arrives.
  useEffect(() => {
    if (!room) return undefined;
    const decoder = new TextDecoder();

    function onData(payload) {
      let msg;
      try {
        msg = JSON.parse(decoder.decode(payload));
      } catch {
        return; // not ours
      }
      if (msg?.type !== 'SHOT_COMMAND') return;
      const identity = localParticipant?.identity;
      if (!identity) return;
      const mine = msg.targetIdentity === identity;
      setLiveCut((prev) => {
        if (prev?.mine === mine && prev?.targetIdentity === msg.targetIdentity && prev?.shot === msg.shot) return prev;
        // Logged only on transition, so a timeline shows when this
        // camera went on and off air rather than one row per cut.
        if (prev?.mine !== mine) {
          logHealthEvent(mine ? 'camfeed_on_air' : 'camfeed_off_air', {
            identity,
            shot: msg.shot || null,
            role: conn?.role || null,
          });
        }
        return { mine, shot: msg.shot || null, targetIdentity: msg.targetIdentity || null, at: Date.now() };
      });
    }

    room.on(RoomEvent.DataReceived, onData);
    return () => { room.off(RoomEvent.DataReceived, onData); };
  }, [room, localParticipant, conn?.role]);

  // ── RE-APPLY THE STORED FACING AFTER A (RE)CONNECT ────────────
  // <LiveKitRoom video={{ facingMode: 'environment' }}> publishes the
  // REAR lens every time it connects — that prop is a fixed default and
  // knows nothing about what this operator chose. So on connect, if the
  // remembered choice differs from what was just published, restart the
  // track onto the right lens.
  //
  // Uses the same restartTrack path as the button below, for the same
  // reason: identity and trackSid stay put, so a reconnect that corrects
  // the lens does not also read to the director as a camera swap.
  const appliedFacingRef = useRef(null);
  useEffect(() => {
    if (connectionState !== ConnectionState.Connected) {
      appliedFacingRef.current = null; // re-apply after the next connect
      return;
    }
    if (appliedFacingRef.current === facingMode) return;
    if (facingMode === 'environment') { appliedFacingRef.current = 'environment'; return; }
    const pub = Array.from(localParticipant?.videoTrackPublications?.values?.() || [])
      .find((p) => p.source === Track.Source.Camera);
    const track = pub?.track;
    if (!track?.restartTrack) return;
    appliedFacingRef.current = facingMode;
    track.restartTrack({ facingMode, ...HIGH_RES_VIDEO_CAPTURE })
      .then(() => logHealthEvent('camfeed_facing_restored', { facingMode, trackSid: pub?.trackSid || null }))
      .catch((err) => logHealthEvent('camfeed_facing_restore_failed', { detail: String(err?.message || err) }));
  }, [connectionState, facingMode, localParticipant]);

  // ── ROTATE ────────────────────────────────────────────────────
  // restartTrack, NOT unpublish-and-republish. That choice is the whole
  // requirement, and the four places it has to hold are these:
  //
  //  1. IDENTITY — untouched. It is a property of the room connection,
  //     minted server-side from the pairing's stored `device_identity`
  //     (app/api/camfeed/session). Swapping a camera does not
  //     reconnect, so nothing can change it.
  //
  //  2. PUBLICATION / trackSid — untouched. restartTrack replaces the
  //     MediaStreamTrack INSIDE the existing LocalVideoTrack and calls
  //     replaceTrack on the sender. There is no unpublish and no new
  //     publication, so the liveness registry's key
  //     (`identity:trackSid`, lib/trackLiveness.js) is stable. This is
  //     what stops the director seeing a camera leave and a new one
  //     arrive: with an unpublish/republish, the old key would go
  //     'absent', sit impaired for 30 seconds, and a NEW key would enter
  //     the eligible pool — a reselect, mid-show, for a camera that
  //     never actually went anywhere.
  //
  //  3. THE FRAME WATCHDOG — not tripped, with margin, and safe even if
  //     it were. Reacquiring a lens takes well under a second; the stall
  //     threshold is 3s (FRAME_STALL_MS). If a slow handset ever did
  //     exceed it, the consequence is bounded: `frames_stalled`, then
  //     recovery and 750ms probation — brief ineligibility for AUTO
  //     selection, on a key that never disappeared. Not CAMERA LOST, not
  //     a new camera. The sampler also re-baselines when a frame counter
  //     goes backwards, so a reset counter reads as a restart rather
  //     than a stall.
  //
  //  4. THE PAIRING ROW — untouched, because this makes no server call
  //     at all. Rotating is local media. `device_identity`,
  //     `target_room` and `generation` are exactly as they were, so a
  //     rotate immediately before a rehearsal→show migration cannot
  //     interfere with it.
  const rotate = useCallback(async () => {
    if (rotating) return;
    const pub = Array.from(localParticipant?.videoTrackPublications?.values?.() || [])
      .find((p) => p.source === Track.Source.Camera);
    const track = pub?.track;
    if (!track?.restartTrack) {
      setRotateError('This camera cannot be switched on this device.');
      return;
    }
    const next = facingMode === 'environment' ? 'user' : 'environment';
    setRotating(true);
    setRotateError('');
    try {
      await track.restartTrack({ facingMode: next, ...HIGH_RES_VIDEO_CAPTURE });
      setFacingMode(next);
      appliedFacingRef.current = next;
      // Remembered on the DEVICE so a reconnect restores it. Never sent
      // to the pairing row: facing is a device property, the slot role is
      // an intent, and mixing them would make the shot grammar
      // device-dependent.
      saveFacingMode(next);
      logHealthEvent('camfeed_rotated', {
        identity: localParticipant?.identity || null,
        facingMode: next,
        // The sid is logged BOTH sides of the switch on purpose: it is
        // the single value that proves, in a timeline, that this was a
        // lens change and not a camera drop.
        trackSid: pub?.trackSid || null,
      });
    } catch (err) {
      // The old track is still running — restartTrack failing leaves the
      // previous MediaStreamTrack in place rather than taking the camera
      // off air, which is the right failure for a live device.
      setRotateError('Could not switch camera. The current one is still running.');
      logHealthEvent('camfeed_rotate_failed', { detail: String(err?.message || err) });
    } finally {
      setRotating(false);
    }
  }, [rotating, localParticipant, facingMode]);

  // ── The two pictures ──────────────────────────────────────────
  const localTrackRef = useTracks([Track.Source.Camera], { onlySubscribed: false })
    .find((t) => t.participant?.isLocal);

  const remoteTracks = useTracks([Track.Source.Camera, Track.Source.ScreenShare], { onlySubscribed: true });
  const stageTrackRef = useMemo(() => {
    const target = liveCut?.targetIdentity;
    if (!target) return null;
    // The source the director cut to, if this device can see it. When the
    // cut is to THIS phone, there is deliberately nothing to find: the
    // local picture already fills the screen behind the inset, and
    // rendering it twice would be a hall of mirrors. The inset says so
    // in words instead.
    return remoteTracks.find((t) => t.participant?.identity === target) || null;
  }, [remoteTracks, liveCut]);

  const words = connectionWords(connectionState, inShow);
  const onAir = !!liveCut?.mine;

  return (
    <div style={{ position: 'relative', flex: 1, background: '#000', overflow: 'hidden' }}>
      {/* PRIMARY: this device's own picture. */}
      {localTrackRef ? (
        <VideoTrack
          trackRef={localTrackRef}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: 'rgba(253,255,252,0.55)', fontSize: 12.5, padding: 24, textAlign: 'center' }}>
          Waiting for the camera…
        </div>
      )}

      {/* ON AIR — the single most important thing on this screen. */}
      <div style={{ position: 'absolute', top: 12, left: 12, right: 12, display: 'flex', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
        <span
          style={{
            fontSize: 10.5, fontWeight: 800, letterSpacing: '0.12em',
            padding: '6px 10px', borderRadius: 3,
            background: onAir ? RED : 'rgba(1,22,39,0.72)',
            color: onAir ? PORCELAIN : 'rgba(253,255,252,0.72)',
            border: onAir ? 'none' : '1px solid rgba(253,255,252,0.28)',
          }}
        >
          {onAir ? '● ON AIR' : 'NOT ON AIR'}
        </span>

        {conn?.role && (
          <span style={{ fontSize: 10, letterSpacing: '0.1em', color: ORANGE, border: `1px solid ${ORANGE}`, borderRadius: 999, padding: '5px 10px', background: 'rgba(1,22,39,0.72)' }}>
            {String(conn.role).toUpperCase()} ANGLE
          </span>
        )}
      </div>

      {/* STAGE INSET — only where subscribing is possible. */}
      {inShow && (
        <div
          style={{
            position: 'absolute', right: 12, bottom: 108, width: 108, height: 168,
            background: '#000', border: '1px solid rgba(253,255,252,0.35)', borderRadius: 4,
            overflow: 'hidden',
          }}
        >
          {stageTrackRef ? (
            <VideoTrack trackRef={stageTrackRef} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', color: 'rgba(253,255,252,0.5)', fontSize: 9, textAlign: 'center', padding: 6, lineHeight: 1.4 }}>
              {onAir ? 'YOUR SHOT IS THE ONE GOING OUT' : 'WAITING FOR A CUT'}
            </div>
          )}
          <div style={{ position: 'absolute', top: 3, left: 4, fontSize: 7.5, letterSpacing: '0.1em', color: 'rgba(253,255,252,0.75)', textShadow: '0 1px 2px #000' }}>
            LIVE SOURCE
          </div>
        </div>
      )}

      {/* THE BAR: connection, room, rotate, and any honest warning. */}
      <div
        style={{
          position: 'absolute', left: 0, right: 0, bottom: 0,
          background: 'linear-gradient(to top, rgba(1,22,39,0.95), rgba(1,22,39,0))',
          padding: '28px 14px 14px', display: 'flex', flexDirection: 'column', gap: 8,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: words.tone, flexShrink: 0 }} />
              <span style={{ fontSize: 11.5, color: PORCELAIN, fontWeight: 600 }}>{words.text}</span>
            </div>
            <div style={{ fontSize: 9.5, color: 'rgba(253,255,252,0.45)', marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {inShow ? 'Show room' : 'Rehearsal room'} · {conn?.room || '—'}
            </div>
          </div>

          <button
            type="button"
            onClick={rotate}
            disabled={rotating}
            style={{
              flexShrink: 0, padding: '11px 14px', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em',
              color: INK, background: PORCELAIN, border: 'none', borderRadius: 3,
              opacity: rotating ? 0.55 : 1, cursor: rotating ? 'default' : 'pointer',
            }}
          >
            {rotating ? 'SWITCHING…' : facingMode === 'environment' ? 'ROTATE → FRONT' : 'ROTATE → BACK'}
          </button>
        </div>

        {rotateError && <div style={{ fontSize: 10.5, color: '#ff8080' }}>{rotateError}</div>}

        {/* The screen-sleep promise, kept honestly. A device that cannot
            hold the screen on must say so — someone is about to prop it
            up and walk away believing it is handled. */}
        {wake && !wake.held && (
          <div style={{ fontSize: 10, color: ORANGE, lineHeight: 1.45 }}>
            {wake.supported
              ? 'This phone may dim on its own — set its auto-lock to Never in Settings.'
              : 'This phone can’t be kept awake by the browser. Set auto-lock to Never in Settings, or the camera will freeze when the screen goes off.'}
          </div>
        )}
      </div>
    </div>
  );
}
