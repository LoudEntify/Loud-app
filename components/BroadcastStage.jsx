'use client';

import { useRef, useState, useCallback } from 'react';
import { Microphone, MicrophoneSlash, VideoCamera, VideoCameraSlash, PhoneDisconnect, CameraRotate, CaretDown, CaretUp, CaretLeft } from '@phosphor-icons/react';
import VersusSplit from './VersusSplit';
import SpotlightStage from './SpotlightStage';
import TopBar from './TopBar';
import CommentsPanel from './CommentsPanel';
import SwipePages from './SwipePages';
import DirectorShotPanel from './DirectorShotPanel';
import AudioDeckPanel from './AudioDeckPanel';
import VideoDeckPanel from './VideoDeckPanel';
import ActivePerformerSwitcher from './ActivePerformerSwitcher';

// Sizing constants for the deck drag-resize / bottom-overlay offset math.
// MIC_CAM_HEIGHT is a measured estimate of the mic/cam row's rendered
// height (padding + button), not a computed value -- re-check it visually
// if that row's own styling changes. Bumped 52 -> 100 since Phase 4 added
// a 4th button (leave) to that row with flex-wrap:wrap -- on a narrow
// enough width it can wrap to two lines, and this estimate needs to cover
// that taller case too, not just the single-line one, or comments' own
// bottom offset (below) underestimates real occupied height.
const MIN_DECK_HEIGHT = 160;
const MIC_CAM_HEIGHT = 100;
const DECK_DIVIDER_HEIGHT = 16;
const DEFAULT_DECK_HEIGHT = 340;

// Desktop performer view -- matches Artist Broadcast.dc.html. Versus shows
// the performer's own multi-cam preview left / opponent right (with the
// drag divider); solo drops the split entirely and shows one full-bleed
// panel. Build 3c: mic/camera row, the deck's collapse toggle + drag
// divider, and the SHOTS/AUDIO/VIDEO swipe panel are wrapped in ONE fixed
// overlay (.stage-bottom-overlay) floating directly on the video, rather
// than flex-column siblings that used to shrink the video to make room
// for them -- every live-screen panel is a floating overlay now, artist
// and viewer alike. Comments float over the video the same way the fan
// mobile view does -- transparent, teal glow, no background -- their
// bottom offset tracks the same deckHeight state driving the divider,
// since a hardcoded pixel value can't work once that height is
// user-adjustable.
//
// Phase 3 (redesign): PerformerDeck's own internal AUDIO/VIDEO
// tab-switcher and the separately-floating director-panel drawer (SHOTS)
// used to be two independent things, which is exactly why they could
// (and did) visually collide -- both position:fixed at the bottom, with
// nothing coordinating them. Replaced with ONE SwipePages instance
// holding all three as pages; DirectorShotPanel/AudioDeckPanel/
// VideoDeckPanel are rendered directly here now, PerformerDeck.jsx is
// retired. This does mean BroadcastStage is no longer purely LiveKit-
// agnostic passthrough -- it now needs the shot-director's own props
// (room, showId, availableRoles, tracks, autoState, the on* callbacks),
// threaded straight through from RoomInner exactly as DirectorShotPanel
// used to receive them directly; still no LiveKit CALLS happen in this
// file itself, just prop plumbing.
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
  activePerformerSlot,
  switchingPerformer,
  onSwitchActivePerformer,
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
  room,
  showId,
  availableRoles,
  tracks,
  onExclusiveMode,
  onHumanCommand,
  onCommand,
  autoState,
  onToggleAuto,
  deckCollapsed,
  onToggleDeckCollapsed,
  commentsCollapsed,
  onToggleCommentsCollapsed,
}) {
  const otherSlot = role === 'a' ? 'b' : 'a';
  const candidates = tracksForSlot(role);

  const stageRef = useRef(null);
  const draggingRef = useRef(false);
  const [deckHeight, setDeckHeight] = useState(DEFAULT_DECK_HEIGHT);

  // deckCollapsed/onToggleDeckCollapsed (Phase 4) moved up to RoomInner
  // (LiveDemo.jsx) -- it now needs to coordinate with commentsCollapsed
  // and the QR panel's own open state (mutual exclusivity: opening one
  // auto-collapses the other two), which live there too. deckHeight
  // itself stays local here, untouched -- it's purely a drag-resize
  // value, nothing else needs to read or coordinate with it.

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
        {performanceMode === 'versus' ? (
          <SpotlightStage
            activeSlot={activePerformerSlot}
            renderA={renderSlot('a')}
            renderB={renderSlot('b')}
          />
        ) : (
          <VersusSplit
            mode={performanceMode}
            renderA={renderSlot(role)}
            renderB={renderSlot(otherSlot)}
          />
        )}

        <TopBar label="YOU'RE LIVE" maximized={maximized} onToggleMaximize={onToggleMaximize} />
      </div>

      {/* Build 3c -- mic-cam + the deck's own toggle/divider/wrapper are
          wrapped in ONE fixed overlay, floating on the video, rather
          than flex-column siblings that used to shrink it. The four
          elements inside keep stacking via a normal nested flex column
          (see .stage-bottom-overlay in reactions.css) -- only the outer
          wrapper's positioning changed, nothing about their own
          relative order/spacing.
          Phase 4 -- leave call moved INTO this row from its old
          independent floating position (right:24px;top:50%), which
          overlapped comments' own right-edge column on most viewport
          heights. Session controls (mute/camera/flip/leave) are one
          coherent group now, not a separately-floating element hoping
          not to collide with something else. */}
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
          <button type="button" className="leave-btn-inline" onClick={leaveCall} aria-label="leave call">
            <PhoneDisconnect size={16} weight="bold" />
            LEAVE
          </button>
        </div>

        {/* Down/up arrow -- collapses/restores the deck below, independent
            of the drag-resize divider (which stays desktop-only and is
            hidden entirely while collapsed, since there's nothing to
            resize). Rendered as its own always-present row rather than
            folded into .deck-divider so it works identically on mobile,
            where the divider itself is hidden. onToggleDeckCollapsed
            (Phase 4) now lives in RoomInner, coordinated with comments/QR
            mutual exclusivity -- see LiveDemo.jsx. */}
        <div className="deck-toggle-row">
          <button
            type="button"
            className="deck-collapse-btn"
            onClick={onToggleDeckCollapsed}
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
          <SwipePages
            pages={[
              {
                key: 'shots',
                label: 'SHOTS',
                content: (
                  <DirectorShotPanel
                    room={room}
                    showId={showId}
                    slot={role}
                    availableRoles={availableRoles}
                    tracks={tracks}
                    showPhase={showPhase}
                    onExclusiveMode={onExclusiveMode}
                    onHumanCommand={onHumanCommand}
                    onCommand={onCommand}
                    autoState={autoState}
                    onToggleAuto={onToggleAuto}
                  />
                ),
              },
              {
                key: 'audio',
                label: 'AUDIO',
                content: (
                  <AudioDeckPanel
                    nodes={audioNodes}
                    audioContext={audioContext}
                    showEnded={showEnded}
                    showPhase={showPhase}
                  />
                ),
              },
              {
                key: 'video',
                label: 'VIDEO',
                content: (
                  <VideoDeckPanel
                    candidates={candidates}
                    activeIdentity={activeCamera[role]}
                    onPick={(identity) => setActiveForSlot(role, identity)}
                  />
                ),
              },
              // Stage 4 (MULTI_PERFORMER_SPEC.md) -- only slot 'a' (the
              // broadcast controller) ever sees this tab, and only in a
              // versus show (nothing to switch between in solo). This is
              // a UI convenience, not the security boundary -- the real
              // check is server-side in /api/show/active-performer.
              ...(role === 'a' && performanceMode === 'versus'
                ? [{
                    key: 'switch',
                    label: 'SWITCH',
                    content: (
                      <ActivePerformerSwitcher
                        slots={['a', 'b']}
                        tracksForSlot={tracksForSlot}
                        activePerformerSlot={activePerformerSlot}
                        onSwitch={onSwitchActivePerformer}
                        switching={switchingPerformer}
                      />
                    ),
                  }]
                : []),
            ]}
          />
        </div>
      </div>

      {/* Comments gets its own minimize/restore arrow, same pattern as the
          deck's down/up toggle. CommentsPanel itself stays ALWAYS mounted
          (never conditionally rendered) -- only VISIBILITY toggles via
          CSS, so an in-progress typed comment survives a collapse/
          restore cycle rather than being wiped by an unmount.
          Fix: the header's own arrow used to be the ONLY way back once
          collapsed, and lived INSIDE .stage-side-panel -- whose position
          depends on deckHeight/MIC_CAM_HEIGHT math that can go stale
          (the mic-cam row can now wrap to 2 lines on narrow widths,
          Phase 4's 4th button), letting the deck's higher z-index
          visually cover the whole panel, arrow included, with no way
          back. Mirrors Sidebar.jsx's own two-element pattern exactly now:
          the panel itself renders normally when open, and a SEPARATE,
          independently position:fixed reveal tab (comments-reveal-tab,
          z-index above the deck) renders ONLY when collapsed -- never
          nested inside anything whose own sizing could hide it. */}
      <div
        className={`stage-side-panel stage-side-panel--broadcast ${commentsCollapsed ? 'stage-side-panel--collapsed' : ''}`}
        style={{ bottom: (deckCollapsed ? 0 : deckHeight) + MIC_CAM_HEIGHT + (deckCollapsed ? 0 : DECK_DIVIDER_HEIGHT) }}
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
