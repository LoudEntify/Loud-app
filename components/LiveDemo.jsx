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

// --- Join screen -----------------------------------------------------

export default function LiveDemo() {
  const [joined, setJoined] = useState(false);
  const [name, setName] = useState('');
  const [role, setRole] = useState('viewer'); // 'viewer' | 'a' | 'b'
  const [conn, setConn] = useState(null); // { token, url }
  const [error, setError] = useState('');

  async function handleJoin() {
    setError('');
    const identity = role === 'viewer'
      ? (name || `viewer-${Date.now()}`)
      : `contestant-${role}-${name || Date.now()}`;
    const contestantParam = role === 'viewer' ? '' : `&contestant=${role}`;
    try {
      const res = await fetch(
        `/api/token?room=${ROOM_NAME}&identity=${encodeURIComponent(identity)}${contestantParam}`
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Token request failed');
      setConn({ token: data.token, url: data.url });
      setJoined(true);
    } catch (e) {
      setError(e.message);
    }
  }

  if (!joined) {
    return (
      <div style={{ maxWidth: 400, margin: '60px auto', display: 'flex', flexDirection: 'column', gap: 12, fontFamily: 'sans-serif' }}>
        <h2>Join pilot room</h2>
        <input
          placeholder="your name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ padding: 8 }}
        />
        <select value={role} onChange={(e) => setRole(e.target.value)} style={{ padding: 8 }}>
          <option value="viewer">Viewer</option>
          <option value="a">Performer A</option>
          <option value="b">Performer B</option>
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
      video={role !== 'viewer'}
      data-lk-theme="default"
      style={{ minHeight: '100vh' }}
    >
      <RoomAudioRenderer />
      <RoomInner role={role} />
    </LiveKitRoom>
  );
}

// --- Connected room UI -------------------------------------------------

function RoomInner({ role }) {
  const room = useRoomContext();
  const tracks = useTracks([Track.Source.Camera]);
  const streamRef = useRef(null);
  const [goLoudTotal, setGoLoudTotal] = useState(0);
  const [goLoudKey, setGoLoudKey] = useState(null);
  const [superVisible, setSuperVisible] = useState(false);

  // Publish the Case 2 processed audio track for performers only.
  useEffect(() => {
    if (role !== 'a' && role !== 'b') return;
    let handle;
    (async () => {
      handle = await createPilotAudioTrack();
      await room.localParticipant.publishTrack(handle.processedTrack, {
        source: Track.Source.Microphone,
      });
    })();
    return () => {
      if (handle) {
        room.localParticipant.unpublishTrack(handle.processedTrack);
      }
    };
  }, [role, room]);

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
      <span>waiting for contestant {letter}...</span>
    );
  };

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', padding: 16, fontFamily: 'sans-serif' }}>
      <div style={{ position: 'relative', height: 260 }}>
        <VersusSplit
          mode="versus"
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
