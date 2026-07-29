'use client';

import VersusSplit from './VersusSplit';
import TopBar from './TopBar';
import ReactionBar from './ReactionBar';
import SuperReactionPanel from './SuperReactionPanel';
import CommentsPanel from './CommentsPanel';

// Desktop fan view -- matches Fan Viewer.dc.html. Versus shows the split
// stage with a per-side reaction rail on each contestant; solo drops the
// split and the dual rails, keeping just the general sticker row in the
// side panel. Every handler is passed straight through from RoomInner.
export default function ViewerStage({
  performanceMode,
  renderSlot,
  sendReaction,
  goLoudTotal,
  sendGoLoud,
  superVisible,
  onSuperToggle,
  comments,
  sendComment,
  commentsExpanded,
  onCommentsExpand,
  onCommentsCollapse,
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
          onReactA={sendReaction}
          onReactB={sendReaction}
          interactive={isVersus}
        />

        <TopBar
          label={isVersus ? 'LIVE · VERSUS' : 'LIVE'}
          maximized={maximized}
          onToggleMaximize={onToggleMaximize}
        />
      </div>

      <div className="stage-side-panel">
        <ReactionBar
          onReact={sendReaction}
          onSuperToggle={onSuperToggle}
          goLoudCount={goLoudTotal}
          onGoLoud={sendGoLoud}
        />
        <SuperReactionPanel visible={superVisible} onReact={sendReaction} />
        <CommentsPanel
          comments={comments}
          onSend={sendComment}
          expanded={commentsExpanded}
          onExpand={onCommentsExpand}
          onCollapse={onCommentsCollapse}
        />
      </div>
    </div>
  );
}
