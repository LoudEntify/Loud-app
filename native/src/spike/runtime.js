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
import { Paths, File } from 'expo-file-system';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { api } from '../api';
import { API_BASE } from '../config';
import * as LoudCamera from '../../modules/loud-camera';
import { TOPIC, zoomCommand, panCommand, ack, encode, decode, roundTripMs, mintId } from './commands';
import { chooseZoomMode, rampSchedule, panPlan, tightnessFor } from './zoomPlan';
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
  constructor({ role, accessToken, userId, onEvent }) {
    this.role = role; this.accessToken = accessToken; this.userId = userId; this.onEvent = onEvent || (() => {});
    this.room = null; this.profile = null; this.offset = null; this.track = null; this.stream = null;
    this.deviceId = deviceId(); this.sessionId = mintId('ses');
    this.buffer = new CaptureBuffer({ deviceId: this.deviceId, sessionId: this.sessionId });
    this.collect = true; this.lastUploadAt = Date.now(); this.uploads = []; this.pending = new Map();
    this.timers = []; this.stateSub = null; this.lastState = null; this.lastCost = null; this.costSamples = [];
    this.moving = false; this.soak = null; this.remoteTrack = null; this.rtts = [];
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
    const { stream } = await LoudCamera.start({ facing: 'back', width: 1080, height: 1920, fps: 30 });
    this.stream = stream;
    const mediaTrack = stream.getVideoTracks()[0];
    const track = new LocalVideoTrack(mediaTrack, undefined, true);
    this.track = track;
    const pub = await this.room.localParticipant.publishTrack(track, {
      source: Track.Source.Camera, simulcast: false, videoEncoding: { maxBitrate: 3_000_000, maxFramerate: 30 },
    });
    this.onEvent('published', { trackSid: pub.trackSid });
    this.stateSub = LoudCamera.addStateListener((s) => {
      this.lastState = s;
      if (this.collect) this.buffer.state({ ...s, offset: undefined });
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
    const sample = { ...c, atMs: Date.now(), collect: this.collect, moving: this.moving };
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
    return { on: summarise(groups.on), off: summarise(groups.off), samples: this.costSamples.length };
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
  pan(direction, { degree = 0.5, window = 0.85, durationMs = 3000, easing = 'ease-in-out' } = {}) { return this.send(panCommand({ direction, degree, window, durationMs, easing, decidedAt: this.serverNow() ?? Date.now() })); }

  /** 20-minute soak: a move every 30 s, alternating zoom in, zoom out, pan. */
  startSoak(minutes = 20) {
    this.stopSoak();
    const started = Date.now(); let i = 0;
    const tick = () => {
      if (Date.now() - started > minutes * 60000) { this.stopSoak(); this.onEvent('soak', { done: true, moves: i }); return; }
      const k = i % 4; i += 1;
      const p = k === 0 ? this.zoom(2, 2000) : k === 1 ? this.pan(i % 8 < 4 ? 'left' : 'right', { durationMs: 3000 }) : k === 2 ? this.zoom(1, 2000) : this.pan('up', { degree: 0.3, durationMs: 2500 });
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
        const rtt = roundTripMs(p.sentLocal, arrived);
        this.rtts.push(rtt); if (this.rtts.length > 200) this.rtts.shift();
        if (this.collect) this.buffer.result(m.decisionId, { ...m.result, timestamps: m.timestamps, rtt_ms: rtt, from: participant?.identity || null });
        this.onEvent('ack', { ack: m, rtt, command: p.command });
      }
      return;
    }
    if (this.role === 'camera' && (m.type === 'zoom' || m.type === 'pan')) this.execute(m).catch((e) => this.onEvent('error', String(e?.message || e)));
  }

  async execute(m) {
    const receivedAt = this.serverNow() ?? Date.now();
    this.onEvent('command', m);
    if (this.collect) this.buffer.intent(m.decisionId, { type: m.type, target: m.target ?? null, direction: m.direction ?? null, degree: m.degree ?? null, window: m.window ?? null, duration_ms: m.durationMs, easing: m.easing, source: m.source, received_from: 'data-channel' });
    this.moving = true;
    const startedAt = this.serverNow() ?? Date.now();
    let result;
    try {
      const st = this.lastState || LoudCamera.getState() || {};
      if (m.type === 'zoom') {
        const choice = chooseZoomMode(this.profile, m.target);
        const from = choice.mode === 'device' ? Math.max(st.deviceZoom || 1, this.profile.deviceZoom.min || 1) : Math.max(st.digitalFactor || 1, 1);
        if (choice.mode === 'digital' && st.crop && st.crop.w < 0.999) await LoudCamera.resetFraming();
        const steps = rampSchedule({ from, to: choice.target, durationMs: m.durationMs, easing: m.easing });
        const r = await LoudCamera.zoomTo(steps, choice.mode, m.target);
        result = { ...r, mode: choice.mode, clamped: r.clamped || choice.clamped, reason: r.reason || choice.reason };
      } else {
        const zoomNow = Math.max(st.deviceZoom || 1, 1);
        const plan = panPlan({ direction: m.direction, degree: m.degree, window: m.window, durationMs: m.durationMs, easing: m.easing, zoomNow });
        const deviceAvailable = this.profile?.deviceZoom?.available && plan.deviceZoom >= (this.profile.deviceZoom.min || 1);
        const r = await LoudCamera.pan(deviceAvailable ? plan.deviceZoom : null, plan.path, plan.digitalFactor);
        result = { ...r, mode: deviceAvailable ? 'device+crop' : 'crop', window: plan.window, digitalFactor: plan.digitalFactor };
      }
    } catch (e) {
      result = { mode: 'none', requested: m.target ?? null, achieved: null, clamped: false, reason: String(e?.message || e), droppedFrames: 0, actualDurationMs: 0 };
    }
    this.moving = false;
    const completedAt = this.serverNow() ?? Date.now();
    const reply = ack({ command: m, receivedAt, startedAt, completedAt, result });
    if (this.collect) this.buffer.result(m.decisionId, { ...result, timestamps: reply.timestamps });
    await this.room.localParticipant.publishData(encode(reply), { reliable: true, topic: TOPIC });
    this.onEvent('result', { command: m, result, reply });
    return result;
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

  rttSummary() {
    if (!this.rtts.length) return null;
    const s = [...this.rtts].sort((a, b) => a - b);
    const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
    return { n: s.length, p50: q(0.5), p90: q(0.9), max: s[s.length - 1] };
  }

  /** Everything the report needs, as one JSON object; the screen also writes it to a file. */
  report() {
    return { role: this.role, deviceId: this.deviceId, sessionId: this.sessionId, appVersion: APP_VERSION, profile: this.profile, clock: this.offset, rtt: this.rttSummary(), cost: this.costSummary(), storage: this.storageSummary(), uploads: this.uploads.slice(-20), lastState: this.lastState, writtenAt: new Date().toISOString() };
  }
  async writeReport() {
    const file = new File(Paths.document, `spike-report-${this.role}-${this.deviceId}-${Date.now()}.json`);
    file.write(JSON.stringify(this.report(), null, 2));
    return file.uri;
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

/** storage-js returns the signed upload URL absolute or /storage/v1-relative depending on version. */
export function absoluteUploadUrl(signedUrl, base = process.env.EXPO_PUBLIC_SUPABASE_URL || Constants.expoConfig?.extra?.supabaseUrl || '') {
  if (!signedUrl) return null;
  if (/^https?:\/\//i.test(signedUrl)) return signedUrl;
  const root = String(base).replace(/\/+$/, '');
  const suffix = signedUrl.startsWith('/') ? signedUrl : `/${signedUrl}`;
  return suffix.startsWith('/storage/v1') ? `${root}${suffix}` : `${root}/storage/v1${suffix}`;
}
