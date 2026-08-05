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

import { SYNC_DELAY_MAX_S } from './audioProcessing';

// --- Click train ---------------------------------------------------------
export const CALIBRATION_REP_COUNT = 12; // total clicks played
export const CALIBRATION_DISCARD_COUNT = 2; // first N reps thrown out (artist syncing into the tempo)
export const CALIBRATION_CLICK_INTERVAL_S = 0.6; // 100 BPM -- comfortable tap-along tempo
export const CALIBRATION_CLICK_DURATION_S = 0.005; // 5ms burst
export const CALIBRATION_CLICK_FREQUENCY_HZ = 4000; // spectrally clear of "ah" vowel energy (see ONSET_LOW_BAND_HZ)
export const CALIBRATION_LEAD_IN_S = 0.3; // time before the first click, to absorb scheduling overhead

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
export const CALIBRATION_MAD_REJECT_MS = 40; // if the spread between reps is already this big, the median can't be trusted
export const CALIBRATION_MIN_VALID_ONSETS = 6; // out of (CALIBRATION_REP_COUNT - CALIBRATION_DISCARD_COUNT)

// --- Published-mix guidance --------------------------------------------
export const SYNC_LARGE_DELAY_WARNING_MS = 150; // above this, surface the "use wired earphones" guidance

function dbToLinear(db) {
  return Math.pow(10, db / 20);
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function medianAbsoluteDeviation(values, med) {
  return median(values.map((v) => Math.abs(v - med)));
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

      const countedOffsets = offsetsMs.slice(CALIBRATION_DISCARD_COUNT);
      const validOffsets = countedOffsets.filter((o) => o != null);
      const totalCounted = CALIBRATION_REP_COUNT - CALIBRATION_DISCARD_COUNT;

      if (cancelled) {
        return { accepted: false, reason: 'cancelled', rawOffsetsMs: countedOffsets, validCount: validOffsets.length, totalCounted };
      }

      if (validOffsets.length < CALIBRATION_MIN_VALID_ONSETS) {
        return { accepted: false, reason: 'too_few_onsets', rawOffsetsMs: countedOffsets, validCount: validOffsets.length, totalCounted };
      }

      const med = median(validOffsets);
      const mad = medianAbsoluteDeviation(validOffsets, med);

      if (mad > CALIBRATION_MAD_REJECT_MS) {
        return {
          accepted: false,
          reason: 'too_noisy',
          rawOffsetsMs: countedOffsets,
          medianMs: med,
          madMs: mad,
          validCount: validOffsets.length,
          totalCounted,
        };
      }

      const compensationMs = Math.max(0, Math.min(SYNC_DELAY_MAX_S * 1000, med));

      return {
        accepted: true,
        compensationMs,
        rawOffsetsMs: countedOffsets,
        medianMs: med,
        madMs: mad,
        validCount: validOffsets.length,
        totalCounted,
      };
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
