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
//
// ── TASK 3 — THE POLLER IS NO LONGER THE ONLY WRITER ──────────
// Item E from round 1. A five-second poll is the right shape for a
// playhead that is merely advancing, and the wrong shape for the moment
// it STOPS advancing: a pause recorded up to five seconds late is a row
// that says 'playing' about a deck that is silent, and anything reading
// it in that window (a remount, a second device) extrapolates a playhead
// that is not moving. Position drift is invisible; a wrong state is not.
//
// So there are now three writers, in order of how much they matter:
//
//   1. TRANSITIONS — play/pause/stop/seek/end, pushed by the player the
//      instant they happen (lib/audioHost.js's transition channel).
//      This is the fix.
//   2. THE POLL — unchanged, every POSITION_WRITE_INTERVAL_MS, and still
//      the only thing that keeps position_ms current DURING playback.
//   3. PAGE TEARDOWN — pagehide and the tab going hidden, written with
//      `keepalive` so the request survives the page that issued it.
//
// All three funnel through one reportPosition() with one dedupe rule, so
// three writers cannot mean three different opinions about what the row
// should say.
// ─────────────────────────────────────────────────────────────

import { useEffect, useRef } from 'react';
import {
  subscribeAudioHost,
  subscribeAudioTransitions,
  getAudioHost,
  playerPositionMs,
} from '../lib/audioHost';
import {
  patchSessionState,
  patchSessionStateBeacon,
  primeSessionToken,
  POSITION_WRITE_INTERVAL_MS,
} from '../lib/showSessionState';
import { logHealthEvent } from '../lib/healthLog';

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

    // The access token the teardown write needs. Cached ahead of time,
    // deliberately: see the note on patchSessionStateBeacon — at pagehide
    // there is no time to await a session lookup.
    primeSessionToken();

    /**
     * Write the deck's current state to the row.
     *
     * @param reason  why this fired — 'poll' | a transition kind | 'host'
     *                | 'pagehide' | 'hidden'. Carried into telemetry only.
     * @param teardown the page is going away: skip the dedupe and send the
     *                 request by a route that can outlive this document.
     */
    function reportPosition(reason = 'poll', teardown = false) {
      if (cancelled && !teardown) return;
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
      // The dedupe is what stops a paused deck writing a row every five
      // seconds for as long as the tab is open. It is skipped on teardown
      // and only there: this is the last write this page will ever make,
      // and the cost of one redundant row update is nothing against the
      // cost of the row being wrong until the artist comes back.
      if (!teardown && !moved && !changed) return;

      lastWrittenRef.current = { positionMs, state: playbackState, hash: host.trackHash };

      const patch = {
        position_ms: positionMs,
        playback_state: playbackState,
        position_updated_at: new Date().toISOString(),
        ...(host.trackHash ? { track_hash: host.trackHash, track_name: host.trackName } : {}),
      };

      if (teardown) {
        // Nothing is awaited here, and nothing may be: the whole point is
        // that the request is handed to the browser before this document
        // stops running. See patchSessionStateBeacon.
        const sent = patchSessionStateBeacon(showId, artistId, patch);
        logHealthEvent('session_state_teardown_write', {
          reason, sent: sent.ok, why: sent.ok ? null : sent.reason,
          playbackState, positionMs,
        });
        return;
      }

      // Transitions are logged, the poll is not. The poll firing is not
      // information — it fires every five seconds by construction — but
      // "the row learned about this pause N ms after the tap" is exactly
      // the thing this task claims to fix, and the CSV should be able to
      // show it rather than being taken on trust.
      if (reason !== 'poll') {
        logHealthEvent('deck_transition', { reason, playbackState, positionMs });
      }

      patchSessionState(showId, artistId, patch);
    }

    const timer = setInterval(() => reportPosition('poll'), POSITION_WRITE_INTERVAL_MS);

    // Also write immediately whenever the host itself changes — a track
    // load, a stop, a release. Waiting up to five seconds to record that
    // a different track is now loaded would let a remount in that window
    // resume the wrong one.
    const unsubscribeHost = subscribeAudioHost(() => { reportPosition('host'); });

    // TASK 3 — and immediately whenever the deck's playback state changes,
    // which the host channel above cannot see: loading a track mutates the
    // host, but pressing play mutates only the player's own closure.
    const unsubscribeTransitions = subscribeAudioTransitions((kind) => { reportPosition(kind); });

    // ── ON THE WAY OUT ────────────────────────────────────────────
    // `pagehide` rather than `beforeunload`: it fires on mobile Safari's
    // back/forward cache path, which `beforeunload` does not.
    //
    // `visibilitychange` -> hidden as well, and it is the one that will
    // actually do the work on a phone. iOS can discard a backgrounded tab
    // without ever running pagehide, and an artist whose show ends with
    // the screen going dark is the normal case, not the exotic one.
    // Hidden fires first and writes; a pagehide that follows finds the
    // same values and writes them again. One redundant row update on a
    // page that is ending, in exchange for the case that currently
    // records nothing at all.
    const onPageHide = () => { reportPosition('pagehide', true); };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') reportPosition('hidden', true);
    };
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      cancelled = true;
      clearInterval(timer);
      unsubscribeHost();
      unsubscribeTransitions();
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  return null;
}
