'use client';

import { useTapDebugLog } from '../lib/tapDebug';

// TEMPORARY -- switch-tap-on-mobile bug investigation
// (MULTI_PERFORMER_SPEC.md). Always visible right now (not gated
// behind ?debug=1) so it's readable directly off a real phone screen
// during testing without remembering a query param. Remove this file
// and its one call site once the bug is confirmed fixed.
export default function TapDebugOverlay() {
  const log = useTapDebugLog();
  return (
    <div
      style={{
        position: 'fixed',
        top: 8,
        left: 8,
        right: 8,
        maxHeight: '35vh',
        overflowY: 'auto',
        padding: '8px 10px',
        borderRadius: 6,
        background: 'rgba(1, 22, 39, 0.9)',
        color: '#fdfffc',
        fontFamily: 'monospace',
        fontSize: 10,
        lineHeight: 1.5,
        zIndex: 9999,
        pointerEvents: 'none',
      }}
    >
      <div style={{ fontWeight: 700, color: '#2ec4b6' }}>TAP DEBUG ({log.length})</div>
      {log.map((line, i) => (
        <div key={i}>{line}</div>
      ))}
    </div>
  );
}
