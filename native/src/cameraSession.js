// native/src/cameraSession.js — a paired phone becomes a camera in a real
// show: it joins the room with the token the pairing gave it and publishes
// the picture from the capturer the spike proved out (loud-camera).
//
// What this is, and what it is not. It is the publishing half of the spike's
// SpikeSession (native/src/spike/runtime.js) with everything the spike
// needed and a show does not: no data channel (a camfeed token has
// canPublishData false by design), no controller, no training capture, no
// zoom or pan commands yet. Those arrive with the director; this is the
// piece without which none of them matter, because a camera that does not
// publish is a viewfinder.
//
// What it does carry over, because the device tests paid for it:
//   - the chosen camera's own capability, not the back camera's
//     (facing.js: a front camera that really does advertise zoom and
//     manual control gets them, a plain one gets the basic set);
//   - the frame rate held to what that lens advertises (frameRate.js);
//   - the mirror rule, so a front camera's broadcast reads correctly
//     (facing.js mirrorRule, settled on a phone on 25 Oct);
//   - the orientation plan from the mount reading (orientation.js), so the
//     picture is upright for the show's chosen orientation;
//   - every option named on the way to native, since a destructured
//     signature is a silent filter (the wrapper's own lesson, 25 Oct).
//
// PRD rows 15, 127. S&I: Real-time media.
// livekit-client, not @livekit/react-native: the spike publishes through exactly these
// (native/src/spike/runtime.js) on the same registerGlobals setup, and a second client
// in one app is two WebRTC worlds that disagree about the same track.
import { Room, RoomEvent, Track, LocalVideoTrack } from 'livekit-client';
import * as LoudCamera from '../modules/loud-camera';
import { normaliseProfile } from './spike/survey';
import { facingCapability, describeFacing, mirrorRule, FACINGS } from './spike/facing';
import { resolveFrameRate, frameRateWarnings, FRAME_RATE_DEFAULT } from './spike/frameRate';
import { orientationPlan, normaliseOrientation, physicalOrientation, orientationMismatch } from './spike/orientation';

const APP_VERSION = '0.1.0';

/** The profile for this phone, normalised (the same shape the spike reports). */
export async function readProfile() {
  const raw = await LoudCamera.survey();
  const profile = normaliseProfile(raw, { appVersion: APP_VERSION });
  profile.raw = raw;
  return profile;
}

/**
 * One camera in one show.
 *
 *   const cam = new CameraSession({ token, url, room, facing, frameRate, orientation, onEvent });
 *   await cam.start();   // joins, publishes, keeps reporting state
 *   await cam.stop();
 *
 * `onEvent(kind, payload)` feeds the screen: 'profile', 'capability',
 * 'frameRate', 'published', 'state', 'warning', 'error', 'link'.
 */
export class CameraSession {
  constructor({ token, url, room, facing = 'back', frameRate = FRAME_RATE_DEFAULT, flip = 'auto', orientation = 'portrait', frameSource = 'auto', onEvent }) {
    this.token = token; this.url = url; this.roomName = room;
    this.facing = FACINGS.includes(facing) ? facing : 'back';
    this.frameRateWanted = Number.isFinite(Number(frameRate)) && Number(frameRate) > 0 ? Number(frameRate) : FRAME_RATE_DEFAULT;
    this.flip = flip; this.orientation = normaliseOrientation(orientation); this.frameSource = frameSource;
    this.onEvent = onEvent || (() => {});
    this.mirror = mirrorRule(this.facing, this.flip);
    this.room = null; this.track = null; this.publication = null; this.stream = null; this.profile = null; this.capability = null;
    this.stateSub = null; this.lastState = null; this.fps = FRAME_RATE_DEFAULT;
  }

  async start() {
    if (!LoudCamera.available) throw new Error('This build has no camera module. Install the app build, not Expo Go.');
    this.profile = await readProfile();
    this.onEvent('profile', this.profile);

    // The capability of the camera that will run. A failure here must never
    // stop the camera: the show is the point, the capability is a convenience
    // (docs/ARCHITECTURE.md, and the 25 Oct bug that proved it).
    try {
      this.capability = facingCapability(this.profile, this.facing);
      this.onEvent('capability', { facing: this.facing, capability: this.capability, line: describeFacing(this.capability), mirror: this.mirror });
    } catch (e) {
      this.capability = null;
      this.onEvent('warning', `Could not read what this camera can do, carrying on: ${String(e?.message || e)}`);
    }

    const fr = resolveFrameRate(this.frameRateWanted, this.capability?.pro?.fpsRanges ?? this.profile?.pro?.fpsRanges);
    this.fps = fr.fps;
    this.onEvent('frameRate', { ...fr, warnings: frameRateWarnings(fr.fps, { frameSource: this.frameSource, exact: fr.exact }) });

    this.room = new Room();
    this.room.on(RoomEvent.ConnectionStateChanged, (s) => this.onEvent('link', { state: String(s) }));
    this.room.on(RoomEvent.Disconnected, (r) => this.onEvent('link', { state: 'disconnected', detail: r != null ? String(r) : null }));
    await this.room.connect(this.url, this.token);
    this.onEvent('link', { state: 'connected', room: this.room.name ?? this.roomName, identity: this.room.localParticipant?.identity ?? null });

    const { stream, info } = await LoudCamera.start({
      facing: this.facing, width: 1080, height: 1920,
      fps: fr.fps, fpsRange: fr.range, frameSource: this.frameSource,
      mirrorOutput: this.mirror.flipBroadcast,
    });
    this.stream = stream;
    const mediaTrack = stream.getVideoTracks()[0];
    const track = new LocalVideoTrack(mediaTrack, undefined, true);
    const pub = await this.room.localParticipant.publishTrack(track, {
      source: Track.Source.Camera, simulcast: false,
      videoEncoding: { maxBitrate: fr.fps > 30 ? 4_500_000 : 3_000_000, maxFramerate: fr.fps },
    });
    // Only now is there a publication for the screen to render (the spike's
    // 14 Oct crash: a preview mounted before the publication existed).
    this.track = track; this.publication = pub;
    this.onEvent('published', { trackSid: pub.trackSid, facing: this.facing, flip: this.mirror.flipBroadcast, sent: info?.sent ?? null, room: this.room.name ?? this.roomName, identity: this.room.localParticipant?.identity ?? null });

    await this.applyOrientation().catch((e) => this.onEvent('warning', `Orientation: ${String(e?.message || e)}`));
    this.stateSub = LoudCamera.addStateListener((s) => { this.lastState = s; this.onEvent('state', s); });
    return { trackSid: pub.trackSid };
  }

  /** Upright for the show's orientation, from one gravity reading of how the phone is held. */
  async applyOrientation() {
    const g = await LoudCamera.gravityCheck().catch(() => null);
    const physical = g ? physicalOrientation(g) : 'unknown';
    const st = LoudCamera.getState() || this.lastState || {};
    const plan = orientationPlan({ orientation: this.orientation, sensorOrientation: st.sensorOrientation ?? 90, physical });
    // mountOf tells the plan which way the phone sits; orientationMismatch is the
    // sentence a person can act on when it sits the wrong way for this show.
    const check = orientationMismatch(this.orientation, physical);
    if (check.warning) this.onEvent('warning', `${check.warning}${check.fix ? `. Fix: ${check.fix}` : ''}`);
    await LoudCamera.setOrientation(plan.orientation, plan.desiredRotation);
    return plan;
  }

  /** What the status line shows: the measured rate, dropped frames, the camera and the flip. */
  status() {
    const s = this.lastState || LoudCamera.getState() || null;
    if (!s) return null;
    return {
      fps: s.fps, fpsTarget: s.fpsTarget ?? this.fps, dropped: s.droppedFrames ?? 0,
      facing: s.facing ?? this.facing, mirrored: Boolean(s.mirrorOutput),
      frameSource: s.frameSource ?? null, width: s.width, height: s.height,
      zoom: s.effectiveZoom ?? 1, lens: s.activePhysicalId ?? s.cameraId ?? null,
    };
  }

  async stop() {
    try { this.stateSub?.remove?.(); } catch { /* closing */ }
    try { if (this.track) { await this.room?.localParticipant?.unpublishTrack(this.track); this.track.stop(); } } catch { /* closing */ }
    try { await LoudCamera.stop(); } catch { /* closing */ }
    try { await this.room?.disconnect(); } catch { /* closing */ }
    this.room = null; this.track = null; this.publication = null; this.stream = null;
  }
}
