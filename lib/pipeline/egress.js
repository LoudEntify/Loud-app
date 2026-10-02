// lib/pipeline/egress.js
// ─────────────────────────────────────────────────────────────
// The egress: one composed output per show that (1) goes out over RTMP to
// YouTube (both channels in Versus), (2) is recorded, and (3) is kept as
// the training copy — all from the same output, so a recording cannot go
// missing because a second process failed (PRD row 140).
//
// Interface:
//   start({ showId, layout, targets:[{broadcastId, ingestUrl, streamKey}], recordingPath, trainingPath })
//   pushFrame({ tMs, layout })      the compositor's output for this instant
//   health()                        { delivering:{[broadcastId]:'ok'|'noData'}, framesOut, recordingBytes }
//   retarget(broadcastId, target)   after a new broadcast is created mid-show
//   stop()                          { recording:{path,frames,durationMs}, training:{path}, framesOut }
//
// FakeEgress writes NDJSON "frames" (the layout spec per instant) to local
// files and simulates RTMP delivery with injectable failures. It is the
// test double for CI and for staging until LiveKit credentials exist.
// LiveKitEgress is the seat for the real thing (LiveKit room composite
// egress with RTMP + file outputs) and refuses to start without credentials.
//
// Stream keys pass through here in memory only; they are never logged and
// never appear in the written files (the fake writes the broadcast id).
// ─────────────────────────────────────────────────────────────
import fs from 'node:fs';
import path from 'node:path';

export class FakeEgress {
  constructor({ rootDir = path.join(process.cwd(), '.cache', 'egress'), now = () => Date.now() } = {}) {
    this.rootDir = rootDir; this.now = now; this.state = 'idle'; this.targets = new Map(); this.framesOut = 0; this.failures = new Set();
    this.recording = null; this.training = null;
  }
  /** 'rtmp_drop:<broadcastId>' drops delivery for that target; 'disk_full' fails the recording write. */
  fail(mode, on = true) { if (on) this.failures.add(mode); else this.failures.delete(mode); return this; }
  async start({ showId, targets = [], trainingAllowed = true }) {
    const dir = path.join(this.rootDir, showId);
    fs.mkdirSync(dir, { recursive: true });
    this.showId = showId;
    this.recording = { path: path.join(dir, 'recording.ndjson'), frames: 0, startedAt: this.now() };
    this.training = trainingAllowed ? { path: path.join(dir, 'training.ndjson'), frames: 0 } : null;
    fs.writeFileSync(this.recording.path, '');
    if (this.training) fs.writeFileSync(this.training.path, '');
    for (const t of targets) this.retarget(t.broadcastId, t);
    this.state = 'running';
    return { ok: true, recordingPath: this.recording.path, trainingPath: this.training?.path || null };
  }
  retarget(broadcastId, { ingestUrl, streamKey }) {
    if (!streamKey) throw new Error('egress target needs a stream key');
    // the key stays in memory; the file only ever sees the broadcast id
    this.targets.set(broadcastId, { ingestUrl, hasKey: Boolean(streamKey), framesSent: 0, path: path.join(this.rootDir, this.showId, `youtube-${broadcastId}.ndjson`) });
    fs.writeFileSync(this.targets.get(broadcastId).path, '');
  }
  dropTarget(broadcastId) { this.targets.delete(broadcastId); }
  pushFrame({ tMs, layout }) {
    if (this.state !== 'running') throw new Error('egress not running');
    const line = JSON.stringify({ t: tMs, view: layout.view, layers: layout.layers.map((l) => ({ slot: l.slot, role: l.role, rect: l.rect })) }) + '\n';
    if (this.failures.has('disk_full')) throw new Error('recording write failed: disk full');
    fs.appendFileSync(this.recording.path, line); this.recording.frames += 1;
    if (this.training) { fs.appendFileSync(this.training.path, line); this.training.frames += 1; }
    for (const [id, t] of this.targets) {
      if (this.failures.has(`rtmp_drop:${id}`) || this.failures.has('rtmp_drop')) continue;
      fs.appendFileSync(t.path, line); t.framesSent += 1;
    }
    this.framesOut += 1;
    return { framesOut: this.framesOut };
  }
  health() {
    const delivering = {};
    for (const [id] of this.targets) delivering[id] = (this.failures.has(`rtmp_drop:${id}`) || this.failures.has('rtmp_drop')) ? 'noData' : 'ok';
    return { state: this.state, delivering, framesOut: this.framesOut, recordingFrames: this.recording?.frames || 0 };
  }
  async stop() {
    this.state = 'stopped';
    const durationMs = this.now() - (this.recording?.startedAt || this.now());
    return { recording: { path: this.recording.path, frames: this.recording.frames, durationMs, sizeBytes: fs.statSync(this.recording.path).size }, training: this.training ? { path: this.training.path, frames: this.training.frames } : null, framesOut: this.framesOut };
  }
}

export class LiveKitEgress {
  constructor({ apiKey = process.env.LIVEKIT_API_KEY, apiSecret = process.env.LIVEKIT_API_SECRET, url = process.env.LIVEKIT_URL } = {}) { this.configured = Boolean(apiKey && apiSecret && url); }
  async start() { if (!this.configured) throw new Error('LiveKit egress is not configured (LIVEKIT_API_KEY/SECRET/URL). See docs/NEEDS_KOREY.md.'); throw new Error('LiveKitEgress: room composite with RTMP + file outputs is wired in app/api/egress/start today; the unified start lands with credentials.'); }
  pushFrame() { /* the real egress pulls from the room; nothing to push */ }
  health() { return { state: this.configured ? 'unknown' : 'unconfigured', delivering: {}, framesOut: 0 }; }
  retarget() { throw new Error('LiveKitEgress.retarget needs credentials'); }
  async stop() { throw new Error('LiveKitEgress not configured'); }
}

export function createEgress() {
  return process.env.LIVEKIT_API_KEY && process.env.EGRESS_MODE === 'livekit' ? new LiveKitEgress() : new FakeEgress();
}
