'use client';

import { CaretDown, CaretLeft, ChatCircle } from '@phosphor-icons/react';
import CommentsPanel from './CommentsPanel';
import { useIsDesktopViewport } from '../lib/useIsDesktopViewport';

// Shared comments dock -- BroadcastStage and ViewerStage used to each
// hand-roll an identical .stage-side-panel/.comments-reveal-tab block
// (same markup, same collapse state, same CommentsPanel props). Pulled
// out once both needed the SAME desktop behavior, so there's one place
// to own it instead of two copies drifting apart.
// `variant` controls only the one real difference between the two call
// sites: BroadcastStage's panel needs its bottom offset to track
// deckHeight (passed via `style`, mirroring stage-side-panel--broadcast's
// existing inline-bottom convention); ViewerStage has no deck, so it
// passes neither.
//
// Toggle model (live device test, round 3) -- mobile and desktop are
// now genuinely different interaction models, not just different
// styling of the same one:
//   - Mobile (untouched): .stage-side-panel-header's own chevron is
//     always there; .comments-reveal-tab appears ONLY while collapsed,
//     at the screen edge. Two elements, but they never coexist.
//   - Desktop: ONE element, .comments-toggle-btn, rendered
//     UNCONDITIONALLY (both expanded and collapsed) at a fixed
//     position that never changes between states (reactions.css keys
//     its top offset off `variant` alone, not commentsCollapsed). The
//     header chevron is hidden entirely at this breakpoint (CSS) so
//     there's exactly one way to toggle. It has to live outside
//     .stage-side-panel -- that box opacity:0's on collapse (see
//     .stage-side-panel--collapsed), so nothing inside it can be the
//     one control that must stay visible in both states.
export default function CommentsDock({
  variant = 'viewer', // 'broadcast' | 'viewer'
  style,
  comments,
  sendComment,
  commentsExpanded,
  onCommentsExpand,
  onCommentsCollapse,
  commentsCollapsed,
  onToggleCommentsCollapsed,
  presentSlots,
}) {
  const isDesktop = useIsDesktopViewport();
  const count = comments?.length ?? 0;

  return (
    <>
      <div
        className={`stage-side-panel ${variant === 'broadcast' ? 'stage-side-panel--broadcast' : ''} ${commentsCollapsed ? 'stage-side-panel--collapsed' : ''}`}
        style={style}
      >
        <div className="stage-side-panel-header">
          <span className="stage-comments-label">COMMENTS</span>
          {/* Mobile only now -- reactions.css hides this at desktop
              widths (.comments-toggle-btn below replaces it there). */}
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

      {/* Mobile: unchanged -- only rendered while collapsed, at the
          screen edge. */}
      {!isDesktop && commentsCollapsed && (
        <button
          type="button"
          className="comments-reveal-tab"
          onClick={onToggleCommentsCollapsed}
          aria-label={`show comments${count ? ` (${count})` : ''}`}
        >
          <CaretLeft size={16} weight="bold" />
        </button>
      )}

      {/* Desktop: always rendered, same handler toggles either
          direction. weight swaps fill/outline as the only visual cue
          content-wise; the unread count badge only shows while
          collapsed (aria-label carries the count either way). */}
      {isDesktop && (
        <button
          type="button"
          className={`comments-toggle-btn ${variant === 'broadcast' ? 'comments-toggle-btn--broadcast' : ''}`}
          onClick={onToggleCommentsCollapsed}
          aria-label={commentsCollapsed ? `show comments${count ? ` (${count})` : ''}` : 'hide comments'}
          aria-pressed={!commentsCollapsed}
        >
          <ChatCircle size={16} weight={commentsCollapsed ? 'fill' : 'regular'} />
          {commentsCollapsed && count > 0 && <span className="comments-toggle-btn-count">{count}</span>}
        </button>
      )}
    </>
  );
}
