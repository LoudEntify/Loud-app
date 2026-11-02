// Kit Check's room: every camera in the rig, side by side, before
// anyone is watching.
//
// ── WHY THIS EXISTS ───────────────────────────────────────────
// Kit Check said "Nothing streams" and showed one local viewfinder.
// That was honest about the broadcast and useless for the job: in the
// pilot an artist ran Kit Check to SEE the cameras they had added and
// to set which one the show opens on. The rebuilt screen showed a list
// of checks and a preview of the handset, so a second phone that had
// paired successfully looked exactly like one that had not.
//
// So Kit Check joins the artist's own rehearsal room — the one
// /api/camfeed/pair has minted since the pairing rewrite, with a
// twenty-minute token and canSubscribe — publishes this phone, and
// subscribes to the rest. The pairing route already points a paired
// phone at that room and moves it to the show room at countdown
// (its `migrate` action), so nothing new is invented here: this is the
// room the rig is already in.
//
// ── IT COSTS MONEY, AND THAT IS THE POINT ─────────────────────
// A LiveKit room bills while it is open, so rehearsal is no longer
// free. That is the trade the pilot already made and Korey confirmed
// on 2 Nov: an artist who cannot see their cameras before a show finds
// out during one. The room closes when the screen does.
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { CameraSession } from './cameraSession';
import { api } from './api';

export const REHEARSAL_IDLE = 'idle';
export const REHEARSAL_JOINING = 'joining';
export const REHEARSAL_READY = 'ready';
export const REHEARSAL_FAILED = 'failed';

export function useRehearsalRoom({ accessToken, enabled = true, facing = 'back', orientation = 'portrait' } = {}) {
  const [phase, setPhase] = useState(REHEARSAL_IDLE);
  const [error, setError] = useState(null);
  const [degraded, setDegraded] = useState(false);
  const session = useRef(null);
  const starting = useRef(false);
  const [, setTick] = useState(0);

  const stop = useCallback(async () => {
    starting.current = false;
    const s = session.current;
    session.current = null;
    setPhase(REHEARSAL_IDLE);
    if (s) await s.stop().catch(() => {});
  }, []);

  const start = useCallback(async () => {
    if (!accessToken || !enabled) return;
    if (starting.current || session.current) return;
    starting.current = true;
    setPhase(REHEARSAL_JOINING); setError(null);

    const r = await api('/api/camfeed/pair', { method: 'POST', accessToken, body: { action: 'start' } });
    if (!r.ok || !r.data?.token) {
      starting.current = false;
      setPhase(REHEARSAL_FAILED);
      setError(r.data?.error || 'We could not open your rehearsal room.');
      return;
    }
    setDegraded(Boolean(r.data?.degraded));

    const cam = new CameraSession({
      token: r.data.token,
      url: r.data.url,
      room: r.data.room,
      facing,
      orientation,
      // Rehearsal is for looking at the shot. A microphone open in a
      // room with the artist's own speakers is a feedback loop, and
      // nothing here is being recorded.
      withAudio: false,
      onEvent: (kind) => { if (kind === 'published' || kind === 'state') setTick((n) => n + 1); },
    });

    try {
      await cam.start();
      session.current = cam;
      setPhase(REHEARSAL_READY);
    } catch (e) {
      await cam.stop().catch(() => {});
      setPhase(REHEARSAL_FAILED);
      setError(String(e?.message || e));
    } finally {
      starting.current = false;
    }
  }, [accessToken, enabled, facing, orientation]);

  useEffect(() => {
    if (enabled) start();
    return () => { stop(); };
  }, [enabled, accessToken, facing, orientation]); // eslint-disable-line react-hooks/exhaustive-deps

  // Leaving the screen closes the room; coming back opens it again.
  // A rehearsal room left running in the background is a bill with
  // nobody looking at it.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active' && enabled && !session.current && !starting.current) start();
      if (s !== 'active' && session.current) stop();
    });
    return () => sub.remove();
  }, [enabled, start, stop]);

  return { phase, error, degraded, room: session.current?.room || null, session: session.current, start, stop };
}
