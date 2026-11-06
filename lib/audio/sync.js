// lib/audio/sync.js
// ─────────────────────────────────────────────────────────────
// Headphone delay: the numbers, the rejection rules and the verdict.
//
// Korey, 5 Nov: "The Blue tooth earphone calibrator is not built." It is
// built — on the web, in lib/audioSyncCalibration.js, and it has been
// performed through. What was not built was any way for the phone to run
// it, and the reason is the same one as the vocal chain: the measurement
// is Web Audio (an AudioContext scheduling clicks, an AnalyserNode
// hearing the reply) and React Native has none of that.
//
// ── WHAT IS BEING MEASURED ────────────────────────────────────
// Not "the Bluetooth latency" as a spec sheet would give it. The artist's
// real monitoring round trip: a click leaves for their ears, they answer
// it out loud, and their voice comes back through the microphone. That
// whole loop is what makes a performer sing behind the track, and it is
// one measurement for everyone — on wired gear it comes back near zero,
// on Bluetooth it comes back as the real delay, with no separate code
// path per device type.
//
// ── WHY THE SPLIT IS HERE ─────────────────────────────────────
// Exactly where it is for the chain. Playing a click and timing a vocal
// onset is platform work: Web Audio in a browser, Kotlin on a phone.
// Deciding whether twelve measurements can be trusted, and what to do
// about them, is arithmetic — so it lives here, is tested here, and both
// platforms reach the same verdict from the same numbers.
//
// This module therefore OWNS the constants and the rejection rules;
// lib/audioSyncCalibration.js (the web measurement) re-exports them
// rather than keeping its own, because two copies of a rejection
// threshold is how one platform comes to accept a measurement the other
// would have thrown away.
//
// ── HONEST EXPECTATIONS, KEPT FROM THE PILOT ──────────────────
// This removes roughly 70-90% of the delay and leaves a 20-40ms floor it
// physically cannot beat: human timing error, the fuzziness of where a
// sung syllable begins, and Bluetooth's own drift. Success is "most
// listeners will not consciously notice", not perfect sync.
//
// Imports nothing, names no platform.
// ─────────────────────────────────────────────────────────────

// ── The click train ─────────────────────────────────────────────
export const REP_COUNT = 12;              // clicks played
export const DISCARD_COUNT = 2;           // the first N, while the artist finds the tempo
export const CLICK_INTERVAL_S = 0.6;      // 100 BPM: comfortable to answer
export const CLICK_DURATION_S = 0.005;    // a 5ms burst
export const CLICK_FREQUENCY_HZ = 4000;   // clear of vowel energy, so the click is not mistaken for the voice
export const LEAD_IN_S = 0.3;             // before the first click, to absorb scheduling overhead

export const TOTAL_COUNTED = REP_COUNT - DISCARD_COUNT;

// ── Rejection ───────────────────────────────────────────────────
// A bad measurement applied is worse than none: over- or
// under-compensating puts the artist further out than leaving it alone.
// Both of these are hard gates, and failing either applies nothing.
export const MAD_REJECT_MS = 40;          // spread this wide and the median cannot be trusted
export const MIN_VALID_ONSETS = 6;        // out of TOTAL_COUNTED
export const MAX_COMPENSATION_MS = 500;   // realistic Bluetooth codec latency: SBC can run 150-250ms+

/** Above this, the honest advice is to wire the earphones in rather than compensate. */
export const LARGE_DELAY_WARNING_MS = 150;

/** The middle value. Not the mean: one missed onset would drag an average and cannot drag a median. */
export function median(values) {
  const sorted = [...values].filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * How much the measurements disagree with each other, measured the same
 * robust way as the middle itself.
 *
 * This is the number that decides whether the artist was actually
 * answering the clicks. Twelve taps spread over 80ms is someone guessing;
 * twelve within 10ms is a real measurement.
 */
export function medianAbsoluteDeviation(values, med = median(values)) {
  if (med == null) return null;
  return median(values.map((v) => Math.abs(v - med)));
}

/**
 * The verdict on one run.
 *
 * `offsetsMs` is every rep in order, with null where no onset was heard.
 * The first DISCARD_COUNT are dropped here rather than by the caller, so
 * a platform cannot forget to drop them and report a measurement
 * polluted by the artist finding the tempo.
 *
 * Returns the same shape whether accepted or not, because the screen
 * shows the same things either way: what was measured, how much it
 * disagreed, and what to do next.
 */
export function summariseCalibration(offsetsMs = [], { cancelled = false } = {}) {
  const counted = offsetsMs.slice(DISCARD_COUNT);
  const valid = counted.filter((o) => Number.isFinite(o));
  const base = { rawOffsetsMs: counted, validCount: valid.length, totalCounted: TOTAL_COUNTED };

  if (cancelled) return { ...base, accepted: false, reason: 'cancelled', compensationMs: null, medianMs: null, madMs: null };

  if (valid.length < MIN_VALID_ONSETS) {
    return { ...base, accepted: false, reason: 'too_few_onsets', compensationMs: null, medianMs: null, madMs: null };
  }

  const med = median(valid);
  const mad = medianAbsoluteDeviation(valid, med);

  if (mad > MAD_REJECT_MS) {
    return { ...base, accepted: false, reason: 'too_noisy', compensationMs: null, medianMs: med, madMs: mad };
  }

  return {
    ...base,
    accepted: true,
    reason: null,
    medianMs: med,
    madMs: mad,
    compensationMs: Math.max(0, Math.min(MAX_COMPENSATION_MS, med)),
  };
}

/**
 * What to tell the artist, in their words rather than the measurement's.
 *
 * Every outcome ends in a result or an action — the same rule the Kit
 * Check bands follow — because a person wearing earphones in a venue
 * needs to know whether to press Apply or go and find a cable.
 */
export function describeCalibration(result) {
  if (!result) return { line: 'Not measured yet.', action: 'Start the check', wired: false };

  if (!result.accepted) {
    switch (result.reason) {
      case 'cancelled':
        return { line: 'Stopped before it finished.', action: 'Start again', wired: false };
      case 'too_few_onsets':
        return {
          line: `Only heard ${result.validCount} of ${result.totalCounted} answers.`,
          action: 'Answer each click out loud, closer to the microphone',
          wired: false,
        };
      default:
        return {
          line: 'Your answers were too far apart to trust.',
          action: 'Try again, answering right on each click',
          wired: false,
        };
    }
  }

  const ms = Math.round(result.compensationMs);

  // Above the warning line, compensation is still applied but it is not
  // the honest recommendation: half a second of delay cannot be sung
  // through, however well it is corrected.
  if (ms >= LARGE_DELAY_WARNING_MS) {
    return {
      line: `Your earphones are ${ms} ms behind.`,
      action: 'Wire them in if you can — this is too much to sing through comfortably',
      wired: true,
      applied: ms,
    };
  }

  if (ms <= 20) {
    return { line: `Almost no delay (${ms} ms). Nothing to correct.`, action: null, wired: false, applied: ms };
  }

  return {
    line: `Corrected ${ms} ms of delay.`,
    action: null,
    wired: false,
    applied: ms,
    // The floor this cannot beat, stated rather than implied, because an
    // artist who expects perfection will keep re-running it.
    note: 'A little drift is left over; that is the limit of the measurement rather than a fault.',
  };
}
