'use client';

import { useEffect, useRef, useState } from 'react';

// components/PreshowAudio.jsx
// ─────────────────────────────────────────────────────────────
// The pre-show loop. Starts 100 minutes before showtime.
//
// PRD: Live Show / Audience
//
// ── MUTED BY DEFAULT, AND THAT IS NOT A COMPROMISE ────────────
// Every browser blocks autoplay WITH SOUND until the user has interacted
// with the page. A player that assumes otherwise does not fail loudly —
// `play()` returns a rejected promise, nothing is heard, and the control
// sits there looking as though it is working. That is the "silent broken
// player" this is built to avoid.
//
// So the track autoplays MUTED, which browsers do allow, and the only
// thing the unmute control has to do is set muted = false on an element
// that is already playing. No second play() attempt, no race, and the
// audio is already buffered and in position when they tap.
//
// ── IT DEGRADES TO NOTHING ────────────────────────────────────
// The file may not exist — it is supplied separately and the homepage
// must never wait on it. Every failure path ends in `ready = false`,
// which renders NOTHING AT ALL: no control, no placeholder, no broken
// icon. A missing track costs atmosphere; a broken player on the arrival
// screen costs the arrival.
//
// Three separate things can go wrong and all of them land there: the
// file 404s, the codec will not decode, or autoplay is refused even
// muted. The last one is real on iOS with Low Power Mode on.
// ─────────────────────────────────────────────────────────────

// Named preshow-loop, NOT countdown.mp3: `.gitignore` carries
// `countdown*.csv` for the health-event captures, and a countdown-named
// asset is one extension away from being silently untracked. The file
// would have been absent from the deployment while looking committed.
const TRACK_SRC = '/preshow-loop.mp3';

/** Music starts this long before showtime. */
export const PRESHOW_AUDIO_LEAD_MS = 100 * 60 * 1000;

export default function PreshowAudio({ msToShowtime }) {
  const audioRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [muted, setMuted] = useState(true);

  // Within the lead window, and not past showtime — at showtime the
  // viewer is being taken into the show and the room's own audio takes
  // over. Two sources playing at once is worse than neither.
  const shouldPlay =
    Number.isFinite(msToShowtime) && msToShowtime > 0 && msToShowtime <= PRESHOW_AUDIO_LEAD_MS;

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return undefined;
    if (!shouldPlay) {
      el.pause();
      return undefined;
    }
    let cancelled = false;
    // Muted, so this is the autoplay browsers permit. A rejection here
    // is still possible (iOS Low Power Mode) and is treated as "no
    // audio on this device" rather than retried — retrying an autoplay
    // refusal does not change the answer and does spam the console.
    el.play().then(
      () => { if (!cancelled) setReady(true); },
      () => { if (!cancelled) setReady(false); },
    );
    return () => { cancelled = true; };
  }, [shouldPlay]);

  const toggle = () => {
    const el = audioRef.current;
    if (!el) return;
    const next = !muted;
    el.muted = next;
    setMuted(next);
    // The tap IS the user gesture, so if autoplay was refused earlier
    // this is the moment it becomes allowed. Unmuting an element that
    // never started would otherwise be silent with the control showing
    // "on" — the exact failure this component exists to avoid.
    if (!next && el.paused) el.play().catch(() => {});
  };

  if (!shouldPlay) return null;

  return (
    <>
      <audio
        ref={audioRef}
        src={TRACK_SRC}
        loop
        muted
        preload="auto"
        // A missing or undecodable file lands here and renders nothing.
        onError={() => setReady(false)}
        onCanPlay={() => setReady(true)}
      />
      {ready && (
        <button
          type="button"
          onClick={toggle}
          aria-label={muted ? 'Turn the music on' : 'Turn the music off'}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            padding: '8px 14px', borderRadius: 999, cursor: 'pointer',
            background: muted ? 'transparent' : 'rgba(46,196,182,0.14)',
            border: '1px solid rgba(253,255,252,0.3)',
            color: '#fdfffc', font: 'inherit', fontSize: 12, letterSpacing: '0.04em',
          }}
        >
          <span aria-hidden="true">{muted ? '🔇' : '🔊'}</span>
          {muted ? 'Turn the music on' : 'Music on'}
        </button>
      )}
    </>
  );
}
