'use client';

import { CaretDown, CaretLeft } from '@phosphor-icons/react';
import VersusSplit from './VersusSplit';
import SpotlightStage from './SpotlightStage';
import TopBar from './TopBar';
import CommentsPanel from './CommentsPanel';

// Desktop fan view -- matches Fan Viewer.dc.html. Solo drops any split
// entirely. Versus routes to SpotlightStage (Stage 5, MULTI_PERFORMER_
// SPEC.md) -- VersusSplit's own 50/50 draggable mode is untouched but
// no longer used by the live-show path, per that spec's locked
// decision. Every handler is passed straight through from RoomInner.
export default function ViewerStage({
  performanceMode,
  renderSlot,
  activePerformerSlot,
  presentSlots,
  comments,
  sendComment,
  commentsExpanded,
  onCommentsExpand,
  onCommentsCollapse,
  commentsCollapsed,
  onToggleCommentsCollapsed,
  maximized,
  onToggleMaximize,
  onStageClick,
}) {
  const isVersus = performanceMode === 'versus';

  return (
    <div className="stage-root">
      <div className="stage-video-area" onClick={onStageClick}>
        {isVersus ? (
          <SpotlightStage
            activeSlot={activePerformerSlot}
            slots={presentSlots}
            renderSlot={renderSlot}
          />
        ) : (
          <VersusSplit
            mode={performanceMode}
            renderA={renderSlot('a')}
            renderB={renderSlot('b')}
          />
        )}

        <TopBar
          label={isVersus ? 'LIVE · VERSUS' : 'LIVE'}
          maximized={maximized}
          onToggleMaximize={onToggleMaximize}
        />
      </div>

      {/* Same minimize/restore arrow BroadcastStage's comments has, reusing
          the exact same commentsCollapsed state/control (threaded via
          stageProps from RoomInner) for a consistent declutter
          affordance on both roles. Mirrors Sidebar.jsx's own two-element
          pattern: the panel renders normally when open, and a SEPARATE,
          independently position:fixed reveal tab renders only when
          collapsed -- never nested inside anything whose own sizing
          could hide it (same fix BroadcastStage's comments needed after
          it got stuck un-reachable there). CommentsPanel itself stays
          ALWAYS mounted -- only visibility toggles via CSS, so an
          in-progress typed comment survives a collapse/restore cycle. */}
      <div className={`stage-side-panel ${commentsCollapsed ? 'stage-side-panel--collapsed' : ''}`}>
        <div className="stage-side-panel-header">
          <span className="stage-comments-label">COMMENTS</span>
          <button
            type="button"
            className="comments-collapse-btn"
            onClick={onToggleCommentsCollapsed}
            aria-label="hide comments"
          >
            <CaretDown size={14} weight="bold" />
          </button>
        </div>
        <div className="stage-side-panel-body">
          <CommentsPanel
            comments={comments}
            onSend={sendComment}
            expanded={commentsExpanded}
            onExpand={onCommentsExpand}
            onCollapse={onCommentsCollapse}
            presentSlots={presentSlots}
          />
        </div>
      </div>

      {commentsCollapsed && (
        <button
          type="button"
          className="comments-reveal-tab"
          onClick={onToggleCommentsCollapsed}
          aria-label="show comments"
        >
          <CaretLeft size={16} weight="bold" />
        </button>
      )}
    </div>
  );
}
