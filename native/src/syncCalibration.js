// The headphone delay check, from the shared rules to the phone.
//
// lib/audio/sync.js holds the click train, the gates and the verdict,
// and the web's measurement uses the same module. lib/audio/dsp.js
// derives the two band-pass filters, because a phone has no FFT it can
// afford inside an audio callback. This module is the delivery and the
// polling; it decides nothing.
//
// Why it exists at all: the same reason as the vocal chain. The
// measurement needs a click played at a known sample and a vocal onset
// timed to 20ms, and neither is reachable from JavaScript on a phone.
import {
  nativeSyncConfig, summariseCalibration, describeCalibration, REP_COUNT,
  CLICK_INTERVAL_S, LEAD_IN_S,
} from '@loud/lib/audio/sync.js';
import { bandpassCoefficients } from '@loud/lib/audio/dsp.js';
import * as LoudCamera from '../modules/loud-camera';
import { DEFAULT_RATE } from './vocalChain';

/** How often to ask the native side how a run is going. */
export const POLL_MS = 150;

/** Longer than the run can possibly take, so a stalled run ends rather than hanging. */
export const RUN_TIMEOUT_MS = (LEAD_IN_S + REP_COUNT * CLICK_INTERVAL_S) * 1000 + 3000;

/**
 * Run one calibration.
 *
 * Returns { ok, result, described } where `result` is
 * summariseCalibration's verdict — accepted or not — and `described` is
 * the line and action for the screen. A run that cannot start resolves
 * `ok: false` with the reason rather than throwing.
 *
 * `onRep` is called with (rep, repCount) so a screen can count the
 * clicks as they go, which is the only thing that tells an artist the
 * check is actually listening.
 */
export async function runSyncCalibration({ sampleRate = DEFAULT_RATE, onRep } = {}) {
  const config = nativeSyncConfig(sampleRate, bandpassCoefficients);
  const started = await LoudCamera.startSyncCalibration(config);
  if (!started?.ok) return { ok: false, error: started?.error || 'could not start', result: null, described: null };

  const deadline = Date.now() + RUN_TIMEOUT_MS;
  let lastRep = -1;

  // Poll rather than listen: the native side holds the offsets and a
  // run is twelve clicks over about eight seconds, so an event per rep
  // would be eight bridge crossings to save forty cheap ones.
  for (;;) {
    const state = await LoudCamera.syncCalibrationState();
    if (state?.rep !== lastRep && typeof state?.rep === 'number') {
      lastRep = state.rep;
      onRep?.(state.rep, state.repCount ?? REP_COUNT);
    }
    if (!state?.running) {
      const result = summariseCalibration(state?.results || []);
      return { ok: true, result, described: describeCalibration(result) };
    }
    if (Date.now() > deadline) {
      // Past the point where the run must have finished. Cancelling and
      // reporting it as cancelled is honest; waiting longer is not, and
      // treating the offsets collected so far as a measurement would
      // apply a correction from a run that did not complete.
      await LoudCamera.cancelSyncCalibration();
      const result = summariseCalibration(state?.results || [], { cancelled: true });
      return { ok: true, result, described: describeCalibration(result) };
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

export function cancelSyncCalibration() {
  return LoudCamera.cancelSyncCalibration();
}
