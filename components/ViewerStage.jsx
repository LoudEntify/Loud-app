'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import VersusSplit from './VersusSplit';
import TopBar from './TopBar';
import CommentsDock from './CommentsDock';
import LiveShowRail from './LiveShowRail';
import { getAdjacentLiveShows, switchToLiveShow, targetForDiscoverySwipe } from '../lib/liveShowDiscovery';

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
  showId,
  performanceMode,
  renderSlot,
  activePerformerSlot,
  presentSlots,
  liveSlots,
  // For the glow's audio levels — see lib/glowLevels.js.
  room,
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
  const router = useRouter();
  const isVersus = performanceMode === 'versus';
  const [adjacentShows, setAdjacentShows] = useState([]);
  const touchStart = useRef(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => getAdjacentLiveShows(showId).then((shows) => {
      if (!cancelled) setAdjacentShows(shows);
    });
    load();
    const refresh = setInterval(load, 15000);
    return () => {
      cancelled = true;
      clearInterval(refresh);
    };
  }, [showId]);

  function handleTouchStart(event) {
    if (event.touches.length !== 1) return;
    const touch = event.touches[0];
    touchStart.current = { x: touch.clientX, y: touch.clientY, at: Date.now() };
  }

  function handleTouchEnd(event) {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start || !adjacentShows.length || !event.changedTouches.length) return;
    const touch = event.changedTouches[0];
    const target = targetForDiscoverySwipe(adjacentShows, {
      dx: touch.clientX - start.x,
      dy: touch.clientY - start.y,
      elapsedMs: Date.now() - start.at,
    });
    if (!target) return;
    switchToLiveShow(target.id, (href) => router.push(href));
  }

  return (
    <div className="stage-root">
      <div className="stage-video-area" onClick={onStageClick} onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
        {/* Same layout the artist's console shows. Deliberately one
            mental model of the show: the artist should see roughly what
            the audience sees, and a spotlight for one and a split for
            the other is how a director gets surprised by their own
            broadcast. */}
        {isVersus ? (
          <VersusSplit
            mode="versus"
            renderA={renderSlot('a')}
            renderB={renderSlot('b')}
            liveSlots={liveSlots}
            room={room}
          />
        ) : (
          <VersusSplit
            mode={performanceMode}
            renderA={renderSlot('a')}
            renderB={renderSlot('b')}
          />
        )}

        <TopBar
          label="LIVE"
          performanceMode={performanceMode}
          maximized={maximized}
          onToggleMaximize={onToggleMaximize}
        />

        {adjacentShows.length > 0 && (
          <div className="live-show-swipe-hint" aria-hidden="true">
            <span>‹</span> SWIPE FOR ANOTHER LIVE SHOW <span>›</span>
          </div>
        )}
      </div>

      <LiveShowRail currentShowId={showId} discoveredShows={adjacentShows} />

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
