'use client';

import { CaretDown, CaretLeft, ChatCircle } from '@phosphor-icons/react';
import CommentsPanel from './CommentsPanel';
import { useIsDesktopViewport } from '../lib/useIsDesktopViewport';

// Shared comments dock -- BroadcastStage and ViewerStage used to each
// hand-roll an identical .stage-side-panel/.comments-reveal-tab block
// (same markup, same collapse state, same CommentsPanel props). Pulled
// out once both needed the SAME new desktop behavior (comment icon +
// count on the collapsed tab, item below) so there's one place to own
// it instead of two copies drifting apart.
// `variant` controls only the one real difference between the two call
// sites: BroadcastStage's panel needs its bottom offset to track
// deckHeight (passed via `style`, mirroring stage-side-panel--broadcast's
// existing inline-bottom convention); ViewerStage has no deck, so it
// passes neither.
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
          aria-label={`show comments${count ? ` (${count})` : ''}`}
        >
          {/* Desktop portrait stage -- mobile keeps the plain edge-hugging
              arrow tab (untouched); desktop swaps it for the "small
              unobtrusive button + count" shape from the spec, reusing
              the SAME tab (position/border/glow driven by reactions.css's
              desktop override) rather than a second element, so there's
              only ever one reveal control to keep positioned correctly. */}
          {isDesktop ? (
            <>
              <ChatCircle size={16} weight="bold" />
              {count > 0 && <span className="comments-reveal-tab-count">{count}</span>}
            </>
          ) : (
            <CaretLeft size={16} weight="bold" />
          )}
        </button>
      )}
    </>
  );
}
