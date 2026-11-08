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
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import {
  newTransport, loadTrack, unloadTrack, togglePlay as toggleTransport, seekTo,
  reportPosition, setVolume as setTransportVolume, nativeTrackConfig,
  trackIdentityOk, describeIdentity, trackPlaybackAllowed,
} from '@loud/lib/audio/tracks.js';
import * as LoudCamera from '../modules/loud-camera';
import { DEFAULT_RATE } from './vocalChain';
import {
  subscribeBackingTrack, getBackingTrackHost, getBackingTrackVersion,
  setTransport, setLoadedTrack,
} from './backingTrackHost';

/** How often to read the playhead back. A transport readout, not a meter. */
export const POLL_MS = 250;

/** One empty transport, shared by every view of an unloaded host. */
const EMPTY = newTransport();

/**
 * One backing track, driven by the shared transport.
 *
 * A VIEW of ./backingTrackHost.js, not an owner of it. The samples live
 * in the native module and survive any unmount, so a transport held in
 * component state would leave a track playing into the broadcast while
 * the screen that showed it had forgotten about it — the bug #58 and
 * #62 shipped, which components/BackingTrackPanel.jsx had already fixed
 * on the web and documented in its own header.
 *
 * Every state change goes to the transport first and the native mixer
 * second, so what the screen shows and what the phone plays come from
 * the same object.
 */
export function useBackingTrack({ captureRate = DEFAULT_RATE } = {}) {
  // Subscribed rather than copied: two screens open on the same track
  // see one playhead, and a remount shows what is actually playing.
  useSyncExternalStore(subscribeBackingTrack, getBackingTrackVersion, getBackingTrackVersion);
  const host = getBackingTrackHost();
  // The host holds no definition of "no track": it starts null and the
  // empty transport comes from the shared module, so there is one of it.
  const transport = host.transport || EMPTY;
  const fileRate = host.fileRate ?? captureRate;
  const [error, setError] = useState(null);
  const [identity, setIdentity] = useState(null);

  // Push the transport at the mixer whenever either changes. The ratio
  // travels with it, because a file loaded at a different rate changes
  // it and the native side must never work it out for itself.
  useEffect(() => {
    if (transport.state === 'empty') return;
    LoudCamera.setBackingTrack(
      nativeTrackConfig({ transport, fileRate, captureRate }),
    ).catch(() => { /* reported through state; never interrupts a show */ });
  }, [transport, fileRate, captureRate]);

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

    setLoadedTrack({ trackId, fileRate: r.sampleRate || captureRate });
    // Paused at the start, which is the shared rule: on a phone the
    // track is mixed into the published audio, so one that began on load
    // would go out.
    setTransport(loadTrack(newTransport(), { trackId, durationS: r.durationSeconds || 0 }));
    return { ok: true, warn: allowed.warn };
  }, [captureRate]);

  const unload = useCallback(async () => {
    await LoudCamera.unloadBackingTrack();
    setTransport(unloadTrack);
    setLoadedTrack({});
    setIdentity(null);
    setError(null);
  }, []);

  const togglePlay = useCallback(() => setTransport(toggleTransport), []);
  const setVolume = useCallback((v) => setTransport((t) => setTransportVolume(t, v)), []);

  // A seek has to reach the mixer as a seek rather than as a new
  // position: the native side holds the playhead, so telling it the
  // transport's new position is the only way it moves.
  const seek = useCallback(async (positionS) => {
    const next = setTransport((t) => seekTo(t, positionS));
    await LoudCamera.setBackingTrack({
      ...nativeTrackConfig({ transport: next, fileRate: getBackingTrackHost().fileRate ?? captureRate, captureRate }),
      seekSeconds: positionS,
    }).catch(() => {});
  }, [captureRate]);

  return { transport, fileRate, error, identity, load, unload, togglePlay, setVolume, seek };
}
