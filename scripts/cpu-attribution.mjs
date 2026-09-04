#!/usr/bin/env node
/* eslint-disable no-console */

// scripts/cpu-attribution.mjs
// ─────────────────────────────────────────────────────────────
// Reads a capture and attributes encoder CPU pressure to one of the two
// surviving hypotheses, or reports that it cannot.
//
//   node scripts/cpu-attribution.mjs <capture.csv>
//
// PRD: Director Experience / Live Show    S&I: Observability
//
// ── THE TWO SURVIVORS ─────────────────────────────────────────
//   (a) THE rAF/WAVEFORM LOOP in BackingTrackPanel — writes
//       style.width and a text label every frame regardless of change,
//       across a 360-point waveform, with no play-state gate.
//   (b) THE DECODED AudioBuffer — ~106MB for a five-minute stereo
//       track, resident for the session.
//
// Bandwidth is already ruled out. Fetch and decode are ruled out on
// timing: cpu appeared 91 seconds AFTER the work finished.
//
// ── WHAT THIS SCRIPT WILL AND WILL NOT CLAIM ──────────────────
// It reports correlations and states which hypothesis each one supports.
// It does NOT declare a winner from correlation alone, because in every
// segment of the planned session BOTH survivors are present at once —
// a loaded deck has a resident buffer AND a running loop, so anything
// that rises with time rises with both.
//
// The only thing that separates them is a period where ONE is present
// and the other is not. `deck_loop_suspended` rows mark exactly that,
// and if the capture contains them this script does the A/B directly.
// If it does not, the script says so rather than guessing.
// ─────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/cpu-attribution.mjs <capture.csv>');
  process.exit(2);
}

// ── CSV parsing: quoted fields, doubled quotes, embedded commas ──
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift();
  return rows.filter((r) => r.length > 1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

const rows = parseCsv(readFileSync(file, 'utf8'));
const t = (r) => new Date(r.client_ts || r.created_at).getTime();
const num = (v) => (v === '' || v == null ? null : Number(v));
const extra = (r) => { try { return r.extra ? JSON.parse(r.extra) : {}; } catch { return {}; } };

rows.sort((a, b) => t(a) - t(b));
const first = rows.length ? t(rows[0]) : 0;
const rel = (r) => ((t(r) - first) / 1000).toFixed(1).padStart(7);

const pub = rows.filter((r) => r.event_type === 'pub_stats');
const raf = rows.filter((r) => r.event_type === 'backing_deck_raf');
const loads = rows.filter((r) => r.event_type === 'backing_deck_loaded');
const suspends = rows.filter((r) => r.event_type === 'deck_loop_suspended');

console.log(`\ncapture: ${file}`);
console.log(`rows ${rows.length} · pub_stats ${pub.length} · backing_deck_raf ${raf.length} · loads ${loads.length}\n`);

if (!pub.length) {
  console.log('NO pub_stats ROWS. The publisher instrument was off for this capture');
  console.log('(lib/publisherStats.js, FREEZE_INSTRUMENTATION_ENABLED). Nothing here');
  console.log('can be attributed — this is a harness failure, not a null result.\n');
  process.exit(1);
}

// ── CPU PRESSURE, AS THE ENCODER REPORTS IT ───────────────────
// Two independent signals, deliberately kept separate:
//   qualityLimitationReason === 'cpu'  — the flag, per sample
//   qualityLimitationDurations.cpu     — cumulative SECONDS cpu-limited
// The flag can flicker; the duration cannot go down. Trusting only one
// of them is how a brief spike gets read as a trend or vice versa.
function cpuSeconds(r) {
  const e = extra(r);
  const d = e.qualityLimitationDurations ?? r.qualityLimitationDurations;
  if (d && typeof d === 'object' && d.cpu != null) return Number(d.cpu);
  return null;
}

let prevCpu = null;
const samples = pub.map((r) => {
  const cpu = cpuSeconds(r);
  const delta = prevCpu != null && cpu != null && cpu >= prevCpu ? cpu - prevCpu : null;
  if (cpu != null) prevCpu = cpu;
  return {
    at: t(r), rel: rel(r),
    cpuFlag: (r.qualityLimitationReason || extra(r).qualityLimitationReason || '') === 'cpu',
    cpuDelta: delta,
    fps: num(r.fps), sourceFps: num(r.sourceFps), avgQp: num(r.avgQp),
    encoded: num(r.framesEncodedDelta), sent: num(r.framesSentDelta),
  };
});

const anyCpu = samples.some((s) => s.cpuFlag || (s.cpuDelta ?? 0) > 0.05);

// ── SEGMENTS ──────────────────────────────────────────────────
// A segment starts at each backing_deck_loaded and runs to the next
// load or the end. `source` distinguishes local / uploaded / rehydrate.
const segs = loads.map((r, i) => ({
  source: extra(r).source || 'unknown',
  durationSec: extra(r).durationSec ?? null,
  bufferMB: extra(r).approxBufferBytes ? (extra(r).approxBufferBytes / 1048576).toFixed(0) : null,
  from: t(r),
  to: i + 1 < loads.length ? t(loads[i + 1]) : Infinity,
}));

// Everything before the first load: no buffer, no waveform. The control.
const baseline = { source: 'BASELINE (no track loaded)', from: first, to: loads.length ? t(loads[0]) : Infinity };

function within(list, from, to) { return list.filter((x) => x.at >= from && x.at < to); }
function rafWithin(from, to) {
  return raf.filter((r) => t(r) >= from && t(r) < to).map((r) => ({ ...extra(r), at: t(r) }));
}
function summarise(label, from, to) {
  const s = within(samples, from, to);
  if (!s.length) return null;
  const rf = rafWithin(from, to);
  const active = rf.reduce((n, x) => n + (x.activeFrames || 0), 0);
  const idle = rf.reduce((n, x) => n + (x.idleFrames || 0), 0);
  const changed = rf.reduce((n, x) => n + (x.changedWidth || 0), 0);
  const playing = rf.reduce((n, x) => n + (x.playingFrames || 0), 0);
  const cpuTotal = s.reduce((n, x) => n + (x.cpuDelta || 0), 0);
  const cpuFlagged = s.filter((x) => x.cpuFlag).length;
  const fpsVals = s.map((x) => x.fps).filter((v) => v != null);
  return {
    label, samples: s.length,
    lengthSec: ((Math.min(to, s[s.length - 1].at + 2000) - from) / 1000).toFixed(0),
    cpuSecondsAccrued: cpuTotal.toFixed(2),
    cpuFlaggedSamples: `${cpuFlagged}/${s.length}`,
    activeFrames: active, idleFrames: idle, changedWidth: changed, playingFrames: playing,
    // The waveform loop's own waste: frames drawn that changed nothing.
    wastedWrites: active - changed,
    medianFps: fpsVals.length ? fpsVals.sort((a, b) => a - b)[Math.floor(fpsVals.length / 2)] : null,
  };
}

const table = [summarise(baseline.source, baseline.from, baseline.to)]
  .concat(segs.map((sg, i) => summarise(
    `SEGMENT ${i + 1}: ${sg.source}${sg.bufferMB ? ` (~${sg.bufferMB}MB buffer)` : ''}`, sg.from, sg.to)))
  .filter(Boolean);

console.log('── PER SEGMENT ───────────────────────────────────────────────');
for (const s of table) {
  console.log(`\n${s.label}`);
  console.log(`  length ${s.lengthSec}s · ${s.samples} samples`);
  console.log(`  CPU seconds accrued : ${s.cpuSecondsAccrued}   (flagged ${s.cpuFlaggedSamples} samples)`);
  console.log(`  rAF activeFrames    : ${s.activeFrames}   idle ${s.idleFrames}   playing ${s.playingFrames}`);
  console.log(`  waveform writes     : ${s.changedWidth} changed, ${s.wastedWrites} wasted`);
  console.log(`  median fps          : ${s.medianFps ?? 'n/a'}`);
}

// ── HYPOTHESIS (a): CPU TRACKS THE LOOP ───────────────────────
// Correlate per-report activeFrames against the cpu accrued in the same
// window. If the loop is the cause, more loop = more cpu.
function correlate(pairs) {
  const n = pairs.length;
  if (n < 4) return null;
  const mx = pairs.reduce((a, p) => a + p[0], 0) / n;
  const my = pairs.reduce((a, p) => a + p[1], 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (const [x, y] of pairs) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; syy += (y - my) ** 2; }
  if (!sxx || !syy) return null;
  return sxy / Math.sqrt(sxx * syy);
}

const loopPairs = [];
for (const r of raf) {
  const e = extra(r);
  const at = t(r);
  const win = samples.filter((s) => s.at > at - (e.elapsedMs || 30000) && s.at <= at);
  const cpu = win.reduce((n, s) => n + (s.cpuDelta || 0), 0);
  if (e.activeFrames != null) loopPairs.push([e.activeFrames, cpu]);
}
const rLoop = correlate(loopPairs);

// ── HYPOTHESIS (b): CPU TRACKS TIME SINCE DECODE ──────────────
// With activeFrames flat, cpu that keeps climbing with residency points
// at the buffer instead.
const timePairs = [];
for (const sg of segs) {
  for (const s of within(samples, sg.from, sg.to)) {
    if (s.cpuDelta != null) timePairs.push([(s.at - sg.from) / 1000, s.cpuDelta]);
  }
}
const rTime = correlate(timePairs);

console.log('\n── CORRELATIONS ──────────────────────────────────────────────');
console.log(`  (a) cpu vs activeFrames        r = ${rLoop == null ? 'n/a' : rLoop.toFixed(3)}   (${loopPairs.length} points)`);
console.log(`  (b) cpu vs time-since-decode   r = ${rTime == null ? 'n/a' : rTime.toFixed(3)}   (${timePairs.length} points)`);

// ── THE ONLY THING THAT ACTUALLY SEPARATES THEM ───────────────
if (suspends.length) {
  console.log('\n── A/B: LOOP SUSPENDED WITH THE BUFFER STILL RESIDENT ────────');
  let on = 0, onCpu = 0, off = 0, offCpu = 0;
  let state = 'on', mark = first;
  const flip = (to, at) => {
    const cpu = within(samples, mark, at).reduce((n, s) => n + (s.cpuDelta || 0), 0);
    const dur = (at - mark) / 1000;
    if (state === 'on') { on += dur; onCpu += cpu; } else { off += dur; offCpu += cpu; }
    state = to; mark = at;
  };
  for (const r of suspends) flip(extra(r).suspended ? 'off' : 'on', t(r));
  flip(state, samples[samples.length - 1].at);
  const onRate = on ? onCpu / on : 0, offRate = off ? offCpu / off : 0;
  console.log(`  loop RUNNING   : ${on.toFixed(0)}s, ${onCpu.toFixed(2)}s cpu  (${(onRate * 100).toFixed(1)}% of wall)`);
  console.log(`  loop SUSPENDED : ${off.toFixed(0)}s, ${offCpu.toFixed(2)}s cpu  (${(offRate * 100).toFixed(1)}% of wall)`);
  console.log(`\n  VERDICT: ${
    offRate < onRate * 0.4 ? 'THE LOOP. CPU largely disappears when it is suspended.'
    : offRate > onRate * 0.7 ? 'NOT THE LOOP. CPU persists with the loop off and the buffer resident.'
    : 'INCONCLUSIVE — the difference is not large enough to attribute.'}`);
} else {
  console.log('\n── NO A/B DATA ───────────────────────────────────────────────');
  console.log('  No deck_loop_suspended rows in this capture.');
  console.log('');
  console.log('  Both survivors are present in EVERY loaded segment: a loaded deck');
  console.log('  has a resident buffer AND a running loop. So anything that rises');
  console.log('  with time rises with both, and the correlations above CANNOT');
  console.log('  separate them however strong they look.');
  console.log('');
  console.log('  What they can still do: rule the pair IN or OUT against the');
  console.log('  baseline segment, which has neither.');
}

// ── THE NULL RESULT, NAMED ────────────────────────────────────
console.log('\n── READING ───────────────────────────────────────────────────');
if (!anyCpu) {
  console.log('  NULL RESULT: no cpu pressure anywhere in this capture.');
  console.log('');
  console.log('  qualityLimitationReason never reached "cpu" and the cumulative');
  console.log('  cpu duration never moved. That does not clear either hypothesis —');
  console.log('  it means the CONDITION did not occur, so there was nothing to');
  console.log('  attribute. A capture with no symptom cannot name a cause.');
  console.log('');
  console.log('  Check before concluding anything:');
  console.log(`    · were segments long enough?   longest here: ${Math.max(...table.map((s) => Number(s.lengthSec)))}s`);
  console.log(`    · did the waveform actually run? activeFrames total: ${table.reduce((n, s) => n + s.activeFrames, 0)}`);
  console.log(`    · was the encoder under load?   median fps: ${table.map((s) => s.medianFps).join(', ')}`);
} else {
  const baselineRow = table[0];
  console.log(`  CPU pressure IS present (${samples.filter((s) => s.cpuFlag).length} flagged samples).`);
  if (baselineRow && Number(baselineRow.cpuSecondsAccrued) > 0.5) {
    console.log('  ⚠️  It is ALSO present in the baseline, before any track was loaded.');
    console.log('      Neither survivor can explain pressure that predates them both.');
    console.log('      Attribution should move to what else runs in that window.');
  } else {
    console.log('  The baseline is clean, so the pressure arrives WITH a loaded deck.');
    console.log('  That narrows it to the pair — and only the A/B above can split them.');
  }
}
console.log('');
