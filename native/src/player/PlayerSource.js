// native/src/player/PlayerSource.js — the same PlayerSource contract as the
// web (lib/player/PlayerSource.js), with two native implementations:
//   youtube  react-native-youtube-iframe (a WebView on youtube-nocookie),
//            which exposes getCurrentTime() for the playback position
//   fixture  a plain view with a running clock (seeded shows, tests)
// Screens render <Player show={...} apiRef={...} /> and never care which.
import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { View, Text } from 'react-native';
import YoutubePlayer from 'react-native-youtube-iframe';
import { color } from '../shared';

export const DELIVERY_KINDS = ['youtube', 'loudentify-llhls', 'fixture'];

const YouTubeSource = forwardRef(function YouTubeSource({ show, width, height, onState }, ref) {
  const player = useRef(null);
  useImperativeHandle(ref, () => ({
    kind: 'youtube',
    async positionMs() { try { const t = await player.current?.getCurrentTime?.(); return Number.isFinite(t) ? Math.round(t * 1000) : null; } catch { return null; } },
  }), []);
  return (
    <YoutubePlayer ref={player} width={width} height={height} play videoId={show.youtube_video_id} webViewProps={{ allowsInlineMediaPlayback: true }}
      baseUrlOverride="https://www.youtube-nocookie.com" initialPlayerParams={{ modestbranding: true, rel: false, controls: true }}
      onReady={() => onState?.('ready')} onChangeState={(s) => onState?.(s === 'playing' ? 'playing' : s === 'paused' ? 'paused' : s === 'buffering' ? 'buffering' : s === 'ended' ? 'ended' : 'ready')} onError={() => onState?.('error')} />
  );
});

const FixtureSource = forwardRef(function FixtureSource({ show, width, height, onState }, ref) {
  const [start] = useState(Date.now()); const [now, setNow] = useState(Date.now());
  useEffect(() => { onState?.('playing'); const t = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(t); }, [onState]);
  useImperativeHandle(ref, () => ({ kind: 'fixture', async positionMs() { return Date.now() - start; } }), [start]);
  const s = Math.floor((now - start) / 1000);
  return (
    <View style={{ width, height, backgroundColor: color.inkDeep, alignItems: 'center', justifyContent: 'center' }} accessibilityLabel="Fixture player">
      <Text style={{ color: color.porcelain, fontSize: 12, fontWeight: '700', position: 'absolute', left: 8, top: 8 }}>LOUDENTIFY</Text>
      <Text style={{ color: 'rgba(253,255,252,0.85)', fontSize: 40, fontWeight: '700' }}>{Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')}</Text>
      <Text style={{ color: 'rgba(253,255,252,0.7)', fontSize: 12 }}>FIXTURE · {show.title}</Text>
    </View>
  );
});

export const Player = forwardRef(function Player({ show, width, height, onState }, ref) {
  const kind = show?.delivery || 'youtube';
  if (kind === 'fixture') return <FixtureSource ref={ref} show={show} width={width} height={height} onState={onState} />;
  if (kind === 'loudentify-llhls') return <View style={{ width, height, backgroundColor: color.inkDeep, alignItems: 'center', justifyContent: 'center', padding: 12 }}><Text style={{ color: color.porcelain, textAlign: 'center' }}>Loudentify's own delivery is not switched on yet.</Text></View>;
  return <YouTubeSource ref={ref} show={show} width={width} height={height} onState={onState} />;
});
