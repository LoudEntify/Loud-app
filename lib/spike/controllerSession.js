// lib/spike/controllerSession.js — the laptop's Controller for the device-
// zoom spike (docs/DIRECTOR_DATA_SPEC.md, branch spike/native-device-zoom).
//
// With one Android phone there is nobody to hold the second phone, so the
// web app plays the Controller role instead: it joins the artist's own
// rehearsal room with a token from /api/spike/token, subscribes to the
// phone's camera track, sends the same zoom and pan commands and records
// the same acks. The protocol, the timestamps and the report are the
// phone Controller's, not a copy of them: this file imports the platform-
// free modules the phone uses (native/src/spike/commands.js, zoomPlan.js,
// clock.js, capture.js) and mirrors the controller half of
// native/src/spike/runtime.js line for line where it matters (send,
// ack handling, the soak, the report). The phone app is untouched.
//
// Platform-free on purpose: the room, fetch, the clock and gzip are all
// injected so tests/spike-web-controller.test.mjs can drive a whole
// session in node. components/spike/ControllerScreen.jsx supplies the
// real ones (livekit-client, window.fetch, CompressionStream).
//
// SPIKE ONLY: delete with app/api/spike/* when the spike ends.
// PRD rows 12, 13, 127, 128, 165. S&I: Real-time media, Observability.
import { TOPIC, zoomCommand, panCommand, bopCommand, proCommand, matchCommand, stageCommand, surveyRequest, orientationCommand, encode, decode, ackLatencies, summariseLatencies, slowCommandDiagnosis, mintId } from '../../native/src/spike/commands.js';
import { STAGES } from '../../native/src/spike/proMode.js';
import { DEFAULT_ORIENTATION, normaliseOrientation } from '../../native/src/spike/orientation.js';
import { tightnessFor, PAN_DEFAULTS, BOP_DEFAULTS } from '../../native/src/spike/zoomPlan.js';
import { measureOffset, RESYNC_EVERY_MS } from '../../native/src/spike/clock.js';
import { CaptureBuffer, uploadDue, BATCH_EVERY_MS } from '../../native/src/spike/capture.js';

export const ROLE = 'controller';

// livekit-client's RoomEvent / Track.Kind values, as strings so this module
// never imports livekit-client (which expects a window). The screen passes
// a real Room in; the event names are the library's own.
export const EVENTS = { DataReceived: 'dataReceived', TrackSubscribed: 'trackSubscribed', TrackUnsubscribed: 'trackUnsubscribed', Disconnected: 'disconnected', Reconnecting: 'reconnecting', Reconnected: 'reconnected', ConnectionStateChanged: 'connectionStateChanged' };
export const VIDEO_KIND = 'video';

const slug = (s) => String(s || 'x').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
function pick(ua, pairs) {
  for (const [name, re] of pairs) {
    const r = re.exec(ua);
    if (r) return r[1] ? `${name}-${r[1]}` : name;
  }
  return null;
}
function browserName(ua) {
  return pick(ua, [['edge', /Edg\/(\d+)/], ['firefox', /Firefox\/(\d+)/], ['chrome', /Chrome\/(\d+)/], ['safari', /Version\/(\d+)[.\d]* .*Safari/]]) || 'browser';
}
function osName(ua) {
  return pick(ua, [['windows', /Windows NT (\d+)/], ['android', /Android (\d+)/], ['ios', /OS (\d+)_\d+ like Mac/], ['mac', /Mac OS X (\d+[._]\d+)/], ['linux', /Linux/]]) || 'os';
}

/** The report's deviceId for a browser: `web-<browser>-<os>`, in the shape /api/spike/upload-url accepts. */
export function browserDeviceId(ua = '') {
  return `web-${slug(browserName(ua))}-${slug(osName(ua))}`.slice(0, 64);
}

/**
 * What stands in for the phone's B2 profile: the same top-level keys the
 * screen and the report readers look at, with deviceZoom honestly
 * unavailable (a laptop controller has no camera to zoom).
 */
export function browserProfile(ua = '', appVersion = '0.0.0') {
  const [make, makeVersion = null] = browserName(ua).split(/-(?=\d)/);
  const [os, osVersion = null] = osName(ua).split(/-(?=\d)/);
  return {
    platform: 'web', make, model: makeVersion ? `${make} ${makeVersion}` : make, os, osVersion: osVersion ? osVersion.replace(/_/g, '.') : null,
    appVersion, userAgent: ua,
    deviceZoom: { available: false, min: 1, max: 1, reason: 'web controller: no camera on this side' },
    lenses: [], maxResolution: null, maxFrameRate: null, stabilisation: null,
  };
}

/** gzip a string in the browser (CompressionStream). Tests inject node's zlib instead. */
export async function gzipText(text) {
  const CS = globalThis.CompressionStream;
  if (!CS) throw new Error('gzip is not available in this browser');
  const stream = new globalThis.Blob([text]).stream().pipeThrough(new CS('gzip'));
  return new Uint8Array(await new globalThis.Response(stream).arrayBuffer());
}

/** storage-js returns the signed upload URL absolute or /storage/v1-relative depending on version (same as native/src/spike/runtime.js). */
export function absoluteUploadUrl(signedUrl, base = '') {
  if (!signedUrl) return null;
  if (/^https?:\/\//i.test(signedUrl)) return signedUrl;
  const root = String(base).replace(/\/+$/, '');
  const suffix = signedUrl.startsWith('/') ? signedUrl : `/${signedUrl}`;
  return suffix.startsWith('/storage/v1') ? `${root}${suffix}` : `${root}/storage/v1${suffix}`;
}

const msg = (e) => String(e?.message || e);

/**
 * One Controller session in a browser. `onEvent(kind, payload)` feeds the
 * screen with the same kinds the phone screen receives. connect(), then
 * stop(); report() at any time.
 */
export class WebControllerSession {
  constructor({
    accessToken, userId = null, onEvent,
    base = '', supabaseUrl = '', appVersion = '0.0.0', userAgent = '',
    createRoom, fetchImpl, gzip = gzipText, now = () => Date.now(),
    setIntervalImpl = (fn, ms) => setInterval(fn, ms), clearIntervalImpl = (t) => clearInterval(t),
  }) {
    if (typeof createRoom !== 'function') throw new Error('createRoom is required');
    if (!accessToken) throw new Error('accessToken is required');
    this.role = ROLE; this.accessToken = accessToken; this.userId = userId; this.onEvent = onEvent || (() => {});
    this.base = base; this.supabaseUrl = supabaseUrl; this.appVersion = appVersion;
    this.createRoom = createRoom; this.fetch = fetchImpl || ((...a) => globalThis.fetch(...a)); this.gzip = gzip; this.now = now;
    this.setInterval = setIntervalImpl; this.clearInterval = clearIntervalImpl;
    this.deviceId = browserDeviceId(userAgent); this.sessionId = mintId('ses');
    this.profile = browserProfile(userAgent, appVersion);
    this.buffer = new CaptureBuffer({ deviceId: this.deviceId, sessionId: this.sessionId, now });
    this.room = null; this.connected = null; this.offset = null; this.remoteTrack = null;
    this.collect = true; this.lastUploadAt = now(); this.uploads = []; this.pending = new Map();
    this.timers = []; this.soak = null; this.latencies = []; this.reportUpload = null; this.shots = 0;
    // Stage tagging, the camera's pro capability (survey ack), acks awaited by id, the last Match cameras run (same as SpikeSession).
    this.stage = null; this.stageChanges = []; this.cameraProfile = null; this.ackWaiters = new Map(); this.match = null;
    // The show's orientation (native/src/spike/orientation.js): chosen here, applied on the camera, locked while the soak or a stage runs.
    this.orientation = DEFAULT_ORIENTATION; this.orientationInfo = null; this.orientationLog = [];
    // Slow-command diagnostics, same as SpikeSession: connection-state changes, clock steps, and every slow leg out.
    this.linkEvents = []; this.clockSteps = []; this.slowCommands = [];
    // The camera's mount as it last reported it (mountStatus): the warning follows this, and clears when it resolves.
    this.mount = null;
  }

  live() { return Boolean(this.stage || this.soak); }

  noteLink(state, detail = null) {
    this.linkEvents.push({ state, detail: detail == null ? null : String(detail), atMs: this.now(), serverMs: this.serverNow() });
    if (this.linkEvents.length > 50) this.linkEvents.shift();
    if (this.collect) this.buffer.link(state, detail == null ? null : String(detail));
    this.onEvent('link', { state, detail });
  }

  serverNow() { return this.offset ? this.now() + this.offset.offsetMs : null; }

  async api(path, { method = 'GET', body } = {}) {
    const headers = { 'content-type': 'application/json', 'x-correlation-id': mintId('web'), authorization: `Bearer ${this.accessToken}` };
    const res = await this.fetch(`${this.base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    let data = null; try { data = await res.json(); } catch { data = null; }
    return { ok: res.ok, status: res.status, data };
  }

  async connect() {
    this.buffer.profile(this.profile);
    this.onEvent('profile', this.profile);
    await this.syncClock();
    const r = await this.api('/api/spike/token', { method: 'POST', body: { role: ROLE } });
    if (!r.ok) throw new Error(r.data?.error || `token request failed (${r.status})`);
    const room = this.createRoom();
    this.room = room;
    room.on(EVENTS.DataReceived, (payload, participant, _kind, topic) => { if (topic === TOPIC) this.onData(payload, participant); });
    room.on(EVENTS.TrackSubscribed, (track, publication, participant) => { if (track.kind === VIDEO_KIND) { this.remoteTrack = { track, publication, participant }; this.onEvent('remote', this.remoteTrack); } });
    room.on(EVENTS.TrackUnsubscribed, (track) => { if (track.kind === VIDEO_KIND) { this.remoteTrack = null; this.onEvent('remote', null); } });
    room.on(EVENTS.Disconnected, (reason) => { this.noteLink('disconnected', reason); this.onEvent('disconnected', reason); });
    room.on(EVENTS.Reconnecting, () => this.noteLink('reconnecting'));
    room.on(EVENTS.Reconnected, () => this.noteLink('reconnected'));
    room.on(EVENTS.ConnectionStateChanged, (state) => { if (state !== 'connected') this.noteLink(`state:${state}`); });
    await room.connect(r.data.url, r.data.token);
    this.connected = { room: r.data.room, identity: r.data.identity };
    this.onEvent('connected', this.connected);
    this.timers.push(this.setInterval(() => this.syncClock().catch(() => {}), RESYNC_EVERY_MS));
    this.timers.push(this.setInterval(() => this.maybeUpload().catch((e) => this.onEvent('error', msg(e))), 5000));
  }

  async syncClock() {
    const o = await measureOffset({ base: this.base, fetchImpl: this.fetch, now: this.now });
    if (!o) return;
    const step = this.offset ? o.offsetMs - this.offset.offsetMs : 0;
    const stepped = Math.abs(step) > 1000;
    if (stepped) { this.clockSteps.push({ atMs: this.now(), fromMs: this.offset.offsetMs, toMs: o.offsetMs, stepMs: step }); if (this.clockSteps.length > 20) this.clockSteps.shift(); this.onEvent('clockStep', { stepMs: step }); }
    this.offset = o; this.buffer.setOffset(o);
    if (this.collect) this.buffer.clock(o, stepped ? { step_ms: step } : {});
    this.onEvent('clock', o);
  }

  /**
   * Choose the show's orientation (same as SpikeSession.setOrientation):
   * locked while the soak or a stage runs, otherwise sent to the camera
   * and resolved with its answer, which carries the camera's mount check.
   */
  async setOrientation(o) {
    const want = normaliseOrientation(o);
    if (this.live()) {
      const r = { ok: false, orientation: this.orientation, requested: want, refused: true, reason: `orientation is locked while ${this.soak ? 'the soak' : `stage ${this.stage}`} is running: set it before going live` };
      this.onEvent('orientation', r); return r;
    }
    const a = await this.sendAndWait(orientationCommand({ orientation: want, decidedAt: this.serverNow() ?? this.now() }));
    const res = a?.result ?? null;
    const ok = Boolean(res && !res.refused && !res.failed);
    const r = { ok, orientation: ok ? want : this.orientation, requested: want, refused: Boolean(res?.refused), reason: a ? (ok ? null : res?.reason || 'the camera did not apply it') : 'no ack from the camera', camera: res };
    if (ok) { this.orientation = want; this.orientationInfo = res; this.orientationLog.push({ orientation: want, atMs: this.now(), serverMs: this.serverNow(), from: res?.from ?? null, physical: res?.physical ?? null, mismatch: Boolean(res?.mismatch) }); }
    this.onEvent('orientation', r);
    return r;
  }

  // ── controller side: identical to SpikeSession.send / zoom / pan ──
  async send(command) {
    if (!this.room) throw new Error('not connected');
    command.sentAt = this.serverNow() ?? this.now();
    command.decidedAt = command.decidedAt ?? command.sentAt;
    const sentLocal = this.now(); const offsetAtSend = this.offset?.offsetMs ?? null;
    this.pending.set(command.id, { command, sentLocal, offsetAtSend });
    if (this.collect) this.buffer.intent(command.decisionId, { type: command.type, target: command.target ?? null, direction: command.direction ?? null, degree: command.degree ?? null, window: command.window ?? null, duration_ms: command.durationMs, easing: command.easing, source: command.source, tightness: command.target ? tightnessFor(command.target) : null, orientation_requested: command.orientation ?? null, sent_local_ms: sentLocal, offset_at_send_ms: offsetAtSend });
    await this.room.localParticipant.publishData(encode(command), { reliable: true, topic: TOPIC });
    this.onEvent('sent', command);
    return command;
  }
  zoom(target, durationMs = 2000, easing = 'ease-in-out') { return this.send(zoomCommand({ target, durationMs, easing, decidedAt: this.serverNow() ?? this.now() })); }

  // ── pro mode: mirrors SpikeSession.pro / requestSurvey / sendAndWait / matchCameras / setStage ──
  pro(control, value = null) { return this.send(proCommand({ control, value, decidedAt: this.serverNow() ?? this.now() })); }
  async requestSurvey() {
    const ack = await this.sendAndWait(surveyRequest({ decidedAt: this.serverNow() ?? this.now() }));
    if (ack?.result?.profile) { this.cameraProfile = ack.result.profile; this.onEvent('cameraProfile', this.cameraProfile); }
    return ack;
  }
  async sendAndWait(command, timeoutMs = 8000) {
    const p = new Promise((resolve) => {
      const t = setTimeout(() => { this.ackWaiters.delete(command.id); resolve(null); }, timeoutMs);
      this.ackWaiters.set(command.id, (ackMsg) => { clearTimeout(t); resolve(ackMsg); });
    });
    await this.send(command);
    return p;
  }
  async matchCameras() {
    const read = await this.sendAndWait(matchCommand({ phase: 'read', decidedAt: this.serverNow() ?? this.now() }));
    if (!read?.result?.targets) { const r = { ok: false, reason: read ? (read.result?.reason || 'the reference camera did not report its values') : 'no ack from the reference camera', targets: null, results: [] }; this.match = r; this.onEvent('match', r); return r; }
    const targets = read.result.targets;
    const applied = await this.sendAndWait(matchCommand({ phase: 'apply', targets, reference: read.result.from ?? null, decidedAt: this.serverNow() ?? this.now() }));
    const results = applied ? [{ from: applied.result?.from ?? null, achieved: applied.result?.achieved ?? null, residual: applied.result?.residual ?? null, reasons: applied.result?.reasons ?? [] }] : [];
    const r = { ok: Boolean(applied), reason: applied ? null : 'no ack to the apply phase', reference: read.result.from ?? null, targets, results, at: this.serverNow() ?? this.now(), stage: this.stage };
    this.match = r; this.onEvent('match', r);
    return r;
  }
  /** Tag everything from now on with the stage and tell the camera. */
  setStage(stage) {
    const st = STAGES.includes(stage) ? stage : null;
    this.stage = st; this.buffer.setStage(st);
    this.stageChanges.push({ stage: st, atMs: this.now(), serverMs: this.serverNow() });
    this.onEvent('stage', st);
    return this.room ? this.send(stageCommand({ stage: st, decidedAt: this.serverNow() ?? this.now() })) : Promise.resolve(null);
  }
  pan(direction, { degree = PAN_DEFAULTS.degree, window = PAN_DEFAULTS.window, durationMs = PAN_DEFAULTS.durationMs, easing = PAN_DEFAULTS.easing } = {}) { return this.send(panCommand({ direction, degree, window, durationMs, easing, decidedAt: this.serverNow() ?? this.now() })); }
  bop(direction, { bpm = BOP_DEFAULTS.bpm, durationMs = BOP_DEFAULTS.durationMs, strength = BOP_DEFAULTS.strength } = {}) { return this.send(bopCommand({ direction, bpm, durationMs, strength, decidedAt: this.serverNow() ?? this.now() })); }

  /** 20-minute soak: a move every 30 s, alternating zoom in, zoom out, pan (same sequence as the phone). */
  startSoak(minutes = 20) {
    this.stopSoak();
    const started = this.now(); let i = 0;
    const tick = () => {
      if (this.now() - started > minutes * 60000) { this.stopSoak(); this.onEvent('soak', { done: true, moves: i }); return; }
      // Pans only on the zoomed framing (zoomPlan MIN_PAN_ZOOM): zoom in, pan left, pan right, zoom out.
      const k = i % 4; i += 1;
      const p = k === 0 ? this.zoom(2, 2000) : k === 1 ? this.pan('left', { durationMs: 3000 }) : k === 2 ? this.pan('right', { durationMs: 3000 }) : this.zoom(1, 2000);
      p.catch((e) => this.onEvent('error', msg(e)));
      this.onEvent('soak', { done: false, moves: i, minutes: +((this.now() - started) / 60000).toFixed(1) });
    };
    tick();
    this.soak = this.setInterval(tick, 30000);
  }
  stopSoak() { if (this.soak) { this.clearInterval(this.soak); this.soak = null; } }

  /** Only acks reach a controller; anything else on the topic is for the camera. */
  onData(payload, participant) {
    let m; try { m = decode(payload); } catch { return; }
    if (m.type === 'mount') { this.mount = { ...m }; this.onEvent('mount', this.mount); return; }
    if (m.type !== 'ack') return;
    const arrived = this.now();
    const p = this.pending.get(m.id);
    if (!p) return;
    this.pending.delete(m.id);
    // moveCycleMs is the whole cycle (send, the 2-3 s move, the ack back);
    // commandLatencyMs and ackLegMs are the network legs alone, from the
    // ack's server-clock timestamps (same as the phone Controller).
    const lat = { ...ackLatencies(m, { sentLocal: p.sentLocal, arrivedLocal: arrived, arrivedServer: this.serverNow() }), stage: this.stage, type: m.forType };
    this.latencies.push(lat); if (this.latencies.length > 200) this.latencies.shift();
    if (m.result && typeof m.result === 'object') m.result.from = m.result.from ?? participant?.identity ?? null;
    const waiter = this.ackWaiters.get(m.id); if (waiter) { this.ackWaiters.delete(m.id); waiter(m); }
    const slow = slowCommandDiagnosis(lat, p, m.diag);
    if (slow) { this.slowCommands.push({ ...slow, type: m.forType, decisionId: m.decisionId, atMs: arrived, stage: this.stage }); if (this.slowCommands.length > 20) this.slowCommands.shift(); this.onEvent('slowCommand', { ...slow, type: m.forType }); }
    if (this.collect) this.buffer.result(m.decisionId, { ...m.result, timestamps: m.timestamps, move_cycle_ms: lat.moveCycleMs, command_latency_ms: lat.commandLatencyMs, ack_leg_ms: lat.ackLegMs, from: participant?.identity || null, sent_local_ms: p.sentLocal, offset_at_send_ms: p.offsetAtSend, camera_diag: m.diag ?? null, slow_command: slow });
    if (m.result && !m.result.refused && !m.result.failed && ['zoom', 'pan'].includes(m.forType)) this.shots += 1;
    this.onEvent('ack', { ack: m, ...lat, command: p.command, slow });
  }

  // ── Part C: the controller's own intent/result records, batched like the phone's ──
  async maybeUpload(forced = false) {
    const due = uploadDue({ now: this.now(), lastUploadAt: this.lastUploadAt, moving: false, enabled: this.collect || forced, buffered: this.buffer.records.length, forced });
    if (!due) return null;
    const batch = this.buffer.drain();
    if (!batch) return null;
    const t0 = this.now();
    let rec;
    try {
      const gz = await this.gzip(batch.text);
      const minted = await this.api('/api/spike/upload-url', { method: 'POST', body: { name: `${batch.name}.gz`, deviceId: this.deviceId } });
      if (!minted.ok) {
        rec = { name: batch.name, ok: false, error: minted.data?.error || minted.status, records: batch.records };
      } else {
        const url = absoluteUploadUrl(minted.data.signedUrl, this.supabaseUrl);
        const res = await this.fetch(url, { method: 'PUT', headers: { 'content-type': 'application/gzip', 'x-upsert': 'false' }, body: gz });
        rec = { name: batch.name, ok: res.ok, status: res.status, records: batch.records, rawBytes: batch.bytes, gzBytes: gz.byteLength, ms: this.now() - t0, path: minted.data.path, dropped: batch.dropped };
      }
    } catch (e) {
      rec = { name: batch.name, ok: false, error: msg(e), records: batch.records };
    }
    this.uploads.push(rec); if (rec.ok) this.lastUploadAt = this.now();
    this.onEvent('upload', rec);
    return rec;
  }

  storageSummary() {
    const ok = this.uploads.filter((u) => u.ok);
    const gz = ok.reduce((s, u) => s + (u.gzBytes || 0), 0); const raw = ok.reduce((s, u) => s + (u.rawBytes || 0), 0); const recs = ok.reduce((s, u) => s + (u.records || 0), 0);
    const minutes = ok.length ? Math.max(1, ok.length * (BATCH_EVERY_MS / 60000)) : 0;
    return { batches: ok.length, failed: this.uploads.length - ok.length, records: recs, rawBytes: raw, gzBytes: gz, gzBytesPerHour: minutes ? Math.round((gz / minutes) * 60) : null, rawBytesPerHour: minutes ? Math.round((raw / minutes) * 60) : null, ratio: gz ? +(raw / gz).toFixed(1) : null };
  }

  /** The three latencies over the session, each as n/p50/p90/max (commands.summariseLatencies), overall and per stage. */
  latencySummary() {
    const all = summariseLatencies(this.latencies);
    if (!all) return null;
    const byStage = {};
    for (const st of STAGES) { const xs = this.latencies.filter((l) => l.stage === st); if (xs.length) byStage[st] = summariseLatencies(xs); }
    const pro = this.latencies.filter((l) => l.type === 'pro' || l.type === 'match');
    return { ...all, byStage, proCommands: pro.length ? summariseLatencies(pro) : null };
  }

  /** A browser has no CPU, thermal or battery counters to read; the shape stays the phone's. */
  costSummary() { return { on: null, off: null, samples: 0 }; }

  /** Same keys, same order, as SpikeSession.report() on the phone. */
  report() {
    return {
      role: this.role, deviceId: this.deviceId, sessionId: this.sessionId, appVersion: this.appVersion,
      stage: this.stage, stageChanges: this.stageChanges, frameSource: null,
      profile: this.profile, cameraProfile: this.cameraProfile, clock: this.offset, latency: this.latencySummary(), shots: this.shots,
      pro: null, match: this.match,
      orientation: { chosen: this.orientation, camera: this.orientationInfo, mount: this.orientationInfo ? { physical: this.orientationInfo.physical ?? null, mismatch: Boolean(this.orientationInfo.mismatch), warning: this.orientationInfo.warning ?? null, fix: this.orientationInfo.fix ?? null } : null, log: this.orientationLog.slice(-20), panPath: null, regionProbe: null },
      slowCommands: this.slowCommands.slice(-20), link: this.linkEvents.slice(-20), stalls: [], clockSteps: this.clockSteps.slice(-20),
      cost: this.costSummary(), storage: this.storageSummary(), uploads: this.uploads.slice(-20), lastState: null, writtenAt: new Date(this.now()).toISOString(), reportUpload: this.reportUpload,
    };
  }
  reportFileName() { return `spike-report-${this.role}-${this.deviceId}-${this.now()}.json`; }

  /** Same as the phone: the report JSON also goes to the director-spike bucket through the signed-URL route. Never throws. */
  async uploadReport(name = this.reportFileName(), report = this.report()) {
    let rec;
    try {
      const minted = await this.api('/api/spike/upload-url', { method: 'POST', body: { name, deviceId: this.deviceId } });
      if (!minted.ok) rec = { name, ok: false, error: minted.data?.error || minted.status };
      else {
        const body = JSON.stringify(report, null, 2);
        const res = await this.fetch(absoluteUploadUrl(minted.data.signedUrl, this.supabaseUrl), { method: 'PUT', headers: { 'content-type': 'application/json', 'x-upsert': 'false' }, body });
        rec = { name, ok: res.ok, status: res.status, bytes: body.length, path: minted.data.path };
      }
    } catch (e) { rec = { name, ok: false, error: msg(e) }; }
    this.reportUpload = rec;
    this.onEvent('reportUpload', rec);
    return rec;
  }

  async stop() {
    this.stopSoak();
    for (const t of this.timers) this.clearInterval(t);
    this.timers = [];
    try { await this.maybeUpload(true); } catch { /* best effort */ }
    try { await this.room?.disconnect(); } catch { /* closing */ }
    this.room = null; this.remoteTrack = null;
  }
}
