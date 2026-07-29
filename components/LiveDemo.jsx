'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  LiveKitRoom,
  RoomAudioRenderer,
  VideoTrack,
  useTracks,
  useDataChannel,
  useRoomContext,
} from '@livekit/components-react';
import { Track } from 'livekit-client';
import { Microphone, MicrophoneSlash, VideoCamera, VideoCameraSlash, PhoneDisconnect } from '@phosphor-icons/react';
import '@livekit/components-styles';

import ReactionBar, { GO_LOUD_THRESHOLD } from './ReactionBar';
import SuperReactionPanel from './SuperReactionPanel';
import ReactionStream, { GoLoudBurst } from './ReactionStream';
import VersusSplit from './VersusSplit';
import CommentsPanel from './CommentsPanel';
import { createPilotAudioTrack } from '../lib/audioProcessing';
import './reactions.css';

const ROOM_NAME = 'pilot-room';

const REACTION_EMOJI = {
  heart: '\u2764', fire: '\uD83D\uDD25', clap: '\uD83D\uDC4F',
  laugh: '\uD83D\uDE02', plusone: '+1',
  riff: '\uD83C\uDFB8', run: '\u2b06\ufe0f', rap: '\uD83C\uDFA4',
};

const trackKey = (t) => t ? `${t.participant.identity}:${t.publication?.trackSid || ''}` : null;

// A single video layer that fades itself in on mount. Stacking one of
// these per recent track (see CrossfadeVideo) is what produces the
// dissolve -- the old layer stays fully visible underneath while the new
// one fades in on top, so there's never a dark/empty frame between them.
function FadeLayer({ trackRef, placeholder }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div style={{ position: 'absolute', inset: 0, opacity: visible ? 1 : 0, transition: 'opacity 400ms ease' }}>
      {trackRef ? (
        <VideoTrack trackRef={trackRef} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : placeholder}
    </div>
  );
}

// Renders whichever track is "current" for a slot, but keeps the previous
// track mounted just long enough to crossfade into the new one instead of
// hard-cutting (which is what caused the dark flash during camera
// switches). Only the two most recent layers ever exist at once.
function CrossfadeVideo({ trackRef, placeholder }) {
  const [layers, setLayers] = useState(() => (trackRef ? [{ key: 'init', trackRef }] : []));
  const currentKeyRef = useRef(trackKey(trackRef));

  useEffect(() => {
    const newKey = trackKey(trackRef);
    if (newKey === currentKeyRef.current) return;
    currentKeyRef.current = newKey;
    const layerKey = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setLayers((prev) => [...prev, { key: layerKey, trackRef }]);
    const timer = setTimeout(() => {
      setLayers((prev) => prev.slice(-1));
    }, 450); // slightly longer than the 400ms fade so it never clips
    return () => clearTimeout(timer);
  }, [trackRef]);

  if (layers.length === 0) return placeholder;

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
      {layers.map((l) => (
        <FadeLayer key={l.key} trackRef={l.trackRef} placeholder={placeholder} />
      ))}
    </div>
  );
}

// --- Join flow: performance mode first, then role -----------------------
// PRD ref: Multi-Camera & Production (Artist, Should/Phase 2).
// Scaling ref: Real-time video/audio -- camera feeds are just additional
// LiveKit participants in the same room; no architecture change needed,
// this scales the same way the rest of the room does.

export default function LiveDemo() {
  const [step, setStep] = useState('mode');
  const [performanceMode, setPerformanceMode] = useState(null);
  const [name, setName] = useState('');
  const [role, setRole] = useState('viewer'); // 'viewer' | 'a' | 'b' | 'camfeed-a' | 'camfeed-b'
  const [conn, setConn] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function handleJoin() {
    setError('');
    setNotice('');

    const isCamFeed = role.startsWith('camfeed-');
    const contestantRequest = (!isCamFeed && role !== 'viewer') ? role : null;
    const camfeedSlot = isCamFeed ? role.split('-')[1] : null;

    let identity;
    let extraParam = '';
    if (contestantRequest) {
      identity = `contestant-${contestantRequest}-${name || Date.now()}`;
      extraParam = `&contestant=${contestantRequest}`;
    } else if (camfeedSlot) {
      identity = `camfeed-${camfeedSlot}-${Date.now()}-${name || 'cam'}`;
      extraParam = `&camfeed=${camfeedSlot}`;
    } else {
      identity = name || `viewer-${Date.now()}`;
    }

    try {
      const res = await fetch(
        `/api/token?room=${ROOM_NAME}&identity=${encodeURIComponent(identity)}${extraParam}`
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Token request failed');

      if (data.slotTaken) {
        setNotice(`Performer ${contestantRequest?.toUpperCase()} is already in the show -- joining you as a viewer instead.`);
      }

      setConn({ token: data.token, url: data.url, assignedRole: data.assignedRole, name: name || 'guest' });
      setStep('joined');
    } catch (e) {
      setError(e.message);
    }
  }

  if (step === 'mode') {
    return (
      <div style={{ maxWidth: 400, margin: '60px auto', display: 'flex', flexDirection: 'column', gap: 12, fontFamily: 'sans-serif' }}>
        <h2>Pilot show</h2>
        <p style={{ color: '#888780', fontSize: 14 }}>Is this a solo performance or a versus matchup?</p>
        <button onClick={() => { setPerformanceMode('solo'); setStep('role'); }} style={{ padding: 12 }}>Solo</button>
        <button onClick={() => { setPerformanceMode('versus'); setStep('role'); }} style={{ padding: 12 }}>Versus</button>
      </div>
    );
  }

  if (step === 'role') {
    return (
      <div style={{ maxWidth: 400, margin: '60px auto', display: 'flex', flexDirection: 'column', gap: 12, fontFamily: 'sans-serif' }}>
        <h2>Join {performanceMode === 'solo' ? 'solo show' : 'versus show'}</h2>
        <input
          placeholder="your name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ padding: 8 }}
        />
        <select value={role} onChange={(e) => setRole(e.target.value)} style={{ padding: 8 }}>
          <option value="viewer">Viewer</option>
          <option value="a">{performanceMode === 'solo' ? 'Performer (main phone)' : 'Performer A (main phone)'}</option>
          {performanceMode === 'versus' && <option value="b">Performer B (main phone)</option>}
          <option value="camfeed-a">{performanceMode === 'solo' ? 'Extra camera' : 'Extra camera -- side A'}</option>
          {performanceMode === 'versus' && <option value="camfeed-b">Extra camera -- side B</option>}
        </select>
        <button onClick={handleJoin} style={{ padding: 10 }}>Join</button>
        {error && <p style={{ color: '#e24b4a' }}>{error}</p>}
      </div>
    );
  }

  const isCamFeedRole = conn.assignedRole?.startsWith('camfeed-');
  const publishesVideo = conn.assignedRole === 'a' || conn.assignedRole === 'b' || isCamFeedRole;

  return (
    <LiveKitRoom
      token={conn.token}
      serverUrl={conn.url}
      connect
      audio={false}
      video={publishesVideo}
      data-lk-theme="default"
      style={{ minHeight: '100vh' }}
    >
      <RoomAudioRenderer />
      <RoomInner performanceMode={performanceMode} role={conn.assignedRole} notice={notice} selfName={conn.name} />
    </LiveKitRoom>
  );
}

// --- Connected room UI -------------------------------------------------

function RoomInner({ performanceMode, role, notice, selfName }) {
  const room = useRoomContext();
  const tracks = useTracks([Track.Source.Camera]);
  const streamRef = useRef(null);
  const [goLoudTotal, setGoLoudTotal] = useState(0);
  const [goLoudKey, setGoLoudKey] = useState(null);
  const [superVisible, setSuperVisible] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [left, setLeft] = useState(false);
  const [comments, setComments] = useState([]);
  const [commentsExpanded, setCommentsExpanded] = useState(false);
  const [activeCamera, setActiveCamera] = useState({ a: null, b: null }); // slot -> identity of the live feed
  const audioHandleRef = useRef(null);

  const isMainPerformer = role === 'a' || role === 'b';
  const isCamFeed = typeof role === 'string' && role.startsWith('camfeed-');
  const camFeedSlot = isCamFeed ? role.split('-')[1] : null;
  const isPerformer = isMainPerformer || isCamFeed;

  // Only the main performer publishes the Case 2 processed audio track.
  // Extra camera-feed devices are video-only, never audio.
  useEffect(() => {
    if (!isMainPerformer) return;
    (async () => {
      const handle = await createPilotAudioTrack();
      audioHandleRef.current = handle;
      await room.localParticipant.publishTrack(handle.processedTrack, {
        source: Track.Source.Microphone,
      });
    })();
    return () => {
      if (audioHandleRef.current) {
        room.localParticipant.unpublishTrack(audioHandleRef.current.processedTrack);
      }
    };
  }, [isMainPerformer, room]);

  const toggleMic = useCallback(() => {
    const track = audioHandleRef.current?.processedTrack;
    if (!track) return;
    track.enabled = !micOn;
    setMicOn((v) => !v);
  }, [micOn]);

  const toggleCam = useCallback(async () => {
    await room.localParticipant.setCameraEnabled(!camOn);
    setCamOn((v) => !v);
  }, [camOn, room]);

  const leaveCall = useCallback(() => {
    room.disconnect();
    setLeft(true);
  }, [room]);

  // Reactions, go-loud, comments, and camera-switch signals all travel as
  // data messages, distinguished by `type`. Camera-feed devices have
  // canPublishData: false server-side, so they never send any of these --
  // they can still receive, which is harmless and unused by their UI.
  const { send } = useDataChannel((msg) => {
    const text = new TextDecoder().decode(msg.payload);
    let payload;
    try { payload = JSON.parse(text); } catch { return; }

    if (payload.type === 'reaction' && streamRef.current) {
      streamRef.current.push(REACTION_EMOJI[payload.key] || payload.key);
    }
    if (payload.type === 'goloud-tap') {
      setGoLoudTotal((prev) => {
        const next = prev + 1;
        if (next >= GO_LOUD_THRESHOLD) {
          setGoLoudKey(Date.now());
          return 0;
        }
        return next;
      });
    }
    if (payload.type === 'comment') {
      setComments((prev) => [...prev, payload.comment]);
    }
    if (payload.type === 'active-camera') {
      setActiveCamera((prev) => ({ ...prev, [payload.slot]: payload.identity }));
    }
  });

  const sendReaction = useCallback((key) => {
    if (streamRef.current) streamRef.current.push(REACTION_EMOJI[key] || key);
    send(new TextEncoder().encode(JSON.stringify({ type: 'reaction', key })), {});
  }, [send]);

  const sendGoLoud = useCallback(() => {
    send(new TextEncoder().encode(JSON.stringify({ type: 'goloud-tap' })), {});
  }, [send]);

  const sendComment = useCallback((text, replyTarget) => {
    const comment = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      author: selfName,
      text,
      replyMode: replyTarget?.mode || null,
      replyAuthor: replyTarget?.author || null,
      quoteText: replyTarget?.mode === 'quote' ? replyTarget.text : null,
    };
    setComments((prev) => [...prev, comment]);
    send(new TextEncoder().encode(JSON.stringify({ type: 'comment', comment })), {});
  }, [send, selfName]);

  // All video tracks (main performer + any extra camera feeds) tagged to a
  // given slot, for the director panel to list and for the audience view
  // to pick the currently-active one from.
  const tracksForSlot = useCallback((letter) =>
    tracks.filter((t) =>
      t.participant.identity.startsWith(`contestant-${letter}-`) ||
      t.participant.identity.startsWith(`camfeed-${letter}-`)
    ), [tracks]);

  const setActiveForSlot = useCallback((letter, identity) => {
    setActiveCamera((prev) => ({ ...prev, [letter]: identity }));
    send(new TextEncoder().encode(JSON.stringify({ type: 'active-camera', slot: letter, identity })), {});
  }, [send]);

  const renderSlot = (letter) => () => {
    const candidates = tracksForSlot(letter);
    const activeId = activeCamera[letter];
    const chosen = (activeId && candidates.find((t) => t.participant.identity === activeId))
      || candidates.find((t) => t.participant.identity.startsWith(`contestant-${letter}-`))
      || candidates[0];
    const placeholder = <span>waiting for {performanceMode === 'solo' ? 'performer' : `contestant ${letter}`}...</span>;
    return <CrossfadeVideo trackRef={chosen} placeholder={placeholder} />;
  };

  if (left) {
    return (
      <div style={{ maxWidth: 400, margin: '60px auto', textAlign: 'center', fontFamily: 'sans-serif' }}>
        <p>You left the show.</p>
      </div>
    );
  }

  // Camera-feed devices get a minimal screen: their own preview, a camera
  // toggle, and leave. They are not part of the audience-facing layout and
  // don't see comments/stickers (they have no publish-data permission).
  if (isCamFeed) {
    const myTrack = tracks.find((t) => t.participant.identity === room.localParticipant.identity);
    return (
      <div style={{ maxWidth: 400, margin: '40px auto', textAlign: 'center', fontFamily: 'sans-serif' }}>
        <h3>Camera feed -- side {camFeedSlot?.toUpperCase()}</h3>
        <p style={{ color: '#888780', fontSize: 13 }}>Keep this open and propped in place. The performer picks when this shot goes live.</p>
        <div style={{ position: 'relative', height: 220, background: '#2C2C2A', borderRadius: 12, overflow: 'hidden' }}>
          {myTrack ? (
            <VideoTrack trackRef={myTrack} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <span>starting camera...</span>
          )}
        </div>
        <div className="mic-cam-controls">
          <button className={`control-btn ${!camOn ? 'off' : ''}`} onClick={toggleCam}>
            {camOn ? <VideoCamera size={16} weight="bold" /> : <VideoCameraSlash size={16} weight="bold" />}
            {camOn ? 'Camera off' : 'Camera on'}
          </button>
          <button className="control-btn" onClick={leaveCall}>
            <PhoneDisconnect size={16} weight="bold" /> Leave
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', fontFamily: 'sans-serif', display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <div style={{ padding: '0 16px' }}>
        {notice && (
          <p style={{ background: '#2C2C2A', color: '#eee', padding: 8, borderRadius: 8, fontSize: 13 }}>
            {notice}
          </p>
        )}

        <div
          style={{ position: 'relative', height: 260 }}
          onClick={() => commentsExpanded && setCommentsExpanded(false)}
        >
          <VersusSplit
            mode={performanceMode}
            renderA={renderSlot('a')}
            renderB={renderSlot('b')}
            onReactA={sendReaction}
            onReactB={sendReaction}
          />
          <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
            <ReactionStream streamRef={streamRef} />
            <GoLoudBurst triggerKey={goLoudKey} />
          </div>
          {isMainPerformer && (
            <button className="leave-btn-floating" onClick={leaveCall} aria-label="leave call">
              <PhoneDisconnect size={20} weight="bold" />
            </button>
          )}
        </div>

        {isMainPerformer && (
          <div className="mic-cam-controls">
            <button className={`control-btn ${!micOn ? 'off' : ''}`} onClick={toggleMic}>
              {micOn ? <Microphone size={16} weight="bold" /> : <MicrophoneSlash size={16} weight="bold" />}
              {micOn ? 'Mute mic' : 'Unmute mic'}
            </button>
            <button className={`control-btn ${!camOn ? 'off' : ''}`} onClick={toggleCam}>
              {camOn ? <VideoCamera size={16} weight="bold" /> : <VideoCameraSlash size={16} weight="bold" />}
              {camOn ? 'Camera off' : 'Camera on'}
            </button>
          </div>
        )}

        {/* Director control -- only the main performer for this slot sees
            it, and only lists feeds tagged to their own slot. */}
        {isMainPerformer && (
          <DirectorPanel
            slot={role}
            candidates={tracksForSlot(role)}
            activeIdentity={activeCamera[role]}
            onPick={(identity) => setActiveForSlot(role, identity)}
          />
        )}

        {/* Stickers are fan-only -- performers (main or camera feed) get
            the production/comments panel instead. */}
        {!isPerformer && (
          <>
            <ReactionBar
              onReact={sendReaction}
              onSuperToggle={() => setSuperVisible((v) => !v)}
              goLoudCount={goLoudTotal}
              onGoLoud={sendGoLoud}
            />
            <SuperReactionPanel visible={superVisible} onReact={sendReaction} />
          </>
        )}
      </div>

      <div style={{ flex: 1, minHeight: 0 }}>
        <CommentsPanel
          comments={comments}
          onSend={sendComment}
          expanded={commentsExpanded}
          onExpand={() => setCommentsExpanded(true)}
          onCollapse={() => setCommentsExpanded(false)}
        />
      </div>
    </div>
  );
}

// Small thumbnail row letting the main performer pick which of their own
// camera feeds (main phone + any extra cameras) is currently live to the
// audience. Manual only -- no auto-director in this build (see PRD:
// Multi-Camera & Production, auto-director rows are Won't now/Future).
function DirectorPanel({ slot, candidates, activeIdentity, onPick }) {
  if (candidates.length <= 1) return null;
  return (
    <div style={{ padding: '8px 0' }}>
      <p style={{ fontSize: 12, color: '#888780', margin: '0 0 6px' }}>Choose your live shot ({candidates.length} camera{candidates.length > 1 ? 's' : ''} connected)</p>
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto' }}>
        {candidates.map((t) => {
          const isActive = t.participant.identity === activeIdentity
            || (!activeIdentity && t.participant.identity.startsWith(`contestant-${slot}-`));
          return (
            <button
              key={t.participant.identity}
              onClick={() => onPick(t.participant.identity)}
              className={isActive ? 'btn-active' : ''}
              style={{
                width: 72, height: 54, borderRadius: 8, overflow: 'hidden', padding: 0,
                background: '#2C2C2A', cursor: 'pointer', flexShrink: 0,
              }}
            >
              <VideoTrack trackRef={t} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
