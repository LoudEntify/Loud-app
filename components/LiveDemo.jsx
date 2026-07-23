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
import '@livekit/components-styles';

import ReactionBar, { GO_LOUD_THRESHOLD } from './ReactionBar';
import SuperReactionPanel from './SuperReactionPanel';
import ReactionStream, { GoLoudBurst } from './ReactionStream';
import VersusSplit from './VersusSplit';
import { createPilotAudioTrack } from '../lib/audioProcessing';
import './reactions.css';

const ROOM_NAME = 'pilot-room';

const REACTION_EMOJI = {
  heart: '\u2764', fire: '\uD83D\uDD25', clap: '\uD83D\uDC4F',
  laugh: '\uD83D\uDE02', plusone: '+1',
  riff: '\uD83C\uDFB8', run: '\u2b06\ufe0f', rap: '\uD83C\uDFA4',
};

// --- Join flow: performance mode first, then role -----------------------

export default function LiveDemo() {
  const [step, setStep] = useState('mode'); // 'mode' | 'role' | 'joined'
  const [performanceMode, setPerformanceMode] = useState(null); // 'solo' | 'versus'
  const [name, setName] = useState('');
  const [role, setRole] = useState('viewer'); // requested role
  const [conn, setConn] = useState(null); // { token, url, assignedRole }
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function handleJoin() {
    setError('');
    setNotice('');
    const contestantRequest = role === 'viewer' ? null : role; // 'a' | 'b' | null
    const identity = contestantRequest
      ? `contestant-${contestantRequest}-${name || Date.now()}`
      : (name || `viewer-${Date.now()}`);
    const contestantParam = contestantRequest ? `&contestant=${contestantRequest}` : '';

    try {
      const res = await fetch(
        `/api/token?room=${ROOM_NAME}&identity=${encodeURIComponent(identity)}${contestantParam}`
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Token request failed');

      if (data.slotTaken) {
        setNotice(`Performer ${contestantRequest?.toUpperCase()} is already in the show -- joining you as a viewer instead.`);
      }

      setConn({ token: data.token, url: data.url, assignedRole: data.assignedRole });
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
          <option value="a">{performanceMode === 'solo' ? 'Performer' : 'Performer A'}</option>
          {performanceMode === 'versus' && <option value="b">Performer B</option>}
        </select>
        <button onClick={handleJoin} style={{ padding: 10 }}>Join</button>
        {error && <p style={{ color: '#e24b4a' }}>{error}</p>}
      </div>
    );
  }

  return (
    <LiveKitRoom
      token={conn.token}
      serverUrl={conn.url}
      connect
      audio={false}
      video={conn.assignedRole === 'a' || conn.assignedRole === 'b'}
      data-lk-theme="default"
      style={{ minHeight: '100vh' }}
    >
      <RoomAudioRenderer />
      <RoomInner performanceMode={performanceMode} role={conn.assignedRole} notice={notice} />
    </LiveKitRoom>
  );
}

// --- Connected room UI -------------------------------------------------

function RoomInner({ performanceMode, role, notice }) {
  const room = useRoomContext();
  const tracks = useTracks([Track.Source.Camera]);
  const streamRef = useRef(null);
  const [goLoudTotal, setGoLoudTotal] = useState(0);
  const [goLoudKey, setGoLoudKey] = useState(null);
  const [superVisible, setSuperVisible] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [left, setLeft] = useState(false);
  const audioHandleRef = useRef(null);

  const isPerformer = role === 'a' || role === 'b';

  // Publish the Case 2 processed audio track for performers only.
  useEffect(() => {
    if (!isPerformer) return;
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
  }, [isPerformer, room]);

  const toggleMic = useCallback(() => {
    const track = audioHandleRef.current?.processedTrack;
    if (!track) return;
    track.enabled = micOn ? false : true;
    setMicOn((v) => !v);
  }, [micOn]);

  const toggleCam = useCallback(async () => {
    await room.localParticipant.setCameraEnabled(camOn ? false : true);
    setCamOn((v) => !v);
  }, [camOn, room]);

  const leaveCall = useCallback(() => {
    room.disconnect();
    setLeft(true);
  }, [room]);

  // Incoming reactions and go-loud taps arrive as data messages.
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
  });

  const sendReaction = useCallback((key) => {
    if (streamRef.current) streamRef.current.push(REACTION_EMOJI[key] || key);
    send(new TextEncoder().encode(JSON.stringify({ type: 'reaction', key })), {});
  }, [send]);

  const sendGoLoud = useCallback(() => {
    send(new TextEncoder().encode(JSON.stringify({ type: 'goloud-tap' })), {});
  }, [send]);

  const trackForContestant = (letter) =>
    tracks.find((t) => t.participant.identity.startsWith(`contestant-${letter}`));

  const renderSlot = (letter) => () => {
    const t = trackForContestant(letter);
    return t ? (
      <VideoTrack trackRef={t} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
    ) : (
      <span>waiting for {performanceMode === 'solo' ? 'performer' : `contestant ${letter}`}...</span>
    );
  };

  if (left) {
    return (
      <div style={{ maxWidth: 400, margin: '60px auto', textAlign: 'center', fontFamily: 'sans-serif' }}>
        <p>You left the show.</p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', padding: 16, fontFamily: 'sans-serif' }}>
      {notice && (
        <p style={{ background: '#2C2C2A', color: '#eee', padding: 8, borderRadius: 8, fontSize: 13 }}>
          {notice}
        </p>
      )}

      <div style={{ position: 'relative', height: 260 }}>
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
      </div>

      {isPerformer && (
        <div className="mic-cam-controls">
          <button className={`control-btn ${!micOn ? 'off' : ''}`} onClick={toggleMic}>
            {micOn ? 'Mute mic' : 'Unmute mic'}
          </button>
          <button className={`control-btn ${!camOn ? 'off' : ''}`} onClick={toggleCam}>
            {camOn ? 'Camera off' : 'Camera on'}
          </button>
          <button className="control-btn" onClick={leaveCall}>Leave</button>
        </div>
      )}

      <ReactionBar
        onReact={sendReaction}
        onSuperToggle={() => setSuperVisible((v) => !v)}
        goLoudCount={goLoudTotal}
        onGoLoud={sendGoLoud}
      />
      <SuperReactionPanel visible={superVisible} onReact={sendReaction} />
    </div>
  );
}
