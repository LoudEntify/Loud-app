'use client';

import { useRef, useState } from 'react';
import {
  runSyncCalibration,
  CALIBRATION_REP_COUNT,
  CALIBRATION_DISCARD_COUNT,
  SYNC_LARGE_DELAY_WARNING_MS,
} from '../lib/audioSyncCalibration';
import { probeLog } from '../lib/tapProbeBus';

const TOTAL_COUNTED = CALIBRATION_REP_COUNT - CALIBRATION_DISCARD_COUNT;

function timeAgo(ms) {
  if (ms == null) return null;
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return 'just now';
  return `${Math.round(s / 60)}m ago`;
}

// Soundcheck-primary, but not phase-gated -- reachable during live too
// (tapping mid-performance is disruptive, so this never auto-prompts;
// it's here for a break in the set if the artist notices drift).
export default function CalibrateSyncPanel({ audioContext, inputGain, syncDelayMs, onApply }) {
  const [status, setStatus] = useState('idle'); // idle | running | result
  const [repIndex, setRepIndex] = useState(0);
  const [result, setResult] = useState(null);
  const [calibratedAt, setCalibratedAt] = useState(null);
  const controllerRef = useRef(null);

  async function startCalibration() {
    probeLog(`AUDIO: startCalibration() called -- audioContext=${!!audioContext} inputGain=${!!inputGain}`);
    if (!audioContext || !inputGain) return;
    setStatus('running');
    setRepIndex(0);
    setResult(null);
    const controller = runSyncCalibration(audioContext, inputGain, {
      onRepComplete: (rep) => setRepIndex(rep + 1),
    });
    controllerRef.current = controller;
    const res = await controller.promise;
    controllerRef.current = null;
    setResult(res);
    setStatus('result');
  }

  function cancelCalibration() {
    // DEBUG (live pilot bug, round 2) -- see lib/tapProbeBus.js. Safe to
    // delete once the real cause is found and fixed.
    probeLog(`AUDIO: cancelCalibration() called -- controller=${controllerRef.current ? 'present' : 'NULL (no-op)'}`);
    controllerRef.current?.cancel();
  }

  function applyResult() {
    probeLog(`AUDIO: applyResult() called -- result.accepted=${!!result?.accepted}`);
    if (!result?.accepted) return;
    onApply(result.compensationMs);
    setCalibratedAt(Date.now());
    setStatus('idle');
    probeLog('AUDIO: applyResult() completed -- status set to idle');
  }

  function dismissResult() {
    probeLog(`AUDIO: dismissResult() called -- status was "${status}"`);
    setStatus('idle');
    probeLog('AUDIO: dismissResult() completed -- setStatus(idle) called');
  }

  return (
    <div style={{ borderTop: '1px solid #3a3a37', paddingTop: 12, marginTop: 4, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 11, letterSpacing: '0.1em', color: '#888780', textTransform: 'uppercase' }}>
          Audio sync
        </span>
        {status === 'idle' && (
          <button type="button" className="control-btn" onClick={startCalibration}>
            {syncDelayMs > 0 ? 'Recalibrate' : 'Calibrate audio sync'}
          </button>
        )}
      </div>

      {status === 'idle' && syncDelayMs > 0 && (
        <p style={{ fontSize: 11, color: '#888780', margin: 0 }}>
          Compensating ~{Math.round(syncDelayMs)}ms{calibratedAt ? ` -- calibrated ${timeAgo(calibratedAt)}` : ''}.
        </p>
      )}

      {status === 'idle' && (
        <p style={{ fontSize: 11, color: '#888780', margin: 0 }}>
          Plays a click through your headphones -- say &quot;Bah!&quot; on each one. Measures your real monitoring
          delay (mostly Bluetooth) and delays the published beat to match. Works the same on wired gear -- it just
          measures near-zero there.
        </p>
      )}

      {status === 'running' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <p style={{ fontSize: 12, color: '#fdfffc', margin: 0 }}>
            Say &quot;Bah!&quot; on each click -- rep {Math.min(repIndex, CALIBRATION_REP_COUNT)} / {CALIBRATION_REP_COUNT}
          </p>
          <button type="button" className="control-btn" onClick={cancelCalibration}>Cancel</button>
        </div>
      )}

      {status === 'result' && result && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {result.accepted ? (
            <>
              <p style={{ fontSize: 13, color: '#2ec4b6', margin: 0, fontWeight: 700 }}>
                Detected ~{Math.round(result.compensationMs)}ms delay -- compensating
              </p>
              {result.compensationMs >= SYNC_LARGE_DELAY_WARNING_MS && (
                <div style={{ border: '1px solid #ff9f1c', borderRadius: 8, padding: '8px 10px', fontSize: 11, color: '#ff9f1c', lineHeight: 1.4 }}>
                  That&apos;s a large delay -- for tightest sync, use wired earphones. Bluetooth can&apos;t be fully compensated.
                </div>
              )}
              <p style={{ fontSize: 11, color: '#888780', margin: 0 }}>
                This won&apos;t be perfect sync -- most listeners just won&apos;t consciously notice the gap anymore.
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="control-btn" onClick={applyResult}>Apply</button>
                <button type="button" className="control-btn" onClick={dismissResult}>Discard</button>
              </div>
            </>
          ) : (
            <>
              <p style={{ fontSize: 13, color: '#e71d36', margin: 0, fontWeight: 700 }}>
                Couldn&apos;t get a clean reading -- try again
              </p>
              <p style={{ fontSize: 11, color: '#888780', margin: 0 }}>
                {result.reason === 'too_few_onsets'
                  ? `Only heard ${result.validCount} of ${result.totalCounted ?? TOTAL_COUNTED} taps clearly -- try vocalizing a bit sharper and louder on the beat.`
                  : result.reason === 'too_noisy'
                    ? 'Taps were too scattered to trust the average -- try to lock into the click rhythm before tapping.'
                    : 'Calibration was cancelled.'}
              </p>
              <button type="button" className="control-btn" onClick={dismissResult}>Dismiss</button>
            </>
          )}

          {/* DEBUG -- raw per-rep readings, for tuning the detection gates
              against real hardware. Safe to delete this block once the
              thresholds are proven out; not meant for artist-facing use. */}
          <p style={{ fontSize: 10, color: '#55544f', fontFamily: 'monospace', margin: 0, whiteSpace: 'pre-wrap' }}>
            DEBUG offsets(ms)=[{result.rawOffsetsMs.map((o) => (o == null ? 'x' : Math.round(o))).join(', ')}]
            {result.medianMs != null ? ` median=${result.medianMs.toFixed(1)}` : ''}
            {result.madMs != null ? ` MAD=${result.madMs.toFixed(1)}` : ''}
            {' '}valid={result.validCount}/{result.totalCounted ?? TOTAL_COUNTED}
          </p>
        </div>
      )}
    </div>
  );
}
