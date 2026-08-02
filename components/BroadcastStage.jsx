'use client';

import { useRef, useState, useCallback } from 'react';
import { Microphone, MicrophoneSlash, VideoCamera, VideoCameraSlash, PhoneDisconnect } from '@phosphor-icons/react';
import VersusSplit from './VersusSplit';
import TopBar from './TopBar';
import CommentsPanel from './CommentsPanel';
import PerformerDeck from './PerformerDeck';

// Desktop-only sizing constants for the video/deck split -- mirrors
// VersusSplit's own min/max-bound drag pattern, just vertical instead of
// horizontal. MIC_CAM_HEIGHT is a measured estimate of the mic/cam row's
// rendered height (padding + button), not a computed value -- re-check it
// visually if that row's own styling changes.
const MIN_DECK_HEIGHT = 160;
// The leave button sits at top:50% of the video area with a 56px circle,
// and comments starts at top:80px within that same area -- below ~256px
// the two collide visually. Keeping a margin above that floor.
const MIN_VIDEO_HEIGHT = 260;
const MIC_CAM_HEIGHT = 52;
const DECK_DIVIDER_HEIGHT = 16;
const DEFAULT_DECK_HEIGHT = 340;

// Desktop performer view -- matches Artist Broadcast.dc.html. Versus shows
// the performer's own multi-cam preview left / opponent right (with the
// drag divider); solo drops the split entirely and shows one full-bleed
// panel. Stacked top to bottom below the video: mic/camera row (instant,
// no-menu-diving toggles), a draggable vertical divider, then
// PerformerDeck (audio/video tuning panels) at a height the artist
// controls. Comments float over the video the same way the fan mobile
// view does -- transparent, teal glow, no background -- their bottom
// offset tracks the same deckHeight state driving the divider, since a
// hardcoded pixel value can't work once that height is user-adjustable.
// Every handler here is passed straight through from RoomInner -- no
// LiveKit calls happen in this file.
export default function BroadcastStage({
  performanceMode,
  role,
  renderSlot,
  leaveCall,
  micOn,
  camOn,
  toggleMic,
  toggleCam,
  tracksForSlot,
  activeCamera,
  setActiveForSlot,
  audioNodes,
  audioContext,
  showEnded,
  comments,
  sendComment,
  commentsExpanded,
  onCommentsExpand,
  onCommentsCollapse,
  maximized,
  onToggleMaximize,
  onStageClick,
}) {
  const otherSlot = role === 'a' ? 'b' : 'a';
  const candidates = tracksForSlot(role);

  const stageRef = useRef(null);
  const draggingRef = useRef(false);
  const [deckHeight, setDeckHeight] = useState(DEFAULT_DECK_HEIGHT);

  const clampDeckHeight = useCallback((px) => {
    const stage = stageRef.current;
    const totalHeight = stage ? stage.getBoundingClientRect().height : DEFAULT_DECK_HEIGHT * 3;
    const maxDeck = Math.max(
      MIN_DECK_HEIGHT,
      totalHeight - MIN_VIDEO_HEIGHT - MIC_CAM_HEIGHT - DECK_DIVIDER_HEIGHT
    );
    return Math.max(MIN_DECK_HEIGHT, Math.min(maxDeck, px));
  }, []);

  const updateFromPointer = useCallback((clientY) => {
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    setDeckHeight(clampDeckHeight(rect.bottom - clientY));
  }, [clampDeckHeight]);

  const onDividerPointerDown = (e) => {
    draggingRef.current = true;
    e.target.setPointerCapture?.(e.pointerId);
  };
  const onDividerPointerMove = (e) => {
    if (!draggingRef.current) return;
    updateFromPointer(e.clientY);
  };
  const onDividerPointerUp = () => {
    draggingRef.current = false;
  };

  return (
    <div className="stage-root stage-root--performer" ref={stageRef}>
      <div className="stage-video-area" onClick={onStageClick}>
        <VersusSplit
          mode={performanceMode}
          renderA={renderSlot(role)}
          renderB={renderSlot(otherSlot)}
        />

        <TopBar label="YOU'RE LIVE" maximized={maximized} onToggleMaximize={onToggleMaximize} />

        <button type="button" className="leave-btn-floating" onClick={leaveCall} aria-label="leave call">
          <PhoneDisconnect size={20} weight="bold" />
        </button>
      </div>

      <div className="stage-mic-cam">
        <button type="button" className={`control-btn ${!micOn ? 'off' : ''}`} onClick={toggleMic}>
          {micOn ? <Microphone size={16} weight="bold" /> : <MicrophoneSlash size={16} weight="bold" />}
          {micOn ? 'MIC ON' : 'MIC MUTED'}
        </button>
        <button type="button" className={`control-btn ${!camOn ? 'off' : ''}`} onClick={toggleCam}>
          {camOn ? <VideoCamera size={16} weight="bold" /> : <VideoCameraSlash size={16} weight="bold" />}
          {camOn ? 'CAM ON' : 'CAM OFF'}
        </button>
      </div>

      <div
        className="deck-divider"
        onPointerDown={onDividerPointerDown}
        onPointerMove={onDividerPointerMove}
        onPointerUp={onDividerPointerUp}
        onPointerCancel={onDividerPointerUp}
        role="slider"
        aria-label="resize control deck"
        aria-valuemin={MIN_DECK_HEIGHT}
        aria-valuemax={Math.round(clampDeckHeight(Infinity))}
        aria-valuenow={Math.round(deckHeight)}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp') setDeckHeight((h) => clampDeckHeight(h + 12));
          if (e.key === 'ArrowDown') setDeckHeight((h) => clampDeckHeight(h - 12));
        }}
      >
        <div className="drag-handle portrait">
          <span className="drag-dot" />
          <span className="drag-dot" />
          <span className="drag-dot" />
        </div>
      </div>

      <div className="deck-wrapper" style={{ '--deck-height': `${deckHeight}px` }}>
        <PerformerDeck
          audioNodes={audioNodes}
          audioContext={audioContext}
          showEnded={showEnded}
          cameraCandidates={candidates}
          activeCameraIdentity={activeCamera[role]}
          onPickCamera={(identity) => setActiveForSlot(role, identity)}
        />
      </div>

      <div
        className="stage-side-panel stage-side-panel--broadcast"
        style={{ bottom: deckHeight + MIC_CAM_HEIGHT + DECK_DIVIDER_HEIGHT }}
      >
        <span className="stage-comments-label">COMMENTS</span>
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
