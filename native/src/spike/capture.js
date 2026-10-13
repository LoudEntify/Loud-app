// native/src/spike/capture.js — Part C: buffer director data on the device
// and hand it off in batches. Platform-free: the native side supplies the
// writer (gzip to a file) and the uploader (signed URL PUT); this module
// decides WHAT is in a batch and WHEN it goes, and it never does either
// while a camera move is in progress (collection must not compete with
// the video).
//
// Streams carried (docs/DIRECTOR_DATA_SPEC.md): B2 capability profile
// (once), B4 camera state (on change + every 500 ms), B5 decisions
// (intent and result as two records sharing decision_id), B12 clock
// offsets, plus the cost counters the spike itself measures.
//
// PRD rows 165, 166. S&I: Background jobs, Observability.

export const SCHEMA_VERSION = 1;
export const MAX_BUFFER_RECORDS = 20_000;   // ~ 2.7 hours of 500 ms state samples; oldest dropped beyond this
export const BATCH_EVERY_MS = 60_000;
export const STATE_SAMPLE_MS = 500;

export class CaptureBuffer {
  constructor({ deviceId, showId = null, sessionId, now = () => Date.now(), offset = null }) {
    this.deviceId = deviceId; this.showId = showId; this.sessionId = sessionId; this.now = now; this.offset = offset;
    this.records = []; this.dropped = 0; this.lastState = null; this.seq = 0; this.enabled = true;
  }
  setOffset(offset) { this.offset = offset; }
  stamp(deviceMs = this.now()) { return { t_device_ms: deviceMs, t_server_ms: this.offset ? deviceMs + this.offset.offsetMs : null, clock_error_ms: this.offset ? this.offset.errorBoundMs : null }; }
  push(stream, body) {
    if (!this.enabled) return null;
    const rec = { schema_version: SCHEMA_VERSION, stream, seq: (this.seq += 1), device_id: this.deviceId, show_id: this.showId, session_id: this.sessionId, ...this.stamp(), ...body };
    this.records.push(rec);
    if (this.records.length > MAX_BUFFER_RECORDS) { this.records.shift(); this.dropped += 1; }
    return rec;
  }
  profile(profile) { return this.push('B2', { profile }); }
  /** Camera state: writes only on change, or when STATE_SAMPLE_MS has passed. */
  state(state, { force = false } = {}) {
    const t = this.now();
    const changed = !this.lastState || JSON.stringify(state) !== this.lastState.json;
    const due = !this.lastState || t - this.lastState.t >= STATE_SAMPLE_MS;
    if (!changed && !due && !force) return null;
    this.lastState = { json: JSON.stringify(state), t };
    return this.push('B4', { state, reason: changed ? 'change' : 'sample' });
  }
  intent(decisionId, intent) { return this.push('B5', { kind: 'intent', decision_id: decisionId, ...intent }); }
  /** The native result carries its own `kind` (zoom | pan); the record's kind is 'result', so the result's goes to `move_kind`. */
  result(decisionId, result) { const { kind: moveKind, ...rest } = result || {}; return this.push('B5', { ...rest, kind: 'result', move_kind: moveKind ?? rest.move_kind ?? null, decision_id: decisionId }); }
  clock(offset) { return this.push('B12', { offset_ms: offset.offsetMs, error_bound_ms: offset.errorBoundMs, rtt_ms: offset.rttMs, samples: offset.samples }); }
  cost(counters) { return this.push('COST', counters); }
  /** Take everything buffered so far as one batch (NDJSON text), leaving the buffer empty. */
  drain() {
    if (!this.records.length) return null;
    const records = this.records; this.records = [];
    const text = records.map((r) => JSON.stringify(r)).join('\n') + '\n';
    const name = `${this.deviceId}-${this.sessionId}-${records[0].seq}-${records[records.length - 1].seq}.ndjson`;
    return { name, text, records: records.length, bytes: text.length, dropped: this.dropped, firstSeq: records[0].seq, lastSeq: records[records.length - 1].seq };
  }
}

/**
 * Decides when a batch may go. A move in progress blocks the upload; so
 * does "collection off". `since` is the last successful upload time.
 */
export function uploadDue({ now, lastUploadAt, moving, enabled, buffered, forced = false }) {
  if (!enabled || moving) return false;
  if (forced && buffered > 0) return true;
  return buffered > 0 && now - lastUploadAt >= BATCH_EVERY_MS;
}

/** Object key inside the bucket: one folder per artist, one per device, time-ordered names. */
export function objectPath({ userId, deviceId, batchName, startedAt }) {
  const day = new Date(startedAt).toISOString().slice(0, 10);
  return `${userId}/${day}/${deviceId}/${batchName}.gz`;
}
