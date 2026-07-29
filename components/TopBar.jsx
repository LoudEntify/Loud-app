'use client';

import { CornersOut, CornersIn } from '@phosphor-icons/react';

// Shared live-stage header overlay used by both BroadcastStage and
// ViewerStage -- the pulsing LIVE dot, a caller-supplied label, an
// optional viewer count, and the maximize/minimize toggle.
export default function TopBar({ label, viewerCount, maximized, onToggleMaximize }) {
  return (
    <div className="stage-topbar">
      <div className="stage-topbar-left">
        <div className="stage-live-row">
          <span className="stage-live-dot" />
          <span className="stage-live-label">{label}</span>
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
