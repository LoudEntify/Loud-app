'use client';

// lib/interruptionProbe.js
// ─────────────────────────────────────────────────────────────
// The recorder behind /probe/interruption. Round-3 groundwork for the
// interruption spec — an INSTRUMENT, not a feature. Nothing in the show
// path imports this.
//
// PRD: Director Experience / Live Show (interruption handling)
// S&I: Observability
//
// ── WHY IT DOES NOT WRITE TO health_events ────────────────────
// Everything else in this codebase logs through lib/healthLog.js, and
// that is right for anything happening inside a show. This is the one
// case where it would be wrong, for three reasons:
//
//   1. health_events is keyed to a show_id, and this probe deliberately
//      has no show. Inventing one to satisfy a column would put probe
//      rows in the same table a device sitting reads.
//   2. The thing being measured is a device that has had its JavaScript
//      SUSPENDED. A network flush is the first casualty of exactly that
//      condition, so the transport would be failing for the same reason
//      as the subject. Evidence has to survive locally or it is not
//      evidence.
//   3. Airplane mode, a dead signal at a venue, or a phone that drops to
//      2G must not cost a run. A probe you can only use with a network
//      is a probe you cannot use in the room the show is in.
//
// So: append-only in memory, mirrored to localStorage, exported as a CSV
// the operator downloads. Same shape as the CSVs already being read
// (client_ts first, event_type second), so it lands in a familiar
// reading habit rather than a new one.
//
// ── THE PERSISTENCE RULE ──────────────────────────────────────
// Written to localStorage on a 1s throttle AND synchronously whenever the
// page is about to lose control of its own execution (hidden, pagehide,
// freeze). The throttle is what keeps a 2Hz heartbeat from doing a
// storage write per tick; the synchronous flush is what means an OS that
// discards the tab keeps everything up to the last transition rather than
// up to the last second.
// ─────────────────────────────────────────────────────────────

const STORAGE_KEY = 'loudentify.probe.interruption';

// Bounded so a probe left running overnight cannot fill the origin's
// storage quota and start throwing. 20 minutes of 2Hz heartbeat is ~2400
// rows; this is an order of magnitude of headroom above a real run.
const MAX_ROWS = 20000;

// Columns, fixed and ordered. A fixed header is what lets two runs be
// diffed against each other without a spreadsheet argument about which
// column is which.
export const PROBE_COLUMNS = [
  'client_ts',        // wall clock, ISO — the axis a person reads
  'monotonic_ms',     // performance.now() — immune to a clock the OS adjusts
  'event_type',
  'step',             // which scripted interruption was in progress
  'visibility',
  'audio_ctx_state',  // running | suspended | interrupted (WebKit) | closed
  'audio_ctx_time_s', // AudioContext.currentTime — see the note in the page
  'audio_track',      // muted/readyState/enabled, compacted
  'video_track',
  'video_frames',     // cumulative frames delivered to the element
  'rms',
  'wake_lock',
  'gap_ms',           // wall-clock gap since the previous heartbeat
  'detail',
];

let rows = [];
let lastPersistAt = 0;
let persistTimer = null;

function nowIso() {
  return new Date().toISOString();
}

/**
 * Record one row. Never throws: an instrument that can break the page it
 * is measuring produces evidence about itself instead of the subject.
 */
export function probeRecord(eventType, fields = {}) {
  try {
    rows.push({
      client_ts: nowIso(),
      monotonic_ms: Math.round(performance.now()),
      event_type: eventType,
      step: fields.step ?? '',
      visibility: fields.visibility ?? (typeof document !== 'undefined' ? document.visibilityState : ''),
      audio_ctx_state: fields.audioCtxState ?? '',
      audio_ctx_time_s: fields.audioCtxTime ?? '',
      audio_track: fields.audioTrack ?? '',
      video_track: fields.videoTrack ?? '',
      video_frames: fields.videoFrames ?? '',
      rms: fields.rms ?? '',
      wake_lock: fields.wakeLock ?? '',
      gap_ms: fields.gapMs ?? '',
      detail: typeof fields.detail === 'string' ? fields.detail : fields.detail ? JSON.stringify(fields.detail) : '',
    });
    if (rows.length > MAX_ROWS) rows.splice(0, rows.length - MAX_ROWS);
    schedulePersist();
  } catch {
    /* an instrument must not throw into its subject */
  }
}

function schedulePersist() {
  const now = Date.now();
  if (now - lastPersistAt >= 1000) { persistNow(); return; }
  if (persistTimer) return;
  persistTimer = setTimeout(() => { persistTimer = null; persistNow(); }, 1000);
}

/**
 * Write through immediately. Called on every transition that might be
 * this page's last instruction for a while — hidden, pagehide, freeze.
 * Synchronous on purpose: localStorage is, and that is the whole reason
 * it is the store here rather than anything asynchronous.
 */
export function probePersist() {
  persistNow();
}

function persistNow() {
  lastPersistAt = Date.now();
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
  } catch {
    // Quota, or private browsing. The in-memory log is still complete
    // for as long as the tab lives; probe_storage_unavailable is
    // recorded once by the page so a run is never silently half-kept.
  }
}

/** Reload a previous run — the point of persisting at all. */
export function probeRestore() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return 0;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return 0;
    rows = parsed;
    return rows.length;
  } catch {
    return 0;
  }
}

export function probeRows() {
  return rows;
}

export function probeClear() {
  rows = [];
  try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* nothing to clear */ }
}

export function probeStorageUsable() {
  try {
    const k = `${STORAGE_KEY}.probe`;
    window.localStorage.setItem(k, '1');
    window.localStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function probeCsv() {
  const head = PROBE_COLUMNS.join(',');
  const body = rows.map((r) => PROBE_COLUMNS.map((c) => csvCell(r[c])).join(',')).join('\n');
  return `${head}\n${body}\n`;
}

/**
 * A one-screen summary of what the run showed, computed from the rows
 * rather than remembered by the UI.
 *
 * ── THE TWO MEASUREMENTS THAT SURVIVE A SUSPENDED PAGE ────────
 * This is the part that makes the probe work at all, and it is worth
 * stating plainly because it is unintuitive: while the OS has frozen
 * this page's JavaScript, NOTHING here runs. No listener fires, no
 * sample is taken, and the absence of rows proves only that the page was
 * not running — never what the hardware was doing.
 *
 * Two counters answer that anyway, because they are maintained outside
 * the JavaScript that was frozen and can be READ AFTERWARDS:
 *
 *   AUDIO — AudioContext.currentTime advances only while the audio
 *   thread is actually running. Compare its advance across the gap with
 *   the wall-clock advance. Equal means audio kept flowing while the page
 *   was away. Near-zero means the audio session was suspended or
 *   interrupted, whatever the page was told when it came back.
 *
 *   VIDEO — the element's cumulative delivered-frame count. Divide its
 *   advance across the gap by the wall-clock advance to get the frame
 *   rate the camera actually sustained while nobody was watching.
 *
 * Both are ratios of things measured on the same two rows, so neither
 * depends on a timer having fired in between — which is the only reason
 * a frozen page can report on its own freeze.
 */
export function probeSummary() {
  const gaps = [];
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1];
    const cur = rows[i];
    const wallMs = new Date(cur.client_ts).getTime() - new Date(prev.client_ts).getTime();
    // 1.5s against a 500ms heartbeat: three missed ticks, comfortably
    // past ordinary jitter and well under the shortest interruption
    // anyone can physically perform.
    if (wallMs < 1500) continue;

    const audioAdvance = (Number(cur.audio_ctx_time_s) - Number(prev.audio_ctx_time_s)) * 1000;
    const frameAdvance = Number(cur.video_frames) - Number(prev.video_frames);
    gaps.push({
      step: cur.step || prev.step || '',
      atIso: prev.client_ts,
      wallMs,
      // 1.0 = the audio clock kept perfect pace with the wall clock.
      audioRatio: Number.isFinite(audioAdvance) ? Math.max(0, audioAdvance) / wallMs : null,
      // Frames per second sustained across the gap.
      videoFps: Number.isFinite(frameAdvance) ? Math.max(0, frameAdvance) / (wallMs / 1000) : null,
      resumedAudioCtxState: cur.audio_ctx_state,
      resumedAudioTrack: cur.audio_track,
      resumedVideoTrack: cur.video_track,
    });
  }
  return {
    rowCount: rows.length,
    firstTs: rows[0]?.client_ts ?? null,
    lastTs: rows[rows.length - 1]?.client_ts ?? null,
    gaps,
  };
}

/**
 * VERDICT LANGUAGE, kept here rather than in the UI so a reading of the
 * data cannot differ between the screen and the file.
 *
 * Deliberately describes CAPABILITY, never cause. "Audio survived" is a
 * measurement; "this was a phone call" is a guess, and the whole reason
 * this probe exists is that the platform does not tell us which
 * interruption occurred (see docs/INTERRUPTION_FEASIBILITY.md).
 */
export function describeGap(gap) {
  if (!gap) return '';
  const audio = gap.audioRatio === null ? 'audio unknown'
    : gap.audioRatio > 0.9 ? 'AUDIO SURVIVED'
    : gap.audioRatio < 0.1 ? 'audio stopped'
    : `audio partial (${Math.round(gap.audioRatio * 100)}%)`;
  const video = gap.videoFps === null ? 'video unknown'
    : gap.videoFps > 5 ? `VIDEO SURVIVED (${gap.videoFps.toFixed(1)}fps)`
    : gap.videoFps < 0.5 ? 'video stopped'
    : `video crawled (${gap.videoFps.toFixed(1)}fps)`;
  // A page that kept running is a different finding from one that was
  // frozen, and the gap length is the only thing that says which.
  return `${(gap.wallMs / 1000).toFixed(1)}s away — ${audio}, ${video}`;
}
