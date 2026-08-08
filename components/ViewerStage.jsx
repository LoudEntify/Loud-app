'use client';

import { CaretDown, CaretUp } from '@phosphor-icons/react';
import VersusSplit from './VersusSplit';
import TopBar from './TopBar';
import CommentsPanel from './CommentsPanel';

// Desktop fan view -- matches Fan Viewer.dc.html. Versus shows the split
// stage with a drag divider between contestants; solo drops the split
// entirely. Every handler is passed straight through from RoomInner.
export default function ViewerStage({
  performanceMode,
  renderSlot,
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
        <VersusSplit
          mode={performanceMode}
          renderA={renderSlot('a')}
          renderB={renderSlot('b')}
        />

        <TopBar
          label={isVersus ? 'LIVE · VERSUS' : 'LIVE'}
          maximized={maximized}
          onToggleMaximize={onToggleMaximize}
        />
      </div>

      {/* Phase 4 -- same minimize/restore arrow BroadcastStage's comments
          got, reusing the exact same commentsCollapsed state/control
          (threaded via stageProps from RoomInner) for a consistent
          declutter affordance on both roles. Viewer has no deck/QR panel
          to stay mutually exclusive WITH -- this is just a plain
          standalone toggle here, not part of a 3-way coordination group,
          but the mechanism (CommentsPanel always mounted, only its
          wrapper collapses via CSS) is identical either way. */}
      <div className="stage-side-panel">
        <div className="stage-side-panel-header">
          <span className="stage-comments-label">COMMENTS</span>
          <button
            type="button"
            className="comments-collapse-btn"
            onClick={onToggleCommentsCollapsed}
            aria-label={commentsCollapsed ? 'show comments' : 'hide comments'}
          >
            {commentsCollapsed ? <CaretUp size={14} weight="bold" /> : <CaretDown size={14} weight="bold" />}
          </button>
        </div>
        <div className={`stage-side-panel-body ${commentsCollapsed ? 'stage-side-panel-body--collapsed' : ''}`}>
          <CommentsPanel
            comments={comments}
            onSend={sendComment}
            expanded={commentsExpanded}
            onExpand={onCommentsExpand}
            onCollapse={onCommentsCollapse}
          />
        </div>
      </div>
    </div>
  );
}
