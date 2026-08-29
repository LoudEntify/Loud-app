'use client';

// components/AudioHostProvider.jsx
// ─────────────────────────────────────────────────────────────
// TASK 2 — mounted once, at app root, in app/layout.js.
//
// PRD: Director Experience / Live Show    S&I: Real-time media, Database
//
// ── WHY IT LIVES IN THE ROOT LAYOUT ───────────────────────────
// Next.js App Router preserves the root layout across client-side
// navigations. Kit Check reaches the show with `router.push('/live?...')`
// (components/KitCheck.jsx), which is a client navigation — so a
// component mounted here does not unmount on that transition, and
// neither does anything it owns.
//
// That is the whole mechanism. It is also why the fix works for the
// resize/panel-toggle case for free: this component is outside every
// subtree that remounts.
//
// ── IT RENDERS NOTHING ────────────────────────────────────────
// Deliberately. The audio graph is not a visual thing, and giving it
// markup would tempt someone to style it, move it, or conditionally
// render it — and a conditionally rendered audio host is just the
// original bug with extra steps.
//
// ── WHAT IT ACTUALLY DOES ─────────────────────────────────────
// One job beyond existing: while a track is playing, write the playhead
// back to show_session_state every few seconds, so that a device which
// has lost the decoded audio (a hard reload, a second device) can say
// where the artist was. The write is throttled and the reader
// extrapolates between writes (lib/showSessionState.js), so this costs
// one row update per five seconds per playing artist and no smoothness.
// ─────────────────────────────────────────────────────────────

import { useEffect, useRef } from 'react';
import {
  subscribeAudioHost,
  getAudioHost,
  playerPositionMs,
} from '../lib/audioHost';
import { patchSessionState, POSITION_WRITE_INTERVAL_MS } from '../lib/showSessionState';

// Which (show, artist) the playhead belongs to. Set by whichever surface
// knows — the artist console or Kit Check — via setSessionTarget below.
// Module-level for the same reason the host itself is: it must not be
// owned by anything that unmounts.
const target = { showId: null, artistId: null };

/**
 * Tell the host which show/artist row to write the playhead to.
 * Called with nulls to stop reporting (leaving a show, signing out).
 */
export function setSessionTarget(showId, artistId) {
  target.showId = showId || null;
  target.artistId = artistId || null;
}

export function getSessionTarget() {
  return { ...target };
}

export default function AudioHostProvider() {
  // What we last wrote, so an unchanged playhead does not generate a
  // write every interval — a paused track would otherwise produce one
  // pointless row update every five seconds for as long as the tab is
  // open.
  const lastWrittenRef = useRef({ positionMs: null, state: null, hash: null });

  useEffect(() => {
    let cancelled = false;

    async function reportPosition() {
      if (cancelled) return;
      const { showId, artistId } = target;
      if (!showId || !artistId) return;

      const host = getAudioHost();
      if (!host.player) return;

      const positionMs = playerPositionMs();
      if (positionMs === null) return;

      // `playing` is derived from the player rather than from React
      // state, deliberately: React state is the thing that was unreliable
      // and the player is the thing actually making noise.
      const playbackState = host.player.isPlaying?.() ? 'playing'
        : positionMs > 0 ? 'paused'
        : 'stopped';

      const last = lastWrittenRef.current;
      const moved = last.positionMs === null || Math.abs(positionMs - last.positionMs) > 500;
      const changed = playbackState !== last.state || host.trackHash !== last.hash;
      if (!moved && !changed) return;

      lastWrittenRef.current = { positionMs, state: playbackState, hash: host.trackHash };

      await patchSessionState(showId, artistId, {
        position_ms: positionMs,
        playback_state: playbackState,
        position_updated_at: new Date().toISOString(),
        ...(host.trackHash ? { track_hash: host.trackHash, track_name: host.trackName } : {}),
      });
    }

    const timer = setInterval(reportPosition, POSITION_WRITE_INTERVAL_MS);

    // Also write immediately whenever the host itself changes — a track
    // load, a stop, a release. Waiting up to five seconds to record that
    // a different track is now loaded would let a remount in that window
    // resume the wrong one.
    const unsubscribe = subscribeAudioHost(() => { reportPosition(); });

    // And on the way out of the tab, best effort. `pagehide` rather than
    // `beforeunload`: it fires on mobile Safari's back/forward cache path,
    // which `beforeunload` does not.
    const onPageHide = () => { reportPosition(); };
    window.addEventListener('pagehide', onPageHide);

    return () => {
      cancelled = true;
      clearInterval(timer);
      unsubscribe();
      window.removeEventListener('pagehide', onPageHide);
    };
  }, []);

  return null;
}
