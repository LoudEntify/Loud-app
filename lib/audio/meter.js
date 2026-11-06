// lib/audio/meter.js
// ─────────────────────────────────────────────────────────────
// What a level MEANS. Shared, because a meter that reads "good" on a
// laptop and "too quiet" on a phone for the same voice is worse than no
// meter: the artist would trust whichever one they saw last.
//
// Korey, 5 Nov: "There is no audio signal indicator." The number now
// exists on both platforms — the browser reads it off an AnalyserNode,
// the phone off LoudVocalChain's per-frame peak — and this module turns
// either of them into the same verdict.
//
// ── WHY dB AND NOT THE RAW NUMBER ─────────────────────────────
// Both platforms hand over an amplitude on the 0..1 sample scale, where
// half the scale is a sixth of the way up a meter, because loudness is
// logarithmic. Drawing the raw number would put a healthy singing voice
// at a tenth of the bar and make everyone turn themselves up until they
// clipped.
//
// ── WHAT THE BANDS ARE FOR ────────────────────────────────────
// A meter an artist looks at thirty seconds before a show has to answer
// one question: is this right? So each band carries the line to show and
// the action that fixes it, and "good" carries no action, because the
// answer is yes.
//
// Imports nothing, names no platform. Same rule as chain.js and dsp.js.
// ─────────────────────────────────────────────────────────────

/** The bottom of the meter. Below this a phone microphone is hearing room noise, not a person. */
export const FLOOR_DB = -60;
export const CEILING_DB = 0;

/** Amplitude (0..1 on the sample scale) to dBFS. Silence is -Infinity, which every caller clamps. */
export function levelDb(amplitude) {
  const a = Math.abs(Number(amplitude));
  if (!Number.isFinite(a) || a <= 0) return -Infinity;
  return 20 * Math.log10(Math.min(1, a));
}

/** Where on a 0..1 bar a dB value sits, floor to ceiling. */
export function meterFraction(db) {
  if (!Number.isFinite(db)) return 0;
  const clamped = Math.min(CEILING_DB, Math.max(FLOOR_DB, db));
  return (clamped - FLOOR_DB) / (CEILING_DB - FLOOR_DB);
}

/**
 * The bands, loudest first so the first match wins.
 *
 * The numbers are where a voice sits rather than where a standard says
 * it should: -12 dBFS peak is a comfortable singing level with headroom
 * for the loudest word in a song, which is the one that clips. Below
 * -40 a phone at arm's length is not hearing the person at all.
 */
export const LEVEL_BANDS = Object.freeze([
  { key: 'clipping', from: -1, line: 'Too loud — this will distort.', action: 'Move back, or lower Input' },
  { key: 'hot', from: -6, line: 'Very hot. The loudest word may distort.', action: 'Lower Input a little' },
  { key: 'good', from: -24, line: 'Good level.', action: null },
  { key: 'quiet', from: -40, line: 'Quiet. You will be hard to hear.', action: 'Move closer, or raise Input' },
  { key: 'silent', from: -Infinity, line: 'No signal from the microphone.', action: 'Say a few words' },
]);

/**
 * The verdict for a meter reading.
 *
 * Judged on PEAK, not average: an artist clips on their loudest
 * syllable, and an average that looks healthy hides it. `rms` is
 * returned for the bar to follow, because a bar that jumps to every
 * peak is unreadable.
 */
export function describeLevel({ peak = 0, rms = 0 } = {}) {
  const peakDb = levelDb(peak);
  const rmsDb = levelDb(rms);
  const band = LEVEL_BANDS.find((b) => peakDb >= b.from) || LEVEL_BANDS[LEVEL_BANDS.length - 1];
  return {
    band: band.key,
    line: band.line,
    action: band.action,
    ok: band.key === 'good',
    peakDb,
    rmsDb,
    // What to draw: the bar follows the average, the notch marks the peak.
    fraction: meterFraction(rmsDb),
    peakFraction: meterFraction(peakDb),
  };
}

/** The most gain reduction worth drawing. Past this the compressor is doing something nobody asked it to. */
export const REDUCTION_CEILING_DB = 12;

/**
 * How much of the compressor's own bar to fill, and whether to say
 * anything about it.
 *
 * Gain reduction is the only honest way to show that compression is
 * working: a threshold and a ratio tell an artist nothing about their
 * own voice, and "working" here means a few dB on the loud words and
 * nothing in between.
 */
export function describeReduction(reductionDb) {
  const db = Math.max(0, Number(reductionDb) || 0);
  return {
    db,
    fraction: Math.min(1, db / REDUCTION_CEILING_DB),
    working: db >= 0.5,
    line: db < 0.5 ? 'Not compressing yet.'
      : db <= REDUCTION_CEILING_DB ? `Holding back ${db.toFixed(1)} dB.`
      : `Holding back ${db.toFixed(1)} dB — more than a voice usually needs.`,
  };
}

/**
 * How often to read the meter.
 *
 * The native loop runs at 100 frames a second and holds its peak until
 * read, so a slower poll loses nothing: it reports the loudest frame
 * since last time rather than whichever one it landed on. Ten times a
 * second looks continuous to a person and costs one bridge call.
 */
export const METER_POLL_MS = 100;
