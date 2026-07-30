'use client';

import { Microphone, MicrophoneSlash, VideoCamera, VideoCameraSlash, PhoneDisconnect } from '@phosphor-icons/react';
import VersusSplit from './VersusSplit';
import TopBar from './TopBar';
import CommentsPanel from './CommentsPanel';
import PerformerDeck from './PerformerDeck';

// Desktop performer view -- matches Artist Broadcast.dc.html. Versus shows
// the performer's own multi-cam preview left / opponent right (with the
// drag divider); solo drops the split entirely and shows one full-bleed
// panel. Stacked top to bottom below the video: mic/camera row (instant,
// no-menu-diving toggles), then PerformerDeck (audio/video tuning panels).
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

  return (
    <div className="stage-root stage-root--performer">
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

      <PerformerDeck
        audioNodes={audioNodes}
        cameraCandidates={candidates}
        activeCameraIdentity={activeCamera[role]}
        onPickCamera={(identity) => setActiveForSlot(role, identity)}
      />

      <div className="stage-side-panel stage-side-panel--broadcast">
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
