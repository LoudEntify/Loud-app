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
import { TOPIC, zoomCommand, panCommand, proCommand, matchCommand, stageCommand, surveyRequest, ack, encode, decode, ackLatencies, summariseLatencies, mintId } from './commands';
import { clampPro, proWarnings, matchResidual, STAGES } from './proMode';
import { capsFor, zoomPlan, panPlan, tightnessFor, PAN_DEFAULTS, SHOT_HOME, FRAME_SOURCES } from './zoomPlan';
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
  constructor({ role, accessToken, userId, onEvent, frameSource = 'auto' }) {
    this.role = role; this.accessToken = accessToken; this.userId = userId; this.onEvent = onEvent || (() => {});
    this.frameSource = FRAME_SOURCES.includes(frameSource) ? frameSource : 'auto';
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
    room.on(RoomEvent.Disconnected, (reason) => this.onEvent('disconnected', reason));
    await room.connect(r.data.url, r.data.token);
    this.onEvent('connected', { room: r.data.room, identity: r.data.identity });
    if (this.role === 'camera') await this.startCamera();
    this.timers.push(setInterval(() => this.syncClock().catch(() => {}), RESYNC_EVERY_MS));
    this.timers.push(setInterval(() => this.maybeUpload().catch((e) => this.onEvent('error', String(e?.message || e))), 5000));
    this.timers.push(setInterval(() => this.sampleCost(), 5000));
    this.sampleCost();
  }

  async startCamera() {
    const { stream, info } = await LoudCamera.start({ facing: 'back', width: 1080, height: 1920, fps: 30, frameSource: this.frameSource });
    this.stream = stream;
    const mediaTrack = stream.getVideoTracks()[0];
    const track = new LocalVideoTrack(mediaTrack, undefined, true);
    const pub = await this.room.localParticipant.publishTrack(track, {
      source: Track.Source.Camera, simulcast: false, videoEncoding: { maxBitrate: 3_000_000, maxFramerate: 30 },
    });
    // Only now is there a publication for the screen to render: setting
    // `track` earlier let a re-render (the frameSource event fired in this
    // window) mount the preview before the publication existed, and
    // LiveKit's VideoTrack reads publication.track unguarded, which
    // crashed the app the moment Camera was chosen (14 Oct).
    this.track = track;
    this.onEvent('published', { trackSid: pub.trackSid });
    this.onEvent('frameSource', { wanted: info?.frameSourceWanted ?? this.frameSource });
    let announced = null;
    this.stateSub = LoudCamera.addStateListener((s) => {
      this.lastState = s;
      // The capturer may have fallen back to another frame path (hardware → gpu → cpu); say so once when it does.
      if (s?.frameSource && s.frameSource !== announced) { announced = s.frameSource; this.onEvent('frameSource', { wanted: this.frameSource, used: s.frameSource, reason: s.frameSourceReason ?? null, fellBack: Boolean(s.frameSourceFellBack) }); }
      if (this.collect) this.buffer.state({ ...s, offset: undefined, shotId: this.shotId, shot: this.shot });
      this.onEvent('state', s);
    });
  }

  async syncClock() {
    const o = await measureOffset({ base: API_BASE });
    if (o) { this.offset = o; this.buffer.setOffset(o); if (this.collect) this.buffer.clock(o); this.onEvent('clock', o); }
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
    const sentLocal = Date.now();
    this.pending.set(command.id, { command, sentLocal });
    if (this.collect) this.buffer.intent(command.decisionId, { type: command.type, target: command.target ?? null, direction: command.direction ?? null, degree: command.degree ?? null, window: command.window ?? null, duration_ms: command.durationMs, easing: command.easing, source: command.source, tightness: command.target ? tightnessFor(command.target) : null });
    await this.room.localParticipant.publishData(encode(command), { reliable: true, topic: TOPIC });
    this.onEvent('sent', command);
    return command;
  }
  zoom(target, durationMs = 2000, easing = 'ease-in-out') { return this.send(zoomCommand({ target, durationMs, easing, decidedAt: this.serverNow() ?? Date.now() })); }
  pan(direction, { degree = PAN_DEFAULTS.degree, window = PAN_DEFAULTS.window, durationMs = PAN_DEFAULTS.durationMs, easing = PAN_DEFAULTS.easing } = {}) { return this.send(panCommand({ direction, degree, window, durationMs, easing, decidedAt: this.serverNow() ?? Date.now() })); }

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
      const k = i % 4; i += 1;
      const p = k === 0 ? this.zoom(2, 2000) : k === 1 ? this.pan(i % 8 < 4 ? 'left' : 'right', { durationMs: 3000 }) : k === 2 ? this.zoom(1, 2000) : this.pan('up', { degree: 0.04, durationMs: 2500 });
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
        if (this.collect) this.buffer.result(m.decisionId, { ...m.result, timestamps: m.timestamps, move_cycle_ms: lat.moveCycleMs, command_latency_ms: lat.commandLatencyMs, ack_leg_ms: lat.ackLegMs, from: participant?.identity || null });
        this.onEvent('ack', { ack: m, ...lat, command: p.command });
      }
      return;
    }
    if (this.role !== 'camera') return;
    if (m.type === 'zoom' || m.type === 'pan') this.execute(m).catch((e) => this.onEvent('error', String(e?.message || e)));
    else if (m.type === 'pro' || m.type === 'match' || m.type === 'stage' || m.type === 'survey') this.executePro(m).catch((e) => this.onEvent('error', String(e?.message || e)));
  }

  /**
   * Camera side of pro mode: every command is a decision (intent on
   * receipt, result on completion) and is acked with the achieved value,
   * a reason when clamped or unsupported, and the warnings. Nothing here
   * touches the frame path.
   */
  async executePro(m) {
    const receivedAt = this.serverNow() ?? Date.now();
    this.onEvent('command', m);
    if (m.type === 'stage') this.setStage(m.stage);
    if (this.collect) this.buffer.intent(m.decisionId, { type: m.type, control: m.control ?? null, value: m.value ?? null, phase: m.phase ?? null, targets: m.targets ?? null, stage_requested: m.stage ?? null, source: m.source ?? null, received_from: 'data-channel' });
    const startedAt = this.serverNow() ?? Date.now();
    let result;
    try {
      if (m.type === 'stage') result = { kind: 'stage', stage: this.stage, achieved: this.stage, requested: m.stage, supported: true, reason: null };
      else if (m.type === 'survey') result = { kind: 'survey', profile: { pro: this.profile?.pro ?? null, proSupport: this.profile?.proSupport ?? null, frameSource: this.lastState?.frameSource ?? null, hardwareLevel: this.profile?.pro?.hardwareLevel ?? null, make: this.profile?.make, model: this.profile?.model }, supported: true, reason: null };
      else if (m.type === 'pro') result = await this.runPro(m.control, m.value);
      else result = await this.runMatch(m);
    } catch (e) {
      result = { kind: m.type, control: m.control ?? null, requested: m.value ?? null, achieved: null, clamped: false, supported: true, reason: String(e?.message || e), failed: true };
    }
    const completedAt = this.serverNow() ?? Date.now();
    result = { ...result, stage: this.stage, proEnabled: Boolean(this.lastState?.pro?.enabled || result.proEnabled) };
    const reply = ack({ command: m, receivedAt, startedAt, completedAt, result });
    if (this.collect) this.buffer.result(m.decisionId, { ...result, timestamps: reply.timestamps });
    this.proLog.push({ type: m.type, control: m.control ?? m.phase ?? null, requested: m.value ?? null, achieved: result.achieved ?? null, reason: result.reason ?? null, stage: this.stage, atMs: Date.now() });
    if (this.proLog.length > 100) this.proLog.shift();
    await this.room.localParticipant.publishData(encode(reply), { reliable: true, topic: TOPIC });
    this.onEvent('result', { command: m, result, reply });
    return result;
  }

  /** One pro control: clamp against the profile first (no native call when unsupported), then the native change, then the readback. */
  async runPro(control, value) {
    const pro = this.profile?.pro ?? null;
    const c = clampPro(control, value, pro);
    const warnings = proWarnings(control, c.value ?? value, { fps: 30, pro });
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
    const receivedAt = this.serverNow() ?? Date.now();
    this.onEvent('command', m);
    if (this.collect) this.buffer.intent(m.decisionId, { type: m.type, target: m.target ?? null, direction: m.direction ?? null, degree: m.degree ?? null, window: m.window ?? null, duration_ms: m.durationMs, easing: m.easing, source: m.source, received_from: 'data-channel', shot_id: this.shotId, shot: this.shot });
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
    const reply = ack({ command: m, receivedAt, startedAt, completedAt, result });
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
    const common = { frameSource: st.frameSource ?? caps.frameSource };
    let plan; let requested;
    if (m.type === 'zoom') {
      plan = zoomPlan({ profile: this.profile, caps, shot: this.shot, target: m.target, durationMs: m.durationMs, easing: m.easing });
      requested = m.target;
    } else {
      plan = panPlan({ direction: m.direction, degree: m.degree, window: m.window, durationMs: m.durationMs, easing: m.easing, shot: this.shot, caps });
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
    // A pan is judged by its travel, not by a zoom figure: requested is
    // what was asked (frame fraction), achieved what the camera reports
    // (the HAL's own region on the hardware path, the plan elsewhere).
    const achieved = panTravelAchieved(plan, r, landed);
    return {
      ...r, ...common, mode: plan.mode, path: plan.path, requested, achieved, clamped: Math.abs(achieved - requested) > 0.01, reason: r.reason || null, refused: false,
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
  if (r?.frameSource === 'hardware' && ac && Number.isFinite(ac.x) && Number.isFinite(ac.w)) {
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
