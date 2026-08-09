'use client';

// Live-pilot diagnostic bus (temporary, round 2 of the dead-controls
// investigation) -- lets handler code in any component push a line into
// TapProbeOverlay's on-screen log (components/LiveDemo.jsx) without a
// prop-drilled callback. The suspect handlers (DirectorShotPanel's fire,
// BackingTrackPanel's handleFile, CalibrateSyncPanel's cancel/dismiss,
// LevelMeterFader's gain change) are unrelated siblings with no existing
// channel to the overlay -- a window CustomEvent is the simplest
// cross-component wire that doesn't require restructuring props through
// BroadcastStage just for this. Safe to delete, along with every
// probeLog() call site, once the real cause is found and fixed.
const EVENT = 'tapprobe:log';

export function probeLog(message) {
  try {
    window.dispatchEvent(new CustomEvent(EVENT, { detail: message }));
  } catch {
    // no-op -- diagnostics must never break the app they're diagnosing
  }
}

export function onProbeLog(callback) {
  function handler(e) {
    callback(e.detail);
  }
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
