'use client';

import { CornersOut, CornersIn } from '@phosphor-icons/react';

// Shared live-stage header overlay used by both BroadcastStage and
// ViewerStage -- the pulsing LIVE dot, a caller-supplied label, an
// optional viewer count, and the maximize/minimize toggle.
export default function TopBar({ label, viewerCount, maximized, onToggleMaximize, performanceMode }) {
  return (
    <div className="stage-topbar">
      <div className="stage-topbar-left">
        <div className="stage-live-row">
          <span className="stage-live-dot" />
          <span className="stage-live-label">{label}</span>
          {/* Show-type badge -- sits with the state label rather than
              floating separately, so both roles read one status group in
              one place. Rendered here (the SHARED header) precisely so
              artists and viewers cannot drift apart on it. */}
          {performanceMode && (
            <span className="stage-showtype-badge">
              {performanceMode === 'versus' ? 'VERSUS' : 'SOLO'}
            </span>
          )}
        </div>
        {viewerCount != null && (
          <div className="stage-viewer-count">{viewerCount.toLocaleString()} watching</div>
        )}
      </div>
      <button type="button" className="stage-maximize-btn" onClick={onToggleMaximize} aria-label="toggle fullscreen">
        {maximized ? <CornersIn size={18} weight="regular" /> : <CornersOut size={18} weight="regular" />}
      </button>
    </div>
  );
}
