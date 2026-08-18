'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import { Microphone, MicrophoneSlash, VideoCamera, VideoCameraSlash, PhoneDisconnect, CameraRotate, CaretDown, CaretUp, CaretLeft, CaretRight } from '@phosphor-icons/react';
import VersusSplit from './VersusSplit';
import SpotlightStage from './SpotlightStage';
import TopBar from './TopBar';
import CommentsDock from './CommentsDock';
import SwipePages from './SwipePages';
import DirectorShotPanel from './DirectorShotPanel';
import AudioDeckPanel from './AudioDeckPanel';
import VideoDeckPanel from './VideoDeckPanel';
import { useIsDesktopViewport } from '../lib/useIsDesktopViewport';

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
  presentSlots,
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
  feedsCollapsed,
  onToggleFeedsCollapsed,
  controlsCollapsed,
  onToggleControlsCollapsed,
}) {
  const otherSlot = role === 'a' ? 'b' : 'a';
  const candidates = tracksForSlot(role);

  const stageRef = useRef(null);
  const draggingRef = useRef(false);
  const [deckHeight, setDeckHeight] = useState(DEFAULT_DECK_HEIGHT);

  // Desktop portrait stage (display-only) -- isDesktop picks which
  // wrapper structure holds the SAME DirectorShotPanel/AudioDeckPanel/
  // VideoDeckPanel instances (see the render below); portraitStageWidth
  // is fed to reactions.css as --portrait-stage-width so the side
  // columns can size themselves off the stage's actual rendered width
  // rather than a naive 100vh-based calc. ResizeObserver (not a resize
  // listener) since .stage-root's own width can change from things
  // other than a window resize -- e.g. the sidebar collapsing/expanding
  // shifts how much space PageShell hands this component.
  const isDesktop = useIsDesktopViewport();
  const [portraitStageWidth, setPortraitStageWidth] = useState(null);
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect?.width;
      if (width) setPortraitStageWidth(width);
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

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
    <div
      className={`stage-root stage-root--performer ${videoFullView ? 'stage-root--maximized' : ''}`}
      ref={stageRef}
      style={portraitStageWidth ? { '--portrait-stage-width': `${portraitStageWidth}px` } : undefined}
    >
      {/* stage-video-area--versus modifier retired in Phase 2 (redesign) --
          it existed only to widen/reshape the phone-box for versus mode,
          which no longer exists (video is always full-bleed now). */}
      <div className="stage-video-area" onClick={onStageClick}>
        {performanceMode === 'versus' ? (
          <SpotlightStage
            activeSlot={activePerformerSlot}
            slots={presentSlots}
            renderSlot={renderSlot}
            onSwitch={role === 'a' ? onSwitchActivePerformer : undefined}
            switching={switchingPerformer}
            collapsed={feedsCollapsed}
            onToggleCollapse={onToggleFeedsCollapsed}
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
        {/* Mobile declutter (post-Stage-5 fix, MULTI_PERFORMER_SPEC.md) --
            this whole row moves to a right-docked column sharing the
            bottom band with the spotlight feeds strip (mobile-only CSS;
            desktop keeps its existing full-width row, untouched). This
            is what removes the mic-cam bar's z-index collision with the
            feeds strip underneath it (the actual switch-tap bug) by
            construction: the two groups no longer occupy the same
            screen space at all, on any axis. --collapsed hides it
            (mobile only) in favor of stage-controls-reveal-tab below;
            the collapse arrow itself only renders/shows on mobile (CSS),
            same convention as .deck-collapse-btn/.comments-collapse-btn. */}
        <div className={`stage-mic-cam ${controlsCollapsed ? 'stage-mic-cam--collapsed' : ''}`}>
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
          <button
            type="button"
            className="stage-controls-collapse-btn"
            onClick={onToggleControlsCollapsed}
            aria-label="hide controls"
          >
            <CaretRight size={14} weight="bold" />
          </button>
        </div>

        {controlsCollapsed && (
          <button
            type="button"
            className="stage-controls-reveal-tab"
            onClick={onToggleControlsCollapsed}
            aria-label="show controls"
          >
            <CaretLeft size={16} weight="bold" />
          </button>
        )}

        {/* Down/up arrow -- collapses/restores the deck below, independent
            of the drag-resize divider (which stays desktop-only and is
            hidden entirely while collapsed, since there's nothing to
            resize). Rendered as its own always-present row rather than
            folded into .deck-divider so it works identically on mobile,
            where the divider itself is hidden. onToggleDeckCollapsed
            (Phase 4) now lives in RoomInner, coordinated with comments/QR
            mutual exclusivity -- see LiveDemo.jsx.
            Desktop portrait stage -- this whole SwipePages deck (SHOTS/
            AUDIO/VIDEO tabs) only renders here on MOBILE now; on desktop
            the exact same DirectorShotPanel/AudioDeckPanel/VideoDeckPanel
            instances render instead in the side columns below, docked as
            separate floating panels instead of tabbed. isDesktop is a
            single render branch (never both at once) specifically
            because DirectorShotPanel/VideoDeckPanel can both act on the
            live room (staccato sequencer, active-performer switch) --
            see lib/useIsDesktopViewport.js for why this is JS-branched
            rather than a pure CSS show/hide of two mounted copies. */}
        {!isDesktop && (
          <>
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
                  // Stage 4's SWITCH tab (ActivePerformerSwitcher) is retired --
                  // superseded by SpotlightStage's own interactive thumbnail
                  // strip (floating on the video itself), which now IS the
                  // switch control for slot 'a'. One row, one meaning, no
                  // duplicate thumbnails between a deck tab and the layout.
                ]}
              />
            </div>
          </>
        )}
      </div>

      {/* Desktop portrait stage -- Shots+Audio docked left, camfeed picker
          docked right, over the blur-fill (reactions.css's
          .desktop-side-column). Same panel components as the mobile deck
          above, same props, just not tabbed -- stacked as separate
          floating panels per the spec, scrollable if content overflows
          the column. Comments and mic/cam controls are NOT relocated
          here (not named in the spec's panel list) -- they stay in their
          existing positions, which now resolve relative to the narrowed
          .stage-root box instead of the full viewport (reactions.css's
          .stage-bottom-overlay desktop override).
          Scope note: "other participating artists' feed thumbnails" in
          Versus shows still render via SpotlightStage's own existing
          thumbnail strip, nested inside the portrait box as it already
          was -- NOT duplicated into this right column. Moving that strip
          out would mean touching SpotlightStage's own internals, which
          this pass deliberately doesn't (it's shared with ViewerStage/
          EgressPage, reused as-is per the approved plan). */}
      {isDesktop && (
        <>
          <div className="desktop-side-column desktop-side-column--left">
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
            <AudioDeckPanel
              nodes={audioNodes}
              audioContext={audioContext}
              showEnded={showEnded}
              showPhase={showPhase}
            />
          </div>
          <div className="desktop-side-column desktop-side-column--right">
            <VideoDeckPanel
              candidates={candidates}
              activeIdentity={activeCamera[role]}
              onPick={(identity) => setActiveForSlot(role, identity)}
            />
          </div>
        </>
      )}

      {/* Comments dock (CommentsDock.jsx, shared with ViewerStage) -- see
          that file for the collapse/reveal-tab pattern and why it's a
          separate always-mounted panel + independently-positioned
          reveal tab rather than one element that hides its own header.
          bottom offset is BroadcastStage-specific (tracks deckHeight,
          the one real difference from ViewerStage's call site), passed
          via style/variant rather than duplicated inside the shared
          component. */}
      <CommentsDock
        variant="broadcast"
        style={{ bottom: (deckCollapsed ? 0 : deckHeight) + MIC_CAM_HEIGHT + (deckCollapsed ? 0 : DECK_DIVIDER_HEIGHT) }}
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
