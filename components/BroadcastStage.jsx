'use client';

import { Microphone, MicrophoneSlash, VideoCamera, VideoCameraSlash, PhoneDisconnect } from '@phosphor-icons/react';
import { VideoTrack } from '@livekit/components-react';
import VersusSplit from './VersusSplit';
import TopBar from './TopBar';
import CommentsPanel from './CommentsPanel';

// Desktop performer view -- matches Artist Broadcast.dc.html. Versus shows
// the performer's own multi-cam preview left / opponent right (with the
// drag divider); solo drops the split entirely and shows one full-bleed
// panel. Every handler here is passed straight through from RoomInner --
// no LiveKit calls happen in this file.
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
    <div className="stage-root">
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

        {candidates.length > 1 && (
          <CameraThumbnails
            candidates={candidates}
            activeIdentity={activeCamera[role]}
            slot={role}
            onPick={(identity) => setActiveForSlot(role, identity)}
          />
        )}

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
      </div>

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

// Bottom-left camera-angle picker -- lists every device tagged to this
// performer's own slot (main phone + any extra camfeed devices) so they can
// choose which is live. Manual only, matches the existing DirectorPanel
// behavior, just repositioned/restyled to sit as an overlay.
function CameraThumbnails({ candidates, activeIdentity, slot, onPick }) {
  return (
    <div className="stage-camera-thumbs">
      {candidates.map((t) => {
        const isActive = t.participant.identity === activeIdentity
          || (!activeIdentity && t.participant.identity.startsWith(`contestant-${slot}-`));
        return (
          <button
            key={t.participant.identity}
            onClick={() => onPick(t.participant.identity)}
            className={`camera-thumb ${isActive ? 'btn-active' : ''}`}
          >
            <VideoTrack trackRef={t} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          </button>
        );
      })}
    </div>
  );
}
