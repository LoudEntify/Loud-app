// The artist's own phone, as a camera in their own show.
//
// ── THE GAP THIS CLOSES ───────────────────────────────────────
// Until now the artist's phone was not a camera at all. The console
// never joined the LiveKit room; its "You" tile was a MediaTile with
// nothing behind it, and the main area said "Not live yet" in words
// because "the console cannot show the composed frame itself". The only
// code that published was native/app/camera.js, the screen a SECOND
// phone lands on after scanning a pairing code.
//
// So an artist with one phone had an empty room. Nothing to compose,
// nothing to send, and no preview anywhere in the artist app — which is
// exactly what the first device test found: no feed on the artist
// screen, and nothing reaching YouTube even with the compositor ready.
// The missing piece was never the egress switch; it was that nobody was
// in the room.
//
// ── WHY A HOOK AND NOT A SCREEN ───────────────────────────────
// Two screens need this and must not each have their own: Kit Check
// (rehearsal, where an artist checks the shot before anyone is
// watching) and the console (the show). Two implementations would be
// two sets of lifecycle bugs around one native camera, and a phone with
// two owners of its camera is how you get a black preview and no error.
//
// ── THE TOKEN ─────────────────────────────────────────────────
// /api/performer/join-show, the same route the web performer uses. It
// enforces the show window server-side and grants canPublish for the
// show's own room. Nothing here mints or widens a grant.
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { CameraSession } from './cameraSession';
import { api } from './api';

export const OWN_CAMERA_IDLE = 'idle';
export const OWN_CAMERA_STARTING = 'starting';
export const OWN_CAMERA_LIVE = 'live';
export const OWN_CAMERA_FAILED = 'failed';

/**
 * @param showId        the show whose room to join
 * @param accessToken   the artist's session
 * @param enabled       false keeps the camera off (a viewer, or a show
 *                      the artist is not performing in)
 * @param facing        'back' | 'front'
 * @param orientation   the show's orientation, for the upright plan
 *
 * Returns { phase, error, session, track, status, start, stop, retry }.
 * `session` and `track` are what a preview needs; everything else is the
 * screen's status line.
 */
export function useOwnCamera({ showId, accessToken, enabled = true, facing = 'back', orientation = 'portrait' } = {}) {
  const [phase, setPhase] = useState(OWN_CAMERA_IDLE);
  const [error, setError] = useState(null);
  const [track, setTrack] = useState(null);
  const [status, setStatus] = useState(null);
  // Whether the microphone is going out. A show with a picture and no
  // sound is a bad show, and the artist should be told rather than find
  // out afterwards.
  const [audio, setAudio] = useState(false);
  const session = useRef(null);
  // Guards a second start while the first is still connecting. Two
  // CameraSessions against one native camera is the black-preview bug.
  const starting = useRef(false);

  const stop = useCallback(async () => {
    starting.current = false;
    const s = session.current;
    session.current = null;
    setTrack(null); setStatus(null); setAudio(false); setPhase(OWN_CAMERA_IDLE);
    if (s) await s.stop().catch(() => {});
  }, []);

  const start = useCallback(async () => {
    if (!showId || !accessToken || !enabled) return;
    if (starting.current || session.current) return;
    starting.current = true;
    setPhase(OWN_CAMERA_STARTING); setError(null);

    const join = await api('/api/performer/join-show', { method: 'POST', accessToken, body: { show_id: showId } });
    if (!join.ok || !join.data?.livekitToken) {
      starting.current = false;
      setPhase(OWN_CAMERA_FAILED);
      // join-show says why in plain words — too early, window closed,
      // not your show — and those are better than anything invented here.
      setError(join.data?.error || 'We could not put your camera in the show.');
      return;
    }

    const cam = new CameraSession({
      token: join.data.livekitToken,
      url: join.data.url,
      room: join.data.roomName,
      facing,
      orientation,
      // The artist's own phone carries the sound. A paired camera on a
      // stand does not: its microphone would add room noise and echo to
      // a mix that already has the performer in it.
      withAudio: true,
      onEvent: (kind, payload) => {
        if (kind === 'published') { setTrack(payload?.trackSid || true); setPhase(OWN_CAMERA_LIVE); }
        if (kind === 'state') setStatus(cam.status());
        if (kind === 'audio') setAudio(Boolean(payload?.on));
        // A warning is the camera telling the artist something about the
        // shot — the phone on its side, a frame rate it could not hold —
        // and it must not read as a failure, because the camera is running.
        if (kind === 'error') { setPhase(OWN_CAMERA_FAILED); setError(String(payload?.message || payload || 'The camera stopped.')); }
      },
    });

    try {
      await cam.start();
      session.current = cam;
    } catch (e) {
      await cam.stop().catch(() => {});
      setPhase(OWN_CAMERA_FAILED);
      setError(String(e?.message || e));
    } finally {
      starting.current = false;
    }
  }, [showId, accessToken, enabled, facing, orientation]);

  useEffect(() => {
    if (enabled) start();
    return () => { stop(); };
    // start/stop are stable per input; re-running on every render would
    // tear the camera down mid-show.
  }, [enabled, showId, accessToken, facing, orientation]); // eslint-disable-line react-hooks/exhaustive-deps

  // Android reclaims the camera when the app goes to the background, and
  // comes back with a dead track rather than an error. Restarting on
  // return is the difference between an artist glancing at a message and
  // an artist whose show quietly stopped sending.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active' && enabled && !session.current && !starting.current) start();
    });
    return () => sub.remove();
  }, [enabled, start]);

  return { phase, error, session: session.current, track, status, audio, start, stop, retry: () => { stop().then(start); } };
}
