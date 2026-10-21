// native/src/spike/runtime.js — the React Native glue for the spike: a
// LiveKit room, the native capturer, the command protocol, clock sync and
// the director-data batches. The policy lives in the platform-free
// modules beside this file; this file only wires them to the phone.
//
// Two roles share one room (the artist's own rehearsal room, token from
// /api/spike/token):
//   camera      publishes the native capturer's track, answers commands
//   controller  sends zoom / pan commands, measures the round trip
//
// PRD rows 12-19, 127, 128, 165, 166. S&I: Real-time media, Observability.
import { Room, RoomEvent, Track, LocalVideoTrack } from 'livekit-client';
import { Paths, File, Directory } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { api } from '../api';
import { API_BASE } from '../config';
import * as LoudCamera from '../../modules/loud-camera';
import { TOPIC, zoomCommand, panCommand, proCommand, matchCommand, stageCommand, surveyRequest, orientationCommand, mountStatus, ack, encode, decode, ackLatencies, summariseLatencies, slowCommandDiagnosis, mintId, bopCommand } from './commands';
import { clampPro, proWarnings, matchResidual, STAGES } from './proMode';
import { resolveFrameRate, frameRateWarnings, FRAME_RATE_DEFAULT } from './frameRate';
import { DEFAULT_ORIENTATION, normaliseOrientation, physicalOrientation, orientationMismatch, orientationPlan, mountOf, nextMountPlan } from './orientation';

/** How often the camera re-reads the gravity sensor before the lock (setup only: never during a show). */
export const MOUNT_WATCH_MS = 2000;
import { capsFor, zoomPlan, panPlan, bopPlan, tightnessFor, PAN_DEFAULTS, BOP_DEFAULTS, SHOT_HOME, FRAME_SOURCES } from './zoomPlan';
import { measureOffset, RESYNC_EVERY_MS } from './clock';
import { CaptureBuffer, uploadDue, BATCH_EVERY_MS } from './capture';
import { normaliseProfile, surveyFileName } from './survey';

export const APP_VERSION = Constants.expoConfig?.version || '0.0.0';

function deviceId() {
  const slug = (s) => String(s || 'x').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${slug(Device.manufacturer)}-${slug(Device.modelName)}-${slug(Device.osBuildId || Device.osVersion).slice(0, 12)}`.slice(0, 64);
}

/** Survey mode: read the profile, write it to the app's documents folder, done. No LiveKit. */
export async function runSurvey() {
  const raw = await LoudCamera.survey();
  const profile = normaliseProfile(raw, { appVersion: APP_VERSION });
  profile.raw = raw;
  const name = surveyFileName(profile);
  const file = new File(Paths.document, name);
  file.write(JSON.stringify(profile, null, 2));
  return { profile, path: file.uri, name };
}

/** Every spike-report-*.json in the app's documents folder, newest first (by the timestamp in the name, then mtime). */
export function listReportFiles() {
  try {
    const files = new Directory(Paths.document).list().filter((f) => f instanceof File && /^spike-report-.*\.json$/.test(f.name));
    const stamp = (f) => Number((f.name.match(/-(\d{10,})\.json$/) || [])[1] || 0) || (f.modificationTime ?? 0);
    files.sort((a, b) => stamp(b) - stamp(a) || (a.name < b.name ? 1 : -1));
    return files;
  } catch { return []; }
}

/** The newest spike-report-*.json, or null. */
export function latestReportFile() { return listReportFiles()[0] || null; }

/**
 * Open the share sheet with the report as a FILE (Nearby Share, Drive,
 * Gmail attachment), not as pasted text: the documents folder is private
 * to the app on Android, so this is the only way the file leaves the phone
 * other than the bucket upload.
 */
export async function shareReportFile(file) {
  if (!(await Sharing.isAvailableAsync())) throw new Error('sharing is not available on this device');
  await Sharing.shareAsync(file.uri, { mimeType: 'application/json', dialogTitle: file.name });
}

/** Normalised B2 profile for the running device (used by both roles). */
export async function readProfile() {
  const raw = await LoudCamera.survey();
  return normaliseProfile(raw, { appVersion: APP_VERSION });
}

/**
 * One spike session on one phone. `onEvent(kind, payload)` feeds the
 * screen; everything else is internal. Call connect(), then stop().
 */
export class SpikeSession {
  constructor({ role, accessToken, userId, onEvent, frameSource = 'auto', frameRate = FRAME_RATE_DEFAULT }) {
    this.role = role; this.accessToken = accessToken; this.userId = userId; this.onEvent = onEvent || (() => {});
    this.frameSource = FRAME_SOURCES.includes(frameSource) ? frameSource : 'auto';
    // The rate asked for in Settings; resolved against the lens's advertised ranges at camera start (frameRate.js). `fps` is what runs.
    this.frameRateWanted = Number.isFinite(Number(frameRate)) && Number(frameRate) > 0 ? Number(frameRate) : FRAME_RATE_DEFAULT;
    this.fps = FRAME_RATE_DEFAULT; this.frameRate = null;
    this.room = null; this.profile = null; this.offset = null; this.track = null; this.stream = null;
    // The camera's framing as the director sees it: one shot at a time
    // (zoomPlan.js). A zoom or a pan makes a new shot; a refused or failed
    // move leaves it as it was.
    this.shot = { ...SHOT_HOME }; this.shotId = mintId('shot'); this.shots = 0;
    this.deviceId = deviceId(); this.sessionId = mintId('ses');
    this.buffer = new CaptureBuffer({ deviceId: this.deviceId, sessionId: this.sessionId });
    this.collect = true; this.lastUploadAt = Date.now(); this.uploads = []; this.pending = new Map();
    this.timers = []; this.stateSub = null; this.lastState = null; this.lastCost = null; this.costSamples = [];
    this.moving = false; this.soak = null; this.remoteTrack = null; this.latencies = []; this.reportUpload = null;
    // Test stage ('A' | 'B'), set by the controller and sent to the camera, on every record and report section (docs/SPIKE_PRO_MODE_PLAN.md).
    this.stage = null; this.stageChanges = [];
    // Pro mode bookkeeping: the camera's pro block as the controller learnt it (survey ack), acks awaited by id, the last Match cameras run.
    this.cameraProfile = null; this.ackWaiters = new Map(); this.match = null; this.proLog = [];
    // The show's orientation (src/spike/orientation.js): chosen on the
    // controller, applied on the camera, locked while live. `orientationInfo`
    // is what the capturer answered (rotation, sensor orientation, size);
    // `mountCheck` the one gravity reading taken at setup.
    this.orientation = DEFAULT_ORIENTATION; this.orientationInfo = null; this.mountCheck = null; this.orientationLog = [];
    // The mount decision: the plan's 180 choice, the reading waiting for a second look, the lock (first stage or move), the plan and the last warning key.
    this.planInverted = false; this.pendingInverted = null; this.locked = false; this.plan = null; this.mountKey = null;
    // Slow-command diagnostics: LiveKit connection-state changes, JS-thread
    // stalls (camera), clock steps, and every command whose leg out was slow.
    this.linkEvents = []; this.stalls = []; this.clockSteps = []; this.slowCommands = []; this.lastTick = 0;
  }

  /** Live = the orientation is locked: a stage is running, a move is in progress, or (controller) the soak is on. */
  live() { return Boolean(this.stage || this.moving || this.soak || this.locked); }

  /** Remember a LiveKit connection-state change (both roles), for the slow-command diagnosis and the report. */
  noteLink(state, detail = null) {
    this.linkEvents.push({ state, detail: detail == null ? null : String(detail), atMs: Date.now(), serverMs: this.serverNow() });
    if (this.linkEvents.length > 50) this.linkEvents.shift();
    if (this.collect) this.buffer.link(state, detail == null ? null : String(detail));
    this.onEvent('link', { state, detail });
  }

  /** The camera's side of a slow command: what it can say about the last minute before it handled this one. */
  receiptDiag(receivedLocalMs) {
    const since = receivedLocalMs - 60_000;
    const stall = this.stalls.filter((x) => x.atMs >= since).reduce((m, x) => Math.max(m, x.lagMs), 0);
    return { receivedLocalMs, offsetMs: this.offset?.offsetMs ?? null, errorBoundMs: this.offset?.errorBoundMs ?? null, stallMs: stall || null, linkEvents: this.linkEvents.filter((x) => x.atMs >= since).map((x) => x.state) };
  }

  /** Both roles: tag everything from now on with the stage; the controller also tells the camera. */
  setStage(stage) {
    const st = STAGES.includes(stage) ? stage : null;
    this.stage = st; this.buffer.setStage(st);
    this.stageChanges.push({ stage: st, atMs: Date.now(), serverMs: this.serverNow() });
    this.onEvent('stage', st);
    if (this.role === 'controller' && this.room) return this.send(stageCommand({ stage: st, decidedAt: this.serverNow() ?? Date.now() }));
    return Promise.resolve(null);
  }

  serverNow() { return this.offset ? Date.now() + this.offset.offsetMs : null; }

  async connect() {
    this.profile = await readProfile();
    this.buffer.profile(this.profile);
    this.onEvent('profile', this.profile);
    await this.syncClock();
    const r = await api('/api/spike/token', { method: 'POST', body: { role: this.role }, accessToken: this.accessToken });
    if (!r.ok) throw new Error(r.data?.error || `token request failed (${r.status})`);
    const room = new Room({ adaptiveStream: false, dynacast: false });
    this.room = room;
    room.on(RoomEvent.DataReceived, (payload, participant, _kind, topic) => { if (topic === TOPIC) this.onData(payload, participant); });
    room.on(RoomEvent.TrackSubscribed, (track, pub, participant) => { if (track.kind === Track.Kind.Video) { this.remoteTrack = { track, publication: pub, participant }; this.onEvent('remote', this.remoteTrack); } });
    room.on(RoomEvent.TrackUnsubscribed, () => { this.remoteTrack = null; this.onEvent('remote', null); });
    room.on(RoomEvent.Disconnected, (reason) => { this.noteLink('disconnected', reason); this.onEvent('disconnected', reason); });
    room.on(RoomEvent.Reconnecting, () => this.noteLink('reconnecting'));
    room.on(RoomEvent.Reconnected, () => this.noteLink('reconnected'));
    room.on(RoomEvent.ConnectionStateChanged, (state) => { if (state !== 'connected') this.noteLink(`state:${state}`); });
    await room.connect(r.data.url, r.data.token);
    this.onEvent('connected', { room: r.data.room, identity: r.data.identity });
    if (this.role === 'camera') await this.startCamera();
    this.timers.push(setInterval(() => this.syncClock().catch(() => {}), RESYNC_EVERY_MS));
    // JS-thread stall watchdog: a 1 s tick that lands more than 1.5 s late
    // means nothing (commands included) was handled in between.
    this.lastTick = Date.now();
    this.timers.push(setInterval(() => {
      const now = Date.now(); const lag = now - this.lastTick - 1000; this.lastTick = now;
      if (lag > 1500) { this.stalls.push({ atMs: now, lagMs: lag }); if (this.stalls.length > 50) this.stalls.shift(); if (this.collect) this.buffer.stall(lag); this.onEvent('stall', { lagMs: lag }); }
    }, 1000));
    this.timers.push(setInterval(() => this.maybeUpload().catch((e) => this.onEvent('error', String(e?.message || e))), 5000));
    this.timers.push(setInterval(() => this.sampleCost(), 5000));
    this.sampleCost();
  }

  async startCamera() {
    // Frame rate: what Settings asked for, held to what this lens advertises (a fractional or unlisted rate lands on the nearest it can hold).
    const fr = resolveFrameRate(this.frameRateWanted, this.profile?.pro?.fpsRanges);
    this.fps = fr.fps; this.frameRate = fr;
    this.onEvent('frameRate', { ...fr, warnings: frameRateWarnings(fr.fps, { frameSource: this.frameSource, exact: fr.exact }) });
    const { stream, info } = await LoudCamera.start({ facing: 'back', width: 1080, height: 1920, fps: fr.fps, fpsRange: fr.range, frameSource: this.frameSource });
    this.stream = stream;
    const mediaTrack = stream.getVideoTracks()[0];
    const track = new LocalVideoTrack(mediaTrack, undefined, true);
    const pub = await this.room.localParticipant.publishTrack(track, {
      source: Track.Source.Camera, simulcast: false, videoEncoding: { maxBitrate: fr.fps > 30 ? 4_500_000 : 3_000_000, maxFramerate: fr.fps },
    });
    // Only now is there a publication for the screen to render: setting
    // `track` earlier let a re-render (the frameSource event fired in this
    // window) mount the preview before the publication existed, and
    // LiveKit's VideoTrack reads publication.track unguarded, which
    // crashed the app the moment Camera was chosen (14 Oct).
    this.track = track;
    this.onEvent('published', { trackSid: pub.trackSid });
    this.onEvent('frameSource', { wanted: info?.frameSourceWanted ?? this.frameSource });
    // Setup: one gravity reading picks the mount, the plan for it goes to the capturer, and until the lock (the first stage or move) the plan follows the mount.
    this.setupMount().catch((e) => this.onEvent('error', `orientation setup: ${String(e?.message || e)}`));
    this.mountTimer = setInterval(() => this.watchMount().catch(() => {}), MOUNT_WATCH_MS);
    this.timers.push(this.mountTimer);
    let announced = null;
    this.stateSub = LoudCamera.addStateListener((s) => {
      this.lastState = s;
      // The capturer may have fallen back to another frame path (hardware → gpu → cpu); say so once when it does.
      if (s?.frameSource && s.frameSource !== announced) { announced = s.frameSource; this.onEvent('frameSource', { wanted: this.frameSource, used: s.frameSource, reason: s.frameSourceReason ?? null, fellBack: Boolean(s.frameSourceFellBack) }); }
      // Every state sample carries the orientation (from the capturer) and the setup mismatch warning, if any (docs/DECISIONS.md 2026-10-14).
      if (this.collect) this.buffer.state({ ...s, offset: undefined, shotId: this.shotId, shot: this.shot, orientationWarning: this.mountCheck?.mismatch ? this.mountCheck.warning : null });
      this.onEvent('state', s);
    });
  }

  async syncClock() {
    const o = await measureOffset({ base: API_BASE });
    if (!o) return;
    // A device clock that stepped between syncs shifts every server-clock
    // latency measured in between; say so in the B12 record and the report.
    const step = this.offset ? o.offsetMs - this.offset.offsetMs : 0;
    const stepped = Math.abs(step) > 1000;
    if (stepped) { this.clockSteps.push({ atMs: Date.now(), fromMs: this.offset.offsetMs, toMs: o.offsetMs, stepMs: step }); if (this.clockSteps.length > 20) this.clockSteps.shift(); this.onEvent('clockStep', { stepMs: step }); }
    this.offset = o; this.buffer.setOffset(o);
    if (this.collect) this.buffer.clock(o, stepped ? { step_ms: step } : {});
    this.onEvent('clock', o);
  }

  // ── orientation (docs/DECISIONS.md 2026-10-14 and 2026-10-15, src/spike/orientation.js) ──
  /**
   * One gravity reading, classified against the chosen orientation and the
   * mount. The warning (if any) goes to the screen, the report, and the
   * controller, and a change of it is sent at once: a resolved mount clears it.
   */
  async checkMount() {
    let g = null;
    try { g = await LoudCamera.gravityCheck(); } catch (e) { g = { available: false, reason: String(e?.message || e) }; }
    const physical = g?.available ? physicalOrientation(g) : 'unknown';
    const mm = orientationMismatch(this.orientation, physical);
    const mount = mountOf(this.orientation, physical);
    this.mountCheck = { ...mm, mount, known: mount.known, inverted: mount.inverted, gravity: g, atMs: Date.now(), serverMs: this.serverNow() };
    const key = `${physical}|${mm.mismatch}|${mm.warning}|${this.orientation}`;
    if (key !== this.mountKey) {
      this.mountKey = key;
      this.onEvent('mount', this.mountCheck);
      this.publishMount().catch(() => {});
    }
    return this.mountCheck;
  }
  /** Camera → controller: the current mount and warning (mountStatus), so the controller's warning follows the phone. */
  async publishMount() {
    const m = this.mountCheck;
    if (!m || !this.room || this.role !== 'camera') return;
    await this.room.localParticipant.publishData(encode(mountStatus({ chosen: this.orientation, physical: m.physical, mismatch: m.mismatch, warning: m.warning, fix: m.fix, desiredRotation: this.plan?.desiredRotation ?? null, atMs: Date.now() })), { reliable: true, topic: TOPIC });
  }
  /** Setup: one reading, then the plan for that mount. */
  async setupMount() {
    const m = await this.checkMount();
    await this.applyOrientation(this.orientation, m.physical);
  }
  /** Before the lock, the plan follows the mount: a reading that differs from the applied mount must agree twice (nextMountPlan) before it is applied. */
  async watchMount() {
    if (this.locked || this.role !== 'camera') return;
    const m = await this.checkMount();
    if (this.locked || this.live()) return;
    const step = nextMountPlan({ planInverted: this.planInverted, reading: m, pending: this.pendingInverted, locked: this.locked });
    this.pendingInverted = step.pending;
    if (step.apply) { this.planInverted = step.inverted; await this.applyOrientation(this.orientation, m.physical); }
  }
  /**
   * Lock time: the first stage or move. One last reading, the plan for that
   * mount, then the mount is frozen for the session. A move already running
   * freezes without a reading (it must not change the picture underneath).
   */
  async lockMount() {
    if (this.locked) return;
    if (this.role === 'camera' && !this.moving) {
      const m = await this.checkMount();
      if (m.known && m.inverted !== this.planInverted) { this.planInverted = m.inverted; await this.applyOrientation(this.orientation, m.physical); }
    }
    this.freezeMount();
  }
  freezeMount() {
    if (this.locked) return;
    this.locked = true;
    clearInterval(this.mountTimer);
    this.onEvent('locked', { orientation: this.orientation, inverted: this.planInverted, rotation: this.plan?.desiredRotation ?? null });
  }
  /**
   * Controller: choose the show's orientation. Locked once the soak or a
   * stage is running (the camera refuses it while live too); otherwise
   * sent to the camera and resolved with its answer, which includes the
   * camera's mount check.
   */
  async setOrientation(o) {
    const want = normaliseOrientation(o);
    if (this.live()) {
      const r = { ok: false, orientation: this.orientation, requested: want, refused: true, reason: `orientation is locked while ${this.soak ? 'the soak' : this.stage ? `stage ${this.stage}` : 'a move'} is running: set it before going live` };
      this.onEvent('orientation', r); return r;
    }
    const a = await this.sendAndWait(orientationCommand({ orientation: want, decidedAt: this.serverNow() ?? Date.now() }));
    const res = a?.result ?? null;
    const ok = Boolean(res && !res.refused && !res.failed);
    const r = { ok, orientation: ok ? want : this.orientation, requested: want, refused: Boolean(res?.refused), reason: a ? (ok ? null : res?.reason || 'the camera did not apply it') : 'no ack from the camera', camera: res };
    if (ok) { this.orientation = want; this.orientationInfo = res; this.orientationLog.push({ orientation: want, atMs: Date.now(), serverMs: this.serverNow(), from: res?.from ?? null, physical: res?.physical ?? null, mismatch: Boolean(res?.mismatch) }); }
    this.onEvent('orientation', r);
    return r;
  }
  /**
   * Hand the camera the frame plan for `o` and the mount it was made for
   * (orientation.js orientationPlan): the content rotation and the frame size
   * come from the plan, the camera applies exactly those numbers. The sensor
   * orientation is the camera's own.
   */
  async applyOrientation(o, physical = this.mountCheck?.physical ?? 'unknown') {
    const st = LoudCamera.getState() || this.lastState || {};
    const plan = orientationPlan({ orientation: o, sensorOrientation: st.sensorOrientation ?? 90, physical });
    if (plan.mount.known) this.planInverted = plan.mount.inverted;
    this.plan = plan;
    const info = await LoudCamera.setOrientation(plan.orientation, plan.desiredRotation);
    return { plan, info };
  }
  /** Camera: apply the orientation unless live. The mount is read once for the new choice, and the plan is made for that mount. */
  async runOrientation(m) {
    const want = normaliseOrientation(m.orientation);
    if (this.live()) return { kind: 'orientation', requested: want, achieved: this.orientation, supported: true, refused: true, reason: `orientation is locked while live (${this.stage ? `stage ${this.stage} is running` : this.moving ? 'a move is running' : 'it was locked at the first move of this session'}): set it before the show${this.moving || this.stage ? '' : ' (in the spike, restart the Camera role to change it)'}` };
    const previous = this.orientation;
    this.orientation = want;                       // the mismatch and the mount are judged against the new choice
    const mount = await this.checkMount();
    const { plan, info } = await this.applyOrientation(want, mount.physical);
    if (info?.refused) { this.orientation = previous; return { kind: 'orientation', requested: want, achieved: previous, supported: true, refused: true, reason: info.reason }; }
    this.orientationInfo = { ...info, plan };
    this.orientationLog.push({ orientation: want, atMs: Date.now(), serverMs: this.serverNow(), rotation: plan.desiredRotation, physical: mount.physical, mismatch: mount.mismatch, inverted: plan.mount.inverted });
    this.onEvent('orientation', { ok: true, orientation: want, ...info, ...mount });
    return { kind: 'orientation', requested: want, achieved: want, supported: true, refused: false, reason: mount.warning, rotation: plan.desiredRotation, sensorOrientation: plan.sensorOrientation, width: plan.width, height: plan.height, inverted: plan.mount.inverted, correction: info?.correction ?? null, builtInRotation: info?.builtInRotation ?? null, physical: mount.physical, mismatch: mount.mismatch, warning: mount.warning, fix: mount.fix };
  }

  sampleCost() {
    const c = LoudCamera.cost();
    if (!c) return;
    const sample = { ...c, atMs: Date.now(), collect: this.collect, moving: this.moving, stage: this.stage };
    this.costSamples.push(sample);
    if (this.costSamples.length > 400) this.costSamples.shift();
    if (this.collect) this.buffer.cost({ cpuMs: c.cpuMs, wallMs: c.wallMs, thermal: c.thermalLabel, batteryPct: c.batteryPct, txBytes: c.txBytes ?? null, bufferedRecords: this.buffer.records.length });
    this.onEvent('cost', sample);
  }

  /** Cost summary the report asks for: CPU share, thermal, battery drop, per collection on/off. */
  costSummary() {
    const groups = { on: [], off: [] };
    for (const s of this.costSamples) groups[s.collect ? 'on' : 'off'].push(s);
    const summarise = (xs) => {
      if (xs.length < 2) return null;
      const a = xs[0]; const b = xs[xs.length - 1];
      const wall = b.wallMs - a.wallMs;
      return {
        minutes: +(wall / 60000).toFixed(1),
        cpuSharePct: wall > 0 ? +(((b.cpuMs - a.cpuMs) / wall) * 100).toFixed(1) : null,
        batteryDropPct: (a.batteryPct != null && b.batteryPct != null) ? a.batteryPct - b.batteryPct : null,
        thermalMax: xs.reduce((m, s) => Math.max(m, s.thermalStatus ?? 0), 0),
        thermalLast: b.thermalLabel,
        txBytes: (a.txBytes != null && b.txBytes != null) ? b.txBytes - a.txBytes : null,
      };
    };
    const byStage = {};
    for (const st of STAGES) {
      const xs = this.costSamples.filter((s) => s.stage === st);
      if (xs.length) byStage[st] = { on: summarise(xs.filter((s) => s.collect)), off: summarise(xs.filter((s) => !s.collect)), samples: xs.length };
    }
    return { on: summarise(groups.on), off: summarise(groups.off), samples: this.costSamples.length, byStage };
  }

  setCollect(on) {
    this.collect = on; this.buffer.enabled = on;
    this.onEvent('collect', on);
  }

  // ── controller side ───────────────────────────────────────────
  async send(command) {
    if (!this.room) throw new Error('not connected');
    command.sentAt = this.serverNow() ?? Date.now();
    command.decidedAt = command.decidedAt ?? command.sentAt;
    const sentLocal = Date.now(); const offsetAtSend = this.offset?.offsetMs ?? null;
    this.pending.set(command.id, { command, sentLocal, offsetAtSend });
    if (this.collect) this.buffer.intent(command.decisionId, { type: command.type, target: command.target ?? null, direction: command.direction ?? null, degree: command.degree ?? null, window: command.window ?? null, duration_ms: command.durationMs, easing: command.easing, source: command.source, tightness: command.target ? tightnessFor(command.target) : null, orientation_requested: command.orientation ?? null, sent_local_ms: sentLocal, offset_at_send_ms: offsetAtSend });
    await this.room.localParticipant.publishData(encode(command), { reliable: true, topic: TOPIC });
    this.onEvent('sent', command);
    return command;
  }
  zoom(target, durationMs = 2000, easing = 'ease-in-out') { return this.send(zoomCommand({ target, durationMs, easing, decidedAt: this.serverNow() ?? Date.now() })); }
  pan(direction, { degree = PAN_DEFAULTS.degree, window = PAN_DEFAULTS.window, durationMs = PAN_DEFAULTS.durationMs, easing = PAN_DEFAULTS.easing } = {}) { return this.send(panCommand({ direction, degree, window, durationMs, easing, decidedAt: this.serverNow() ?? Date.now() })); }
  /** A bop (zoomPlan.js bopPlan): a rhythmic micro-pan with a bounce, on the beat, that ends where it started. */
  bop(direction, { bpm = BOP_DEFAULTS.bpm, durationMs = BOP_DEFAULTS.durationMs, strength = BOP_DEFAULTS.strength } = {}) { return this.send(bopCommand({ direction, bpm, durationMs, strength, decidedAt: this.serverNow() ?? Date.now() })); }

  // ── pro mode (controller side) ────────────────────────────────
  /** One manual-control change on the camera (proMode.js for the controls and units). */
  pro(control, value = null) { return this.send(proCommand({ control, value, decidedAt: this.serverNow() ?? Date.now() })); }
  /** Ask the camera for its pro capability (B2 `pro` block + support), so the controls can be gated; resolves with the ack. */
  async requestSurvey() {
    const ack = await this.sendAndWait(surveyRequest({ decidedAt: this.serverNow() ?? Date.now() }));
    if (ack?.result?.profile) { this.cameraProfile = ack.result.profile; this.onEvent('cameraProfile', this.cameraProfile); }
    return ack;
  }
  /** Send a command and resolve with its ack (or null after `timeoutMs`). */
  async sendAndWait(command, timeoutMs = 8000) {
    const p = new Promise((resolve) => {
      const t = setTimeout(() => { this.ackWaiters.delete(command.id); resolve(null); }, timeoutMs);
      this.ackWaiters.set(command.id, (ackMsg) => { clearTimeout(t); resolve(ackMsg); });
    });
    await this.send(command);
    return p;
  }
  /**
   * Match cameras (docs/SPIKE_PRO_MODE_PLAN.md section 3): read the
   * reference camera's exposure and white balance, then have every camera
   * lock to the nearest values it can achieve. Resolves with { targets,
   * results } and keeps it for the report.
   */
  async matchCameras() {
    const read = await this.sendAndWait(matchCommand({ phase: 'read', decidedAt: this.serverNow() ?? Date.now() }));
    if (!read?.result?.targets) { const r = { ok: false, reason: read ? (read.result?.reason || 'the reference camera did not report its values') : 'no ack from the reference camera', targets: null, results: [] }; this.match = r; this.onEvent('match', r); return r; }
    const targets = read.result.targets;
    const applied = await this.sendAndWait(matchCommand({ phase: 'apply', targets, reference: read.result.from ?? null, decidedAt: this.serverNow() ?? Date.now() }));
    const results = applied ? [{ from: applied.result?.from ?? null, achieved: applied.result?.achieved ?? null, residual: applied.result?.residual ?? null, reasons: applied.result?.reasons ?? [] }] : [];
    const r = { ok: Boolean(applied), reason: applied ? null : 'no ack to the apply phase', reference: read.result.from ?? null, targets, results, at: this.serverNow() ?? Date.now(), stage: this.stage };
    this.match = r; this.onEvent('match', r);
    return r;
  }

  /** 20-minute soak: a move every 30 s, alternating zoom in, zoom out, pan. */
  startSoak(minutes = 20) {
    this.stopSoak();
    const started = Date.now(); let i = 0;
    const tick = () => {
      if (Date.now() - started > minutes * 60000) { this.stopSoak(); this.onEvent('soak', { done: true, moves: i }); return; }
      // Pans only on the zoomed framing (zoomPlan MIN_PAN_ZOOM): zoom in, pan left, pan right, zoom out.
      const k = i % 4; i += 1;
      const p = k === 0 ? this.zoom(2, 2000) : k === 1 ? this.pan('left', { durationMs: 3000 }) : k === 2 ? this.pan('right', { durationMs: 3000 }) : this.zoom(1, 2000);
      p.catch((e) => this.onEvent('error', String(e?.message || e)));
      this.onEvent('soak', { done: false, moves: i, minutes: +((Date.now() - started) / 60000).toFixed(1) });
    };
    tick();
    this.soak = setInterval(tick, 30000);
  }
  stopSoak() { if (this.soak) { clearInterval(this.soak); this.soak = null; } }

  // ── both sides ────────────────────────────────────────────────
  onData(payload, participant) {
    let m; try { m = decode(payload); } catch { return; }
    const arrived = Date.now();
    if (m.type === 'ack') {
      const p = this.pending.get(m.id);
      if (p) {
        this.pending.delete(m.id);
        // moveCycleMs is the whole cycle on this clock: send, the move
        // itself (2-3 s by design), and the ack back. The two legs that
        // measure the network alone come from the ack's server-clock
        // timestamps (commands.ackLatencies).
        const lat = { ...ackLatencies(m, { sentLocal: p.sentLocal, arrivedLocal: arrived, arrivedServer: this.serverNow() }), stage: this.stage, type: m.forType };
        this.latencies.push(lat); if (this.latencies.length > 200) this.latencies.shift();
        if (m.result && typeof m.result === 'object') m.result.from = m.result.from ?? participant?.identity ?? null;
        const waiter = this.ackWaiters.get(m.id); if (waiter) { this.ackWaiters.delete(m.id); waiter(m); }
        // A slow leg out is diagnosed from both sides' local clocks and offsets (commands.slowCommandDiagnosis) and kept for the report.
        const slow = slowCommandDiagnosis(lat, p, m.diag);
        if (slow) { this.slowCommands.push({ ...slow, type: m.forType, decisionId: m.decisionId, atMs: arrived, stage: this.stage }); if (this.slowCommands.length > 20) this.slowCommands.shift(); this.onEvent('slowCommand', { ...slow, type: m.forType }); }
        if (this.collect) this.buffer.result(m.decisionId, { ...m.result, timestamps: m.timestamps, move_cycle_ms: lat.moveCycleMs, command_latency_ms: lat.commandLatencyMs, ack_leg_ms: lat.ackLegMs, from: participant?.identity || null, sent_local_ms: p.sentLocal, offset_at_send_ms: p.offsetAtSend, camera_diag: m.diag ?? null, slow_command: slow });
        this.onEvent('ack', { ack: m, ...lat, command: p.command, slow });
      }
      return;
    }
    if (this.role !== 'camera') return;
    if (m.type === 'zoom' || m.type === 'pan' || m.type === 'bop') this.execute(m).catch((e) => this.onEvent('error', String(e?.message || e)));
    else if (m.type === 'pro' || m.type === 'match' || m.type === 'stage' || m.type === 'survey' || m.type === 'orientation') this.executePro(m).catch((e) => this.onEvent('error', String(e?.message || e)));
  }

  /**
   * Camera side of pro mode: every command is a decision (intent on
   * receipt, result on completion) and is acked with the achieved value,
   * a reason when clamped or unsupported, and the warnings. Nothing here
   * touches the frame path.
   */
  async executePro(m) {
    const receivedLocal = Date.now();
    const receivedAt = this.serverNow() ?? receivedLocal;
    this.onEvent('command', m);
    if (m.type === 'stage') { await this.lockMount(); this.setStage(m.stage); }
    if (this.collect) this.buffer.intent(m.decisionId, { type: m.type, control: m.control ?? null, value: m.value ?? null, phase: m.phase ?? null, targets: m.targets ?? null, stage_requested: m.stage ?? null, orientation_requested: m.orientation ?? null, source: m.source ?? null, received_from: 'data-channel', received_local_ms: receivedLocal, offset_at_receipt_ms: this.offset?.offsetMs ?? null });
    const startedAt = this.serverNow() ?? Date.now();
    let result;
    try {
      if (m.type === 'stage') result = { kind: 'stage', stage: this.stage, achieved: this.stage, requested: m.stage, supported: true, reason: null };
      else if (m.type === 'survey') result = { kind: 'survey', profile: { pro: this.profile?.pro ?? null, proSupport: this.profile?.proSupport ?? null, frameSource: this.lastState?.frameSource ?? null, fps: this.fps, frameRate: this.frameRate, hardwareLevel: this.profile?.pro?.hardwareLevel ?? null, make: this.profile?.make, model: this.profile?.model }, supported: true, reason: null };
      else if (m.type === 'pro') result = await this.runPro(m.control, m.value);
      else if (m.type === 'orientation') result = await this.runOrientation(m);
      else result = await this.runMatch(m);
    } catch (e) {
      result = { kind: m.type, control: m.control ?? null, requested: m.value ?? null, achieved: null, clamped: false, supported: true, reason: String(e?.message || e), failed: true };
    }
    const completedAt = this.serverNow() ?? Date.now();
    result = { ...result, stage: this.stage, proEnabled: Boolean(this.lastState?.pro?.enabled || result.proEnabled) };
    const reply = ack({ command: m, receivedAt, startedAt, completedAt, result, diag: this.receiptDiag(receivedLocal) });
    if (this.collect) this.buffer.result(m.decisionId, { ...result, timestamps: reply.timestamps });
    this.proLog.push({ type: m.type, control: m.control ?? m.phase ?? m.orientation ?? null, requested: m.value ?? null, achieved: result.achieved ?? null, reason: result.reason ?? null, framesToApply: result.framesToApply ?? null, settleMs: result.settleMs ?? null, settled: result.settled ?? null, stage: this.stage, atMs: Date.now() });
    if (this.proLog.length > 100) this.proLog.shift();
    await this.room.localParticipant.publishData(encode(reply), { reliable: true, topic: TOPIC });
    this.onEvent('result', { command: m, result, reply });
    return result;
  }

  /** One pro control: clamp against the profile first (no native call when unsupported), then the native change, then the readback. */
  async runPro(control, value) {
    const pro = this.profile?.pro ?? null;
    const c = clampPro(control, value, pro);
    const warnings = proWarnings(control, c.value ?? value, { fps: this.fps, pro });
    if (!c.supported) return { kind: 'pro', control, requested: value, achieved: null, clamped: false, supported: false, reason: c.reason, warnings, applied: false };
    if (c.value == null && !['enable', 'disable', 'lock', 'unlock'].includes(control)) return { kind: 'pro', control, requested: value, achieved: null, clamped: false, supported: true, reason: c.reason, warnings, applied: false };
    const r = await LoudCamera.setPro(control, control === 'lock' || control === 'unlock' ? value : (c.value ?? null));
    const reason = [c.clamped ? c.reason : null, r?.reason].filter(Boolean).join('; ') || null;
    return { ...r, kind: 'pro', control, requested: value, planned: c.value, clamped: Boolean(c.clamped || r?.clamped), supported: r?.supported !== false, reason, warnings, applied: true };
  }

  /** Match cameras, camera side: 'read' reports this camera's values; 'apply' locks to the nearest achievable values and reports the residual. */
  async runMatch(m) {
    if (m.phase === 'read') {
      const rb = await LoudCamera.proRead();
      const targets = { iso: Number.isFinite(rb?.iso) ? Math.round(rb.iso) : null, shutterMs: Number.isFinite(rb?.shutterMs) ? rb.shutterMs : null, wbKelvin: Number.isFinite(rb?.wbKelvin) ? rb.wbKelvin : null };
      return { kind: 'match', phase: 'read', targets, readback: rb, supported: true, reason: targets.iso == null && targets.shutterMs == null ? 'the HAL reported no exposure values yet' : null, achieved: null };
    }
    const t = m.targets || {};
    const reasons = [];
    const achieved = { iso: null, shutterMs: null, wbKelvin: null };
    const step = async (control, v, key) => {
      if (!Number.isFinite(v)) { reasons.push(`${control}: no target from the reference`); return; }
      const r = await this.runPro(control, v);
      if (!r.supported) reasons.push(`${control}: ${r.reason}`);
      else { achieved[key] = Number.isFinite(r.achieved) ? r.achieved : (r.planned ?? null); if (r.reason) reasons.push(`${control}: ${r.reason}`); }
    };
    await step('iso', t.iso, 'iso');
    await step('shutter', t.shutterMs, 'shutterMs');
    await step('wb', t.wbKelvin, 'wbKelvin');
    const residual = matchResidual(t, achieved);
    return { kind: 'match', phase: 'apply', targets: t, achieved, residual, reasons, supported: true, reason: reasons.length ? reasons.join('; ') : null };
  }

  async execute(m) {
    this.freezeMount();
    const receivedLocal = Date.now();
    const receivedAt = this.serverNow() ?? receivedLocal;
    this.onEvent('command', m);
    if (this.collect) this.buffer.intent(m.decisionId, { type: m.type, target: m.target ?? null, direction: m.direction ?? null, degree: m.degree ?? null, window: m.window ?? null, bpm: m.bpm ?? null, strength: m.strength ?? null, duration_ms: m.durationMs, easing: m.easing ?? null, source: m.source, received_from: 'data-channel', shot_id: this.shotId, shot: this.shot, received_local_ms: receivedLocal, offset_at_receipt_ms: this.offset?.offsetMs ?? null });
    this.moving = true;
    const startedAt = this.serverNow() ?? Date.now();
    const shotBefore = this.shot; const shotIdBefore = this.shotId;
    let result;
    try {
      result = await this.runMove(m);
    } catch (e) {
      result = { mode: 'none', frameSource: this.lastState?.frameSource ?? null, requested: m.target ?? null, achieved: null, clamped: false, reason: String(e?.message || e), droppedFrames: 0, actualDurationMs: 0, refused: false, failed: true };
    }
    this.moving = false;
    const completedAt = this.serverNow() ?? Date.now();
    result = { ...result, shotBefore, shotIdBefore, shot: this.shot, shotId: this.shotId };
    const reply = ack({ command: m, receivedAt, startedAt, completedAt, result, diag: this.receiptDiag(receivedLocal) });
    if (this.collect) this.buffer.result(m.decisionId, { ...result, timestamps: reply.timestamps });
    await this.room.localParticipant.publishData(encode(reply), { reliable: true, topic: TOPIC });
    this.onEvent('result', { command: m, result, reply });
    return result;
  }

  /**
   * Plan the move against the current shot and this camera's frame source
   * (zoomPlan.js), hand the steps to the native capturer, and move the
   * shot on when the move was applied. A pan into a frame edge comes
   * back refused (no native call, `refused: true`, the reason in
   * `reason`), and the shot stays where it was.
   */
  async runMove(m) {
    const st = this.lastState || LoudCamera.getState() || {};
    const caps = capsFor(this.profile, st);
    const common = { frameSource: st.frameSource ?? caps.frameSource, panPath: caps.panPath, orientation: st.orientation ?? this.orientation };
    let plan; let requested;
    if (m.type === 'zoom') {
      plan = zoomPlan({ profile: this.profile, caps, shot: this.shot, target: m.target, durationMs: m.durationMs, easing: m.easing, stepMs: 1000 / this.fps });
      requested = m.target;
    } else if (m.type === 'bop') {
      plan = bopPlan({ direction: m.direction, bpm: m.bpm, durationMs: m.durationMs, strength: m.strength, shot: this.shot, caps, stepMs: 1000 / this.fps });
      requested = plan.amplitudeRequested;
      if (plan.refused) {
        return { ...common, kind: 'bop', mode: null, path: 'bop', requested, achieved: 0, clamped: false, reason: plan.reason, refused: true, direction: m.direction, bpm: plan.bpm, beats: 0, amplitude: 0, durationMs: plan.durationMs, droppedFrames: 0, framesDuring: 0, actualDurationMs: 0, stepsPlanned: 0, stepsApplied: 0 };
      }
    } else {
      plan = panPlan({ direction: m.direction, degree: m.degree, window: m.window, durationMs: m.durationMs, easing: m.easing, shot: this.shot, caps, stepMs: 1000 / this.fps });
      requested = plan.travelRequested;
      if (plan.refused) {
        return { ...common, kind: 'pan', mode: null, path: plan.path, requested, achieved: 0, clamped: false, reason: plan.reason, refused: true, direction: m.direction, room: plan.room, window: plan.window, travel: 0, droppedFrames: 0, framesDuring: 0, actualDurationMs: 0, stepsPlanned: 0, stepsApplied: 0 };
      }
    }
    const r = await LoudCamera.move(m.type, plan.mode, plan.steps, requested);
    // Where the camera is now: the end shot, or the last applied step's shot if the move was cut short.
    const applied = Number.isFinite(r?.stepsApplied) ? r.stepsApplied : plan.steps.length;
    const landed = r?.cancelled && applied < plan.steps.length ? (plan.shots[Math.max(0, applied - 1)] || this.shot) : plan.to;
    this.shot = landed; this.shotId = mintId('shot'); this.shots += 1;
    if (m.type === 'zoom') {
      return { ...r, ...common, mode: plan.mode, clamped: Boolean(r.clamped || plan.clamped), reason: r.reason || plan.reason, releasedCrop: plan.releasesCrop, refused: false };
    }
    if (m.type === 'bop') {
      // A bop is judged by its amplitude (what each hit moved, wide-frame fraction) and whether it ran to the end; it lands home.
      return {
        ...r, ...common, kind: 'bop', mode: plan.mode, path: 'bop', requested, achieved: r?.cancelled ? 0 : plan.amplitude, clamped: Boolean(plan.capped), reason: r.reason || plan.reason || null, refused: false,
        capped: Boolean(plan.capped), direction: m.direction, bpm: plan.bpm, beats: plan.beats, amplitude: plan.amplitude, pulse: plan.pulse, durationMs: plan.durationMs, zoomAtBop: plan.zoom, strength: plan.strength,
      };
    }
    // A pan is judged by its travel, not by a zoom figure: requested is
    // what was asked (frame fraction), achieved what the camera reports
    // (the HAL's own region on the hardware path, the plan elsewhere).
    const achieved = panTravelAchieved(plan, r, landed);
    return {
      ...r, ...common, mode: plan.mode, path: plan.path, requested, achieved, clamped: Math.abs(achieved - requested) > 0.01, reason: r.reason || plan.reason || null, refused: false,
      capped: Boolean(plan.capped), travelPlanned: plan.travel,
      direction: m.direction, room: plan.room, window: plan.window, tightened: plan.tightened, travel: achieved, zoomAtPan: plan.zoom, effectiveZoomAchieved: r.achieved ?? null,
    };
  }

  // ── Part C: batches ───────────────────────────────────────────
  async maybeUpload(forced = false) {
    const due = uploadDue({ now: Date.now(), lastUploadAt: this.lastUploadAt, moving: this.moving || this.lastState?.moving, enabled: this.collect || forced, buffered: this.buffer.records.length, forced });
    if (!due) return null;
    const batch = this.buffer.drain();
    if (!batch) return null;
    const t0 = Date.now();
    const file = new File(Paths.cache, `${batch.name}.gz`);
    const gz = await LoudCamera.writeGzip(file.uri, batch.text);
    const minted = await api('/api/spike/upload-url', { method: 'POST', body: { name: `${batch.name}.gz`, deviceId: this.deviceId }, accessToken: this.accessToken });
    if (!minted.ok) { this.uploads.push({ name: batch.name, ok: false, error: minted.data?.error || minted.status, records: batch.records }); this.onEvent('upload', this.uploads[this.uploads.length - 1]); return null; }
    const url = absoluteUploadUrl(minted.data.signedUrl);
    const up = await LoudCamera.uploadFile(file.uri, url, 'application/gzip', { 'x-upsert': 'false' });
    const rec = { name: batch.name, ok: up.status >= 200 && up.status < 300, status: up.status, records: batch.records, rawBytes: batch.bytes, gzBytes: gz.bytes, ms: Date.now() - t0, path: minted.data.path, dropped: batch.dropped };
    this.uploads.push(rec); if (rec.ok) this.lastUploadAt = Date.now();
    try { file.delete(); } catch { /* cache */ }
    this.onEvent('upload', rec);
    return rec;
  }

  /** Storage per hour from what this device actually produced. */
  storageSummary() {
    const ok = this.uploads.filter((u) => u.ok);
    const gz = ok.reduce((s, u) => s + (u.gzBytes || 0), 0); const raw = ok.reduce((s, u) => s + (u.rawBytes || 0), 0); const recs = ok.reduce((s, u) => s + (u.records || 0), 0);
    const minutes = ok.length ? Math.max(1, ok.length * (BATCH_EVERY_MS / 60000)) : 0;
    return { batches: ok.length, failed: this.uploads.length - ok.length, records: recs, rawBytes: raw, gzBytes: gz, gzBytesPerHour: minutes ? Math.round((gz / minutes) * 60) : null, rawBytesPerHour: minutes ? Math.round((raw / minutes) * 60) : null, ratio: gz ? +(raw / gz).toFixed(1) : null };
  }

  /** Controller side: the three latencies over the session, each as n/p50/p90/max (commands.summariseLatencies), overall and per stage. */
  latencySummary() {
    const all = summariseLatencies(this.latencies);
    if (!all) return null;
    const byStage = {};
    for (const st of STAGES) { const xs = this.latencies.filter((l) => l.stage === st); if (xs.length) byStage[st] = summariseLatencies(xs); }
    const pro = this.latencies.filter((l) => l.type === 'pro' || l.type === 'match');
    return { ...all, byStage, proCommands: pro.length ? summariseLatencies(pro) : null };
  }

  /** Everything the report needs, as one JSON object; the screen also writes it to a file. */
  report() {
    return {
      role: this.role, deviceId: this.deviceId, sessionId: this.sessionId, appVersion: APP_VERSION,
      stage: this.stage, stageChanges: this.stageChanges,
      frameSource: this.role === 'camera' ? { wanted: this.frameSource, used: this.lastState?.frameSource ?? null, reason: this.lastState?.frameSourceReason ?? null } : null,
      profile: this.profile, cameraProfile: this.cameraProfile, clock: this.offset, latency: this.latencySummary(), shots: this.shots,
      pro: { enabled: Boolean(this.lastState?.pro?.enabled), last: this.lastState?.pro ?? null, log: this.proLog.slice(-40) }, match: this.match,
      // Session context: the orientation in force, what the capturer did with it, the setup mount check, and every change.
      orientation: { chosen: this.orientation, camera: this.orientationInfo, mount: this.mountCheck, log: this.orientationLog.slice(-20), panPath: this.lastState?.panPath ?? null, regionProbe: this.lastState?.regionProbe ?? null },
      // Slow-command diagnostics (14 Oct: one command took 30 s and nothing recorded said why).
      slowCommands: this.slowCommands.slice(-20), link: this.linkEvents.slice(-20), stalls: this.stalls.slice(-20), clockSteps: this.clockSteps.slice(-20),
      cost: this.costSummary(), storage: this.storageSummary(), uploads: this.uploads.slice(-20), lastState: this.lastState, writtenAt: new Date().toISOString(), reportUpload: this.reportUpload ?? null,
    };
  }
  /**
   * Write the report to the app's documents folder (app-private on Android:
   * not visible in Files or over USB, hence shareReport and the upload),
   * then upload the same JSON to the director-spike bucket through the
   * signed-URL route. Returns { uri, name, upload }; the upload result is
   * also kept on the session so a report written before the upload can
   * still say whether it reached the bucket.
   */
  async writeReport() {
    const name = `spike-report-${this.role}-${this.deviceId}-${Date.now()}.json`;
    const file = new File(Paths.document, name);
    file.write(JSON.stringify(this.report(), null, 2));
    let upload;
    try {
      const minted = await api('/api/spike/upload-url', { method: 'POST', body: { name, deviceId: this.deviceId }, accessToken: this.accessToken });
      if (!minted.ok) upload = { name, ok: false, error: minted.data?.error || minted.status };
      else {
        const up = await LoudCamera.uploadFile(file.uri, absoluteUploadUrl(minted.data.signedUrl), 'application/json', { 'x-upsert': 'false' });
        upload = { name, ok: up.status >= 200 && up.status < 300, status: up.status, bytes: up.bytes, path: minted.data.path };
      }
    } catch (e) { upload = { name, ok: false, error: String(e?.message || e) }; }
    this.reportUpload = upload;
    this.onEvent('reportUpload', upload);
    return { uri: file.uri, name, upload };
  }

  async stop() {
    this.stopSoak();
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    try { await this.maybeUpload(true); } catch { /* best effort */ }
    if (this.stateSub) { this.stateSub.remove(); this.stateSub = null; }
    try { if (this.track) { await this.room?.localParticipant.unpublishTrack(this.track); this.track.stop(); } } catch { /* closing */ }
    try { this.stream?.getTracks().forEach((t) => t.stop()); this.stream?.release?.(); } catch { /* closing */ }
    try { await LoudCamera.stop(); } catch { /* closing */ }
    try { await this.room?.disconnect(); } catch { /* closing */ }
    this.room = null;
  }
}

/**
 * How far a pan actually moved, as a frame fraction: on the hardware path
 * from the HAL's own applied region (its centre against the shot the pan
 * measured from), elsewhere the crop is exact so the landed shot says.
 */
export function panTravelAchieved(plan, r, landed) {
  const start = { cx: plan.from.cx, cy: plan.from.cy };
  const ac = r?.appliedCrop;
  // On the hybrid pan path (the HAL re-centres regions) the region is centred by design and the GPU crop is exact, so the landed shot says.
  if (r?.frameSource === 'hardware' && r?.panPath !== 'gpu' && ac && Number.isFinite(ac.x) && Number.isFinite(ac.w)) {
    return +Math.hypot(ac.x + ac.w / 2 - start.cx, ac.y + ac.h / 2 - start.cy).toFixed(4);
  }
  return +Math.hypot(landed.cx - start.cx, landed.cy - start.cy).toFixed(4);
}

/** storage-js returns the signed upload URL absolute or /storage/v1-relative depending on version. */
export function absoluteUploadUrl(signedUrl, base = process.env.EXPO_PUBLIC_SUPABASE_URL || Constants.expoConfig?.extra?.supabaseUrl || '') {
  if (!signedUrl) return null;
  if (/^https?:\/\//i.test(signedUrl)) return signedUrl;
  const root = String(base).replace(/\/+$/, '');
  const suffix = signedUrl.startsWith('/') ? signedUrl : `/${signedUrl}`;
  return suffix.startsWith('/storage/v1') ? `${root}${suffix}` : `${root}/storage/v1${suffix}`;
}
