// Tap-delay latency correction -- measures the artist's real monitoring
// round-trip (output to their ears + their vocal's return through the
// mic) by playing a click train through their actual monitor path and
// listening for a vocalized "Bah" on each beat. One method for everyone:
// on wired gear the measured round-trip is near-zero, on Bluetooth it's
// the full real delay -- there's no separate detection path per device
// type, the measurement just naturally reflects whichever route is live.
//
// HONEST EXPECTATIONS: this removes ~70-90% of the delay, leaving a
// ~20-40ms residual floor (human timing error + vocal-onset fuzziness +
// Bluetooth drift) it physically cannot beat. Success is "most listeners
// won't consciously notice", not perfect sync.
//
// All tunable gate thresholds are named constants below -- nothing
// downstream should hardcode a magic number that belongs here.

// The click train, the rejection rules and the verdict now live in
// lib/audio/sync.js, so the phone's measurement reaches the same
// conclusions from the same numbers. Two copies of a rejection
// threshold is how one platform comes to accept a measurement the other
// would have thrown away -- the mistake the vocal chain made first.
//
// Re-exported under the old names so nothing that imports this module
// has to change.
import {
  REP_COUNT, DISCARD_COUNT, CLICK_INTERVAL_S, CLICK_DURATION_S,
  CLICK_FREQUENCY_HZ, LEAD_IN_S, MAD_REJECT_MS, MIN_VALID_ONSETS,
  LARGE_DELAY_WARNING_MS, summariseCalibration,
} from './audio/sync.js';

export const CALIBRATION_REP_COUNT = REP_COUNT;
export const CALIBRATION_DISCARD_COUNT = DISCARD_COUNT;
export const CALIBRATION_CLICK_INTERVAL_S = CLICK_INTERVAL_S;
export const CALIBRATION_CLICK_DURATION_S = CLICK_DURATION_S;
export const CALIBRATION_CLICK_FREQUENCY_HZ = CLICK_FREQUENCY_HZ;
export const CALIBRATION_LEAD_IN_S = LEAD_IN_S;

// --- Onset detection gates ------------------------------------------------
// "Bah" onsets ramp over ~20-40ms and then sustain for the length of the
// syllable; the click (and any acoustic/electrical bleed of it into a
// shared Bluetooth-earbud mic) is a ~5ms impulsive spike that decays
// almost immediately. These gates lean on that physical difference.
export const ONSET_LOW_BAND_HZ = [150, 1500]; // where vowel energy concentrates
export const ONSET_HIGH_BAND_HZ = [3000, 5000]; // matches the click's own band
export const ONSET_LOW_HIGH_RATIO_MIN = 1.5; // low-band energy must exceed high-band by this factor to count as voice
export const ONSET_SUSTAIN_MS = 40; // must stay above threshold continuously this long to confirm (rejects click-leak spikes)
export const ONSET_NOISE_FLOOR_MARGIN_DB = 14; // trigger threshold = adaptive floor + this many dB
export const ONSET_MIN_ABSOLUTE_RMS = 0.02; // floor for the trigger threshold itself, so a dead-silent room doesn't get hypersensitive
export const ONSET_NOISE_FLOOR_EMA_ALPHA = 0.05; // adaptive floor smoothing (per analysed frame, ~60/s)
export const ONSET_BLANKING_MS = 18; // ignore window right after each click's scheduled start, first-pass reject of pure leakage
export const ONSET_ANALYSER_FFT_SIZE = 2048; // ~42.6ms time-domain window at 48kHz; also frequency-domain resolution for the band gate

// --- Rejection -------------------------------------------------------------
// A bad measurement applied is worse than none -- over/under-compensating
// makes sync worse than leaving it alone. Both thresholds below are hard
// gates: if either fails, nothing is applied.
export const CALIBRATION_MAD_REJECT_MS = MAD_REJECT_MS;
export const CALIBRATION_MIN_VALID_ONSETS = MIN_VALID_ONSETS;

// --- Published-mix guidance --------------------------------------------
export const SYNC_LARGE_DELAY_WARNING_MS = LARGE_DELAY_WARNING_MS;

function dbToLinear(db) {
  return Math.pow(10, db / 20);
}

function bandEnergy(freqData, sampleRate, fftSize, [loHz, hiHz]) {
  const binHz = sampleRate / fftSize;
  const startBin = Math.max(0, Math.round(loHz / binHz));
  const endBin = Math.min(freqData.length - 1, Math.round(hiHz / binHz));
  let sum = 0;
  for (let i = startBin; i <= endBin; i++) sum += freqData[i];
  return sum / Math.max(1, endBin - startBin + 1);
}

function rms(timeData) {
  let sumSq = 0;
  for (let i = 0; i < timeData.length; i++) sumSq += timeData[i] * timeData[i];
  return Math.sqrt(sumSq / timeData.length);
}

// Scans a time-domain buffer for the first rising threshold-crossing and
// converts its position in the buffer into an absolute audioContext time.
// This is what gives onset timestamps sub-frame precision even though the
// calling loop only polls once per animation frame (~16ms) -- the
// precision comes from the buffer's sample contents, not the poll rate.
function findRisingCrossing(timeData, threshold, sampleRate, bufferEndTime) {
  for (let i = 1; i < timeData.length; i++) {
    if (Math.abs(timeData[i]) >= threshold && Math.abs(timeData[i - 1]) < threshold) {
      return bufferEndTime - (timeData.length - 1 - i) / sampleRate;
    }
  }
  return null;
}

function nextAnimationFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

async function waitUntil(audioContext, targetTime) {
  while (audioContext.currentTime < targetTime) {
    await nextAnimationFrame();
  }
}

// Self-contained subgraph -- connects ONLY to audioContext.destination
// (the artist's own monitor). There is no edge anywhere from this
// generator to outputBus/vocalBus/destination (the MediaStreamDestination
// that becomes processedTrack), so the click is structurally unreachable
// from the published mix, not just gated by a runtime flag.
function createClickGenerator(audioContext) {
  const clickGain = audioContext.createGain();
  clickGain.gain.value = 0.9;
  clickGain.connect(audioContext.destination);

  function scheduleClick(atTime) {
    const osc = audioContext.createOscillator();
    osc.frequency.value = CALIBRATION_CLICK_FREQUENCY_HZ;
    const envelope = audioContext.createGain();
    const end = atTime + CALIBRATION_CLICK_DURATION_S;
    envelope.gain.setValueAtTime(0, atTime);
    envelope.gain.linearRampToValueAtTime(1, atTime + 0.001);
    envelope.gain.setValueAtTime(1, Math.max(atTime + 0.001, end - 0.001));
    envelope.gain.linearRampToValueAtTime(0, end);
    osc.connect(envelope);
    envelope.connect(clickGain);
    osc.start(atTime);
    osc.stop(end + 0.002);
  }

  function disconnect() {
    clickGain.disconnect();
  }

  return { scheduleClick, disconnect };
}

// Runs one calibration pass: schedules the click train, listens on
// `inputGain` (the same pre-effects mic tap the rest of the vocal chain
// reads from) for a confirmed "Bah" onset per rep, and returns a
// controller with a cancellable `promise`.
//
// `onRepComplete(repIndex, offsetMs)` fires after each rep (including the
// discarded sync-in reps) for progress UI -- offsetMs is null if no onset
// was confirmed for that rep.
export function runSyncCalibration(audioContext, inputGain, { onRepComplete } = {}) {
  let cancelled = false;

  const analyser = audioContext.createAnalyser();
  analyser.fftSize = ONSET_ANALYSER_FFT_SIZE;
  analyser.smoothingTimeConstant = 0; // raw per-frame frequency data, no cross-frame blur, for a clean sustain gate
  inputGain.connect(analyser); // additional tap, same pattern as inputAnalyser in audioProcessing.js -- doesn't touch the existing signal path

  const clickGenerator = createClickGenerator(audioContext);

  const timeData = new Float32Array(analyser.fftSize);
  const freqData = new Uint8Array(analyser.frequencyBinCount);

  const promise = (async () => {
    try {
      if (audioContext.state !== 'running') {
        await audioContext.resume();
      }

      const startTime = audioContext.currentTime + CALIBRATION_LEAD_IN_S;
      const clickTimes = [];
      for (let i = 0; i < CALIBRATION_REP_COUNT; i++) {
        const t = startTime + i * CALIBRATION_CLICK_INTERVAL_S;
        clickGenerator.scheduleClick(t);
        clickTimes.push(t);
      }

      let noiseFloorRms = ONSET_MIN_ABSOLUTE_RMS;
      const offsetsMs = new Array(CALIBRATION_REP_COUNT).fill(null);

      for (let rep = 0; rep < CALIBRATION_REP_COUNT; rep++) {
        if (cancelled) break;
        const repStart = clickTimes[rep];
        const repEnd = repStart + CALIBRATION_CLICK_INTERVAL_S;

        await waitUntil(audioContext, repStart);

        let state = 'idle'; // idle -> pending -> confirmed
        let pendingOnsetTime = null;

        while (!cancelled && audioContext.currentTime < repEnd) {
          analyser.getFloatTimeDomainData(timeData);
          analyser.getByteFrequencyData(freqData);
          const now = audioContext.currentTime;
          const withinBlanking = now - repStart < ONSET_BLANKING_MS / 1000;
          const frameRms = rms(timeData);

          if (!withinBlanking) {
            if (state === 'idle') {
              // Only adapt the floor from quiet frames -- an active
              // candidate window shouldn't pollute the ambient estimate.
              noiseFloorRms += (frameRms - noiseFloorRms) * ONSET_NOISE_FLOOR_EMA_ALPHA;
              const threshold = Math.max(ONSET_MIN_ABSOLUTE_RMS, noiseFloorRms * dbToLinear(ONSET_NOISE_FLOOR_MARGIN_DB));

              if (frameRms >= threshold) {
                const crossing = findRisingCrossing(timeData, threshold, audioContext.sampleRate, now);
                if (crossing != null) {
                  const low = bandEnergy(freqData, audioContext.sampleRate, analyser.fftSize, ONSET_LOW_BAND_HZ);
                  const high = bandEnergy(freqData, audioContext.sampleRate, analyser.fftSize, ONSET_HIGH_BAND_HZ);
                  if (low >= high * ONSET_LOW_HIGH_RATIO_MIN) {
                    state = 'pending';
                    pendingOnsetTime = crossing;
                  }
                  // else: click-shaped energy (high band dominant) -- not a voice onset, keep scanning
                }
              }
            } else if (state === 'pending') {
              const threshold = Math.max(ONSET_MIN_ABSOLUTE_RMS, noiseFloorRms * dbToLinear(ONSET_NOISE_FLOOR_MARGIN_DB));
              if (frameRms < threshold) {
                // Didn't sustain -- was a transient (likely click-leak), discard and keep scanning this rep's window.
                state = 'idle';
                pendingOnsetTime = null;
              } else if (now - pendingOnsetTime >= ONSET_SUSTAIN_MS / 1000) {
                state = 'confirmed';
              }
            }
          }

          if (state === 'confirmed') break;
          await nextAnimationFrame();
        }

        if (state === 'confirmed' && pendingOnsetTime != null) {
          offsetsMs[rep] = (pendingOnsetTime - repStart) * 1000;
        }
        onRepComplete?.(rep, offsetsMs[rep]);
      }

      // The verdict is lib/audio/sync.js's, not this file's: it drops
      // the lead-in reps, rejects a run with too few onsets or too much
      // spread, and clamps the compensation. The phone's measurement
      // calls the same function, so the two platforms cannot disagree
      // about whether a measurement can be trusted.
      return summariseCalibration(offsetsMs, { cancelled });
    } finally {
      inputGain.disconnect(analyser); // removes only this tap -- inputGain's other connections (highpass, bypassGain, inputAnalyser) are untouched
      clickGenerator.disconnect();
    }
  })();

  function cancel() {
    cancelled = true;
  }

  return { promise, cancel };
}
