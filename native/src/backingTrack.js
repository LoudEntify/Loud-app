// The backing track, from the shared transport to the phone.
//
// lib/audio/tracks.js holds the transport, the identity rule, the
// balance and the resample ratio, and the web's panel reads the same
// module. This is the delivery: it decides nothing.
//
// Why the phone decodes the file rather than playing it: the track has
// to reach the BROADCAST. A media player would reach the artist's ears
// and leave the stream with nothing but whatever the microphone picked
// up of it — which is also why headphones are required before a track
// may be cued at all (trackPlaybackAllowed).
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  newTransport, loadTrack, unloadTrack, togglePlay as toggleTransport, seekTo,
  reportPosition, setVolume as setTransportVolume, nativeTrackConfig,
  trackIdentityOk, describeIdentity, trackPlaybackAllowed,
} from '@loud/lib/audio/tracks.js';
import * as LoudCamera from '../modules/loud-camera';
import { DEFAULT_RATE } from './vocalChain';

/** How often to read the playhead back. A transport readout, not a meter. */
export const POLL_MS = 250;

/**
 * One backing track, driven by the shared transport.
 *
 * Every state change goes to the transport first and the native mixer
 * second, so what the screen shows and what the phone plays come from
 * the same object. The native side holds the samples; the transport
 * holds what is meant to be happening to them.
 */
export function useBackingTrack({ captureRate = DEFAULT_RATE } = {}) {
  const [transport, setTransport] = useState(newTransport);
  const [fileRate, setFileRate] = useState(captureRate);
  const [error, setError] = useState(null);
  const [identity, setIdentity] = useState(null);
  const rateRef = useRef(captureRate);

  // Push the transport at the mixer whenever either changes. The ratio
  // travels with it, because a file loaded at a different rate changes
  // it and the native side must never work it out for itself.
  useEffect(() => {
    if (transport.state === 'empty') return;
    LoudCamera.setBackingTrack(
      nativeTrackConfig({ transport, fileRate: rateRef.current, captureRate }),
    ).catch(() => { /* reported through state; never interrupts a show */ });
  }, [transport, captureRate]);

  // Read the playhead back while playing. The native mixer owns the
  // position — it is the thing consuming samples — so the transport
  // follows it rather than counting time itself, which would drift
  // against the audio exactly as a wrong resample ratio would.
  useEffect(() => {
    if (transport.state !== 'playing') return undefined;
    let alive = true;
    const timer = setInterval(async () => {
      try {
        const s = await LoudCamera.backingTrackState();
        if (!alive || !s?.loaded) return;
        setTransport((t) => (t.state === 'playing' ? reportPosition(t, s.positionSeconds) : t));
      } catch { /* a readout that cannot be read shows the last one */ }
    }, POLL_MS);
    return () => { alive = false; clearInterval(timer); };
  }, [transport.state]);

  /**
   * Load a file. `rowHash` and `fileHash` are checked first: a cue sheet
   * is a list of times and times only mean anything against one
   * recording, so a file that is not the one the sheet was written
   * against is refused rather than played (lib/audio/tracks.js).
   */
  const load = useCallback(async ({ path, trackId, rowHash, fileHash, headphones }) => {
    setError(null);

    const allowed = trackPlaybackAllowed({ headphones });
    if (!allowed.ok) { setError(allowed.reason); return { ok: false }; }

    const ident = trackIdentityOk({ rowHash, fileHash });
    setIdentity(ident);
    if (!ident.ok) { setError(describeIdentity(ident)); return { ok: false }; }

    const r = await LoudCamera.loadBackingTrack(path);
    if (!r?.ok) { setError(r?.error || 'We could not read that track.'); return { ok: false }; }

    rateRef.current = r.sampleRate || captureRate;
    setFileRate(rateRef.current);
    // Paused at the start, which is the shared rule: on a phone the
    // track is mixed into the published audio, so one that began on load
    // would go out.
    setTransport(loadTrack(newTransport(), { trackId, durationS: r.durationSeconds || 0 }));
    return { ok: true, warn: allowed.warn };
  }, [captureRate]);

  const unload = useCallback(async () => {
    await LoudCamera.unloadBackingTrack();
    setTransport(unloadTrack);
    setIdentity(null);
    setError(null);
  }, []);

  const togglePlay = useCallback(() => setTransport(toggleTransport), []);
  const setVolume = useCallback((v) => setTransport((t) => setTransportVolume(t, v)), []);

  // A seek has to reach the mixer as a seek rather than as a new
  // position: the native side holds the playhead, so telling it the
  // transport's new position is the only way it moves.
  const seek = useCallback(async (positionS) => {
    setTransport((t) => seekTo(t, positionS));
    await LoudCamera.setBackingTrack({
      ...nativeTrackConfig({ transport: seekTo(transport, positionS), fileRate: rateRef.current, captureRate }),
      seekSeconds: positionS,
    }).catch(() => {});
  }, [transport, captureRate]);

  return { transport, fileRate, error, identity, load, unload, togglePlay, setVolume, seek };
}
