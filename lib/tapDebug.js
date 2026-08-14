'use client';

// TEMPORARY -- switch-tap-on-mobile bug investigation
// (MULTI_PERFORMER_SPEC.md). Mirrors ShotRendering.jsx's
// logCutDebug/useCutDebugLog pattern exactly. Exists purely to see the
// real touch/pointer/click event sequence (and whether the API call
// actually fires) on a real phone, not to guess at it. Remove this
// whole file, its imports, and the on-screen overlay once the real
// cause is confirmed and fixed.

import { useState, useEffect } from 'react';

let log = [];
const listeners = new Set();

export function logTap(label) {
  const entry = `+${performance.now().toFixed(0)}ms ${label}`;
  log = [...log.slice(-29), entry];
  listeners.forEach((fn) => fn(log));
}

export function useTapDebugLog() {
  const [state, setState] = useState(log);
  useEffect(() => {
    listeners.add(setState);
    return () => listeners.delete(setState);
  }, []);
  return state;
}
