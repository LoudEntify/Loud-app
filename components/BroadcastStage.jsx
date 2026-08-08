'use client';

import { useRef, useState, useCallback } from 'react';
import { Microphone, MicrophoneSlash, VideoCamera, VideoCameraSlash, PhoneDisconnect, CameraRotate, CaretDown, CaretUp } from '@phosphor-icons/react';
import VersusSplit from './VersusSplit';
import TopBar from './TopBar';
import CommentsPanel from './CommentsPanel';
import PerformerDeck from './PerformerDeck';

// Sizing constants for the deck drag-resize / bottom-overlay offset math.
// MIC_CAM_HEIGHT is a measured estimate of the mic/cam row's rendered
// height (padding + button), not a computed value -- re-check it visually
// if that row's own styling changes.
const MIN_DECK_HEIGHT = 160;
const MIC_CAM_HEIGHT = 52;
const DECK_DIVIDER_HEIGHT = 16;
const DEFAULT_DECK_HEIGHT = 340;

// Desktop performer view -- matches Artist Broadcast.dc.html. Versus shows
// the performer's own multi-cam preview left / opponent right (with the
// drag divider); solo drops the split entirely and shows one full-bleed
// panel. Build 3c: mic/camera row, the deck's collapse toggle + drag
// divider, and PerformerDeck itself are wrapped in ONE fixed overlay
// (.stage-bottom-overlay) floating directly on the video, rather than
// flex-column siblings that used to shrink the video to make room for
// them -- every live-screen panel is a floating overlay now, artist and
// viewer alike. Comments float over the video the same way the fan
// mobile view does -- transparent, teal glow, no background -- their
// bottom offset tracks the same deckHeight state driving the divider,
// since a hardcoded pixel value can't work once that height is
// user-adjustable. Every handler here is passed straight through from
// RoomInner -- no LiveKit calls happen in this file.
export default function BroadcastStage({
  performanceMode,
  role,
  renderSlot,
  leaveCall,
  micOn,
  camOn,
  toggleMic,
  toggleCam,
  facingMode,
  toggleFacingMode,
  tracksForSlot,
  activeCamera,
  setActiveForSlot,
  audioNodes,
  audioContext,
  showEnded,
  showPhase,
  comments,
  sendComment,
  commentsExpanded,
  onCommentsExpand,
  onCommentsCollapse,
  maximized,
  onToggleMaximize,
  sidebarCollapsed,
  onStageClick,
}) {
  const otherSlot = role === 'a' ? 'b' : 'a';
  const candidates = tracksForSlot(role);

  const stageRef = useRef(null);
  const draggingRef = useRef(false);
  const [deckHeight, setDeckHeight] = useState(DEFAULT_DECK_HEIGHT);

  // Bottom-panel collapse (down-arrow/up-arrow) -- independent of
  // deckHeight itself, which stays exactly where the artist last dragged
  // it; collapsing just visually zeroes it via CSS (deck-wrapper--
  // collapsed, reactions.css) rather than overwriting deckHeight, so
  // there's nothing to remember/restore across a collapse/expand cycle.
  const [deckCollapsed, setDeckCollapsed] = useState(false);
  const toggleDeckCollapsed = useCallback(() => setDeckCollapsed((v) => !v), []);

  // When BOTH the left menu and the bottom deck are collapsed, the video
  // should go full-view -- same visual result as the existing maximize
  // toggle, reached a second way. Deliberately a one-way derivation (
  // collapsing both panels implies full-view; explicitly maximizing does
  // NOT force the panels to collapse) rather than entangling maximized
  // with the two collapse states as one combined piece of state.
  const videoFullView = maximized || (sidebarCollapsed && deckCollapsed);

  // The deck is a fixed overlay now (build 3c), not a flex sibling that
  // needs to leave room for the video underneath it -- so the cap is
  // just "a reasonable maximum fraction of the stage", not video-space
  // reservation math against MIC_CAM_HEIGHT/DECK_DIVIDER_HEIGHT (those
  // two constants are still used below, for the comments panel's own
  // bottom offset -- unrelated to this cap).
  const clampDeckHeight = useCallback((px) => {
    const stage = stageRef.current;
    const totalHeight = stage ? stage.getBoundingClientRect().height : DEFAULT_DECK_HEIGHT * 3;
    const maxDeck = Math.max(MIN_DECK_HEIGHT, totalHeight * 0.7);
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
    <div className={`stage-root stage-root--performer ${videoFullView ? 'stage-root--maximized' : ''}`} ref={stageRef}>
      {/* stage-video-area--versus modifier retired in Phase 2 (redesign) --
          it existed only to widen/reshape the phone-box for versus mode,
          which no longer exists (video is always full-bleed now). */}
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

      {/* Build 3c -- mic-cam + the deck's own toggle/divider/wrapper are
          wrapped in ONE fixed overlay, floating on the video, rather
          than flex-column siblings that used to shrink it. The four
          elements inside keep stacking via a normal nested flex column
          (see .stage-bottom-overlay in reactions.css) -- only the outer
          wrapper's positioning changed, nothing about their own
          relative order/spacing. */}
      <div className="stage-bottom-overlay">
        <div className="stage-mic-cam">
          <button type="button" className={`control-btn ${!micOn ? 'off' : ''}`} onClick={toggleMic}>
            {micOn ? <Microphone size={16} weight="bold" /> : <MicrophoneSlash size={16} weight="bold" />}
            {micOn ? 'MIC ON' : 'MIC MUTED'}
          </button>
          <button type="button" className={`control-btn ${!camOn ? 'off' : ''}`} onClick={toggleCam}>
            {camOn ? <VideoCamera size={16} weight="bold" /> : <VideoCameraSlash size={16} weight="bold" />}
            {camOn ? 'CAM ON' : 'CAM OFF'}
          </button>
          <button type="button" className="control-btn" onClick={toggleFacingMode}>
            <CameraRotate size={16} weight="bold" />
            {facingMode === 'user' ? 'FRONT' : 'REAR'}
          </button>
        </div>

        {/* Down/up arrow -- collapses/restores the deck below, independent
            of the drag-resize divider (which stays desktop-only and is
            hidden entirely while collapsed, since there's nothing to
            resize). Rendered as its own always-present row rather than
            folded into .deck-divider so it works identically on mobile,
            where the divider itself is hidden. */}
        <div className="deck-toggle-row">
          <button
            type="button"
            className="deck-collapse-btn"
            onClick={toggleDeckCollapsed}
            aria-label={deckCollapsed ? 'show panel' : 'hide panel'}
          >
            {deckCollapsed ? <CaretUp size={14} weight="bold" /> : <CaretDown size={14} weight="bold" />}
          </button>
        </div>

        {!deckCollapsed && (
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
        )}

        <div
          className={`deck-wrapper ${deckCollapsed ? 'deck-wrapper--collapsed' : ''}`}
          style={{ '--deck-height': `${deckHeight}px` }}
        >
          <PerformerDeck
            audioNodes={audioNodes}
            audioContext={audioContext}
            showEnded={showEnded}
            showPhase={showPhase}
            cameraCandidates={candidates}
            activeCameraIdentity={activeCamera[role]}
            onPickCamera={(identity) => setActiveForSlot(role, identity)}
          />
        </div>
      </div>

      <div
        className="stage-side-panel stage-side-panel--broadcast"
        style={{ bottom: (deckCollapsed ? 0 : deckHeight) + MIC_CAM_HEIGHT + (deckCollapsed ? 0 : DECK_DIVIDER_HEIGHT) }}
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
