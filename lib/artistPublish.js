// The web artist's own camera and microphone, in the show.
//
// ── WHAT THIS FIXES ───────────────────────────────────────────
// components/artist/ConsoleScreen.jsx took the local camera with
// getUserMedia, composed a preview frame and drew it to a canvas. It
// never joined a room. Nothing in components/artist/ imported
// livekit-client at all, so an artist on the new web console was
// watching themselves locally while nothing reached a broadcast — found
// on 7 November and recorded in docs/ONE_JOURNEY.md.
//
// This is the web half of what native/src/ownCamera.js does for the
// phone (PR #40), and it deliberately mirrors it: the same route, the
// same phases, the same wording for a refusal — all from
// lib/publishing.js, so the two positions cannot describe one situation
// differently.
//
// ── THE MICROPHONE IS THE PROCESSED ONE ───────────────────────
// Not the raw stream. createPilotAudioTrack builds the artist's vocal
// chain and returns the track that comes out of it, and that is what is
// published, so what viewers hear is what the artist tuned. The graph is
// handed to lib/audioHost.js rather than held here, because the panels
// (the audio deck, the backing track, the cue editor) are views of that
// host and a graph owned by a component dies with it — the lesson that
// file's own header records, and that I had to learn again on the phone
// this morning.
//
// ── THE TOKEN ─────────────────────────────────────────────────
// /api/performer/join-show, which enforces the show window server-side
// and grants canPublish for that show's room. Nothing here mints or
// widens a grant.
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Room, Track } from 'livekit-client';
import { createPilotAudioTrack } from './audioProcessing';
import { adoptAudioGraph, releaseAudioHost } from './audioHost';
import {
  IDLE, STARTING, LIVE, FAILED, nextPhase, joinFailureMessage,
} from './publishing';

/**
 * Join the show's room and publish this artist's camera and processed
 * microphone.
 *
 * Returns { phase, error, room, nodes, audioContext, start, stop, retry }.
 * `nodes` and `audioContext` are what the capability panels need; the
 * rest is the screen's status line.
 */
export function useArtistPublish({ showId, accessToken, enabled = true } = {}) {
  const [phase, setPhase] = useState(IDLE);
  const [error, setError] = useState(null);
  const [graph, setGraph] = useState(null);
  const roomRef = useRef(null);
  const startingRef = useRef(false);

  const stop = useCallback(async () => {
    startingRef.current = false;
    const room = roomRef.current;
    roomRef.current = null;
    setGraph(null);
    setPhase((p) => nextPhase(p, 'stopped'));
    // The host is released rather than left holding a dead graph: a
    // panel reading a closed AudioContext would throw on a knob turn.
    releaseAudioHost('artist stopped publishing');
    if (room) await room.disconnect().catch(() => {});
  }, []);

  const start = useCallback(async () => {
    if (!showId || !accessToken || !enabled) return;
    if (startingRef.current || roomRef.current) return;
    startingRef.current = true;
    setPhase((p) => nextPhase(p, 'starting'));
    setError(null);

    let joined;
    try {
      const res = await fetch('/api/performer/join-show', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ show_id: showId }),
      });
      joined = await res.json().catch(() => null);
      if (!res.ok || !joined?.livekitToken) {
        startingRef.current = false;
        setPhase((p) => nextPhase(p, 'failed'));
        setError(joinFailureMessage(joined?.error));
        return;
      }
    } catch {
      startingRef.current = false;
      setPhase((p) => nextPhase(p, 'failed'));
      setError(joinFailureMessage(null));
      return;
    }

    let handle = null;
    const room = new Room({ adaptiveStream: true, dynacast: true });
    try {
      await room.connect(joined.url, joined.livekitToken);
      roomRef.current = room;

      // The camera first: a performer with sound and no picture is a
      // worse failure than one with a picture and no sound, and if the
      // chain cannot be built the camera is already out there.
      await room.localParticipant.setCameraEnabled(true);

      // Then the vocal chain, and the track that comes out of it.
      handle = await createPilotAudioTrack();
      await room.localParticipant.publishTrack(handle.processedTrack, {
        source: Track.Source.Microphone,
      });

      // Held outside this hook so the panels outlive any remount.
      adoptAudioGraph(handle);
      setGraph({ nodes: handle.nodes, audioContext: handle.audioContext });
      startingRef.current = false;
      setPhase((p) => nextPhase(p, 'published'));
    } catch (e) {
      startingRef.current = false;
      roomRef.current = null;
      setPhase((p) => nextPhase(p, 'failed'));
      setError(e?.message || 'We could not put your camera in the show.');
      // Everything opened is closed again, in reverse: a half-joined
      // room keeps a participant in the show with nothing to publish,
      // and the egress would compose a slot for it.
      try { handle?.rawStream?.getTracks?.().forEach((t) => t.stop()); } catch { /* already gone */ }
      try { await handle?.audioContext?.close?.(); } catch { /* already closed */ }
      await room.disconnect().catch(() => {});
    }
  }, [showId, accessToken, enabled]);

  const retry = useCallback(async () => { await stop(); await start(); }, [stop, start]);

  // Leaving the console stops publishing. Unlike the backing track —
  // whose samples live outside every component on purpose — a camera
  // that outlived its screen would be a performer in a show with no way
  // to see or stop themselves.
  useEffect(() => () => { stop(); }, [stop]);

  return {
    phase,
    error,
    room: roomRef.current,
    nodes: graph?.nodes || null,
    audioContext: graph?.audioContext || null,
    start,
    stop,
    retry,
  };
}

export { IDLE, STARTING, LIVE, FAILED };
