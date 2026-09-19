'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRoomContext } from '@livekit/components-react';
import { RoomEvent } from 'livekit-client';
import { logHealthEvent } from '../lib/healthLog';

// components/ViewerAudioGate.jsx
// ─────────────────────────────────────────────────────────────
// SOUND, AFTER A REFRESH OR A RECONNECT.
//
// PRD: Live Show / Audience · S&I: Real-time media
//
// ── THE BUG THIS EXISTS FOR ───────────────────────────────────
// A viewer who refreshed, or whose connection blipped, lost audio
// permanently. Confirmed on two devices at the 19 September rehearsal.
//
// It is NOT a subscription failure and NOT the item 1 class of problem.
// The audio track is subscribed and arriving. The BROWSER refuses to
// play it, because autoplay with sound requires a user gesture and a
// reloaded page has not had one.
//
// Why it worked on first entry and never after a refresh:
//
//   first visit   the viewer taps through the entry form, which IS a
//                 gesture, and the room connects after it. Audio plays.
//   refresh       the entry is already in localStorage so the form is
//                 skipped, the room connects with ZERO interaction, the
//                 audio element's play() rejects, and nothing retries.
//                 Silent forever.
//
// <RoomAudioRenderer /> attaches the elements. It cannot start blocked
// playback — which is exactly why livekit ships `room.startAudio()`,
// `room.canPlaybackAudio` and RoomEvent.AudioPlaybackStatusChanged, and
// why @livekit/components-react ships a <StartAudio> component. This app
// used RoomAudioRenderer and none of the three.
//
// ── IT IS PER-VIEWER, NOT PER-SHOW ────────────────────────────
// Nothing here touches the publisher. One viewer refreshing cannot
// affect anyone else's sound, which is the test that confirms it:
// refresh one viewer and watch whether the others keep audio.
//
// ── WHY THIS IS NOT THE ITEM 1 PATH ───────────────────────────
// Item 1 works on `activeShot`, matchesTarget and tracksForSlot, all of
// which run over useTracks(STAGE_TRACK_SOURCES) — [Camera, ScreenShare].
// MICROPHONE IS NOT IN THAT LIST. Audio never enters the shot system at
// all, so item 1 neither covered this nor regressed it. Same class of
// failure as August — reconnect-adjacent, silent, never self-heals — at
// a different layer.
// ─────────────────────────────────────────────────────────────

export const AUDIO_DEBUG_ENABLED =
  typeof window !== 'undefined' &&
  (window.location.search.includes('audio=1') || window.location.search.includes('debug=1'));

export default function ViewerAudioGate() {
  const room = useRoomContext();
  const [blocked, setBlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lastError, setLastError] = useState(null);
  const [attempts, setAttempts] = useState(0);

  useEffect(() => {
    if (!room) return undefined;
    const sync = () => {
      // canPlaybackAudio is false when the browser is refusing. It flips
      // to true the moment startAudio() succeeds.
      const can = room.canPlaybackAudio;
      setBlocked(!can);
      logHealthEvent('audio_playback_status', { canPlaybackAudio: !!can });
    };
    sync();
    room.on(RoomEvent.AudioPlaybackStatusChanged, sync);
    // A reconnect re-attaches the elements and can re-block playback, so
    // the same check has to run again on the way back up.
    room.on(RoomEvent.Reconnected, sync);
    room.on(RoomEvent.Connected, sync);
    return () => {
      room.off(RoomEvent.AudioPlaybackStatusChanged, sync);
      room.off(RoomEvent.Reconnected, sync);
      room.off(RoomEvent.Connected, sync);
    };
  }, [room]);

  const enable = useCallback(async () => {
    if (!room) return;
    setBusy(true);
    setAttempts((n) => n + 1);
    try {
      // THE TAP IS THE GESTURE. This is the only moment the browser will
      // accept, which is why it must be driven by a real click and not
      // retried on a timer.
      await room.startAudio();
      setBlocked(!room.canPlaybackAudio);
      setLastError(null);
      logHealthEvent('audio_unblocked', { canPlaybackAudio: !!room.canPlaybackAudio });
    } catch (e) {
      setLastError(String(e?.message || e));
      logHealthEvent('audio_unblock_failed', { detail: String(e?.message || e) });
    } finally {
      setBusy(false);
    }
  }, [room]);

  const remoteAudio = (() => {
    try {
      let subscribed = 0;
      let total = 0;
      room?.remoteParticipants?.forEach((p) => {
        p.audioTrackPublications?.forEach((pub) => {
          total += 1;
          if (pub.isSubscribed) subscribed += 1;
        });
      });
      return { total, subscribed };
    } catch {
      return { total: null, subscribed: null };
    }
  })();

  return (
    <>
      {blocked && (
        // Deliberately loud and centred. A viewer with no sound does not
        // know why, and a subtle control is one they will not find.
        <button
          type="button"
          onClick={enable}
          style={{
            position: 'absolute', left: '50%', top: 16, transform: 'translateX(-50%)',
            zIndex: 60, cursor: busy ? 'wait' : 'pointer', font: 'inherit',
            display: 'inline-flex', alignItems: 'center', gap: 8,
            padding: '11px 18px', borderRadius: 999, border: 'none',
            background: '#e71d36', color: '#fdfffc',
            fontSize: 13, fontWeight: 700, letterSpacing: '0.02em',
            boxShadow: '0 4px 18px rgba(0,0,0,0.35)',
          }}
        >
          <span aria-hidden="true">🔇</span>
          {busy ? 'Turning sound on…' : 'Tap to turn on sound'}
        </button>
      )}

      {AUDIO_DEBUG_ENABLED && (
        <div
          style={{
            position: 'fixed', left: 8, bottom: 8, zIndex: 99999, pointerEvents: 'none',
            background: 'rgba(0,0,0,0.82)', color: '#7CFFB2',
            font: '11px/1.35 ui-monospace, Menlo, monospace',
            padding: '6px 8px', borderRadius: 6, border: '1px solid rgba(124,255,178,0.35)',
          }}
        >
          <div style={{ color: '#fdfffc' }}>AUDIO</div>
          <div>
            canPlayback{' '}
            <span style={{ color: blocked ? '#FF6B6B' : '#7CFFB2' }}>
              {blocked ? 'BLOCKED' : 'ok'}
            </span>
            {' · unblock attempts '}{attempts}
          </div>
          <div>
            remote audio tracks {remoteAudio.total ?? '?'} · subscribed{' '}
            <span style={{ color: remoteAudio.subscribed ? '#7CFFB2' : '#FFD54A' }}>
              {remoteAudio.subscribed ?? '?'}
            </span>
          </div>
          <div style={{ color: '#888' }}>
            {/* This line is the whole diagnosis in one place: subscribed
                but blocked is an autoplay problem, not subscribed is a
                transport problem, and they need different fixes. */}
            {remoteAudio.subscribed > 0 && blocked
              ? 'subscribed but BLOCKED — autoplay, tap the button'
              : remoteAudio.subscribed === 0 && remoteAudio.total > 0
                ? 'published but NOT subscribed — transport'
                : remoteAudio.total === 0
                  ? 'nobody is publishing audio'
                  : 'playing'}
          </div>
          {lastError && <div style={{ color: '#FF6B6B' }}>err: {lastError}</div>}
        </div>
      )}
    </>
  );
}
