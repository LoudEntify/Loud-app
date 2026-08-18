'use client';

import VersusSplit from './VersusSplit';
import SpotlightStage from './SpotlightStage';
import TopBar from './TopBar';
import CommentsDock from './CommentsDock';
import LiveShowRail from './LiveShowRail';

// Desktop fan view -- matches Fan Viewer.dc.html. Solo drops any split
// entirely. Versus routes to SpotlightStage (Stage 5, MULTI_PERFORMER_
// SPEC.md) -- VersusSplit's own 50/50 draggable mode is untouched but
// no longer used by the live-show path, per that spec's locked
// decision. Every handler is passed straight through from RoomInner.
//
// Desktop portrait stage -- viewer shares the exact same .stage-root
// (centred 9:16 box + BlurFillBackground sibling, both defined once at
// the shared level: reactions.css's .stage-root override and
// LiveDemo.jsx's role-agnostic <BlurFillBackground> mount) that
// BroadcastStage uses -- neither needed duplicating here, the shape
// treatment was never artist-only. What IS added here, viewer-only, is
// LiveShowRail: the future "channel surf other live shows" rail docks
// in the same right-hand gutter BroadcastStage's VideoDeckPanel column
// occupies, since a viewer never has that column's content competing
// for the space (no technical panels on this path, matching the spec).
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

      <LiveShowRail />

      <CommentsDock
        variant="viewer"
        comments={comments}
        sendComment={sendComment}
        commentsExpanded={commentsExpanded}
        onCommentsExpand={onCommentsExpand}
        onCommentsCollapse={onCommentsCollapse}
        commentsCollapsed={commentsCollapsed}
        onToggleCommentsCollapsed={onToggleCommentsCollapsed}
        presentSlots={presentSlots}
      />
    </div>
  );
}
