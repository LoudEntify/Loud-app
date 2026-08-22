'use client';

// lib/trackLiveness.js
// ─────────────────────────────────────────────────────────────
// Fix (a) follow-up -- promotion hysteresis, WITHOUT the one-way trap
// that the first version of this file shipped.
//
// ── What this is for (Finding 1) ──
// Killing the on-air camera fell back to the survivor, then oscillated
// back to the dead camera's frozen frame ~3 times before settling.
// Selection had no memory: a dying camera's publication can stay listed,
// or briefly reappear, while its media is dead. The chain picks it
// again, ShotVideo makes it active again, the orphan-rescue fires again.
//
// ── What went wrong in v1 (Finding A -- artist A could not see B) ──
// v1 marked a track dead from POLLED, TRANSIENT signals but only revived
// it from DISCRETE events. That is a one-way trap, and it caught the
// most ordinary sequence there is:
//
//   1. B publishes, A subscribes. A remote MediaStreamTrack starts
//      `muted === true` until the first media arrives -- spec behaviour,
//      not a fault.
//   2. TrackSubscribed fires and tries to revive -- a no-op, because
//      nothing had marked it dead yet.
//   3. The poll lands inside that window, sees `muted`, marks it dead
//      forever.
//   4. Media starts flowing. Nothing ever fires again for an
//      already-subscribed healthy track, so it stays blacklisted for the
//      whole show.
//
// ── The rule this version is built on ──
// Liveness is DERIVED from currently-observable state on every
// evaluation, never accumulated. Any condition that can clear, clears
// itself. Room events don't carry their own bespoke logic -- they just
// trigger an immediate re-evaluation, so there is exactly one code path
// deciding whether a track is usable and it cannot drift out of sync
// with reality.
//
// Death is reversible. What survives from v1 is only the part that
// actually fixed the flapping: recovery is not INSTANT. A track that
// becomes healthy again serves a short probation before it can be
// selected, so a flapping publication cannot yank the on-air shot back
// and forth. A track never seen impaired is eligible immediately, so a
// camera joining mid-show is still instantly cuttable.
//
// Every transition is logged to health_events. The registry silently
// deciding what the director could and could not cut to is what cost a
// full device sitting to diagnose.
//
// PRD: Director Experience / Live Show | S&I: Real-time media, Observability
// ─────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from 'react';
import { RoomEvent, Track } from 'livekit-client';
import { logHealthEvent } from './healthLog';

export const DEFAULT_PROBATION_MS = 750;
const POLL_MS = 500;

// `mediaStreamTrack.muted` is NOT treated as immediate death -- that is
// precisely the v1 bug. It is true during the normal subscribe window
// and during any brief stall, so it only counts as impairment once it
// has persisted across this many consecutive evaluations (~2s).
const MUTED_POLLS_TO_IMPAIR = 4;

export function livenessKey(identity, trackSid) {
  return `${identity}:${trackSid || ''}`;
}

// The single place that decides whether a track is currently usable.
// Returns a reason string when impaired, or null when healthy. Every
// reason here describes a condition that can END -- there are no
// terminal states, because a track that is genuinely gone disappears
// from `tracks` and its entry is pruned instead.
function impairmentReason(trackRef, entry) {
  const pub = trackRef.publication;
  if (!pub) return 'no_publication';
  if (pub.isMuted) return 'publication_muted';

  const track = pub.track;
  // Subscribed-but-no-track: the publication is listed, but there is no
  // media object behind it (mid-unsubscribe, or never subscribed).
  if (!track) return 'not_subscribed';
  if (track.streamState === Track.StreamState.Paused) return 'stream_paused';

  const mst = track.mediaStreamTrack;
  if (!mst) return 'no_media_track';
  if (mst.readyState === 'ended') return 'track_ended';

  if (mst.muted) {
    entry.mutedPolls = (entry.mutedPolls || 0) + 1;
    // Below the threshold this is explicitly NOT impairment: a freshly
    // subscribed remote track is muted until its first frame.
    return entry.mutedPolls >= MUTED_POLLS_TO_IMPAIR ? 'media_stalled' : null;
  }
  entry.mutedPolls = 0;
  return null;
}

/**
 * Returns a Set of `identity:trackSid` keys that must not be selected
 * right now -- currently impaired, or healthy again but still serving
 * probation.
 */
export function useIneligibleTracks(room, tracks, { probationMs = DEFAULT_PROBATION_MS } = {}) {
  const [ineligible, setIneligible] = useState(() => new Set());
  // key -> { impaired, reason, mutedPolls, eligibleAt }. A ref because
  // this is re-evaluated several times a second and only the derived set
  // needs to cause a render.
  const registryRef = useRef(new Map());
  const tracksRef = useRef(tracks);
  tracksRef.current = tracks;

  useEffect(() => {
    if (!room) return undefined;
    const registry = registryRef.current;

    function evaluate() {
      const now = Date.now();
      const current = tracksRef.current || [];
      const seen = new Set();

      current.forEach((t) => {
        const key = livenessKey(t.participant?.identity, t.publication?.trackSid);
        seen.add(key);
        const entry = registry.get(key) || { impaired: false, reason: null, mutedPolls: 0, eligibleAt: 0 };
        const reason = impairmentReason(t, entry);

        if (reason && !entry.impaired) {
          entry.impaired = true;
          entry.reason = reason;
          logHealthEvent('track_liveness_impaired', {
            key,
            identity: t.participant?.identity ?? null,
            reason,
          });
        } else if (!reason && entry.impaired) {
          // Recovered. Probation, not instant re-eligibility -- this is
          // the part that stops a flapping publication from yanking the
          // on-air shot back and forth.
          entry.impaired = false;
          entry.eligibleAt = now + probationMs;
          logHealthEvent('track_liveness_recovered', {
            key,
            identity: t.participant?.identity ?? null,
            previousReason: entry.reason,
            probationMs,
          });
          entry.reason = null;
        }
        registry.set(key, entry);
      });

      // Prune tracks that are no longer present at all. They cannot be
      // selected regardless, and keeping them would let a stale verdict
      // outlive the thing it was about -- v1's failure mode.
      registry.forEach((_entry, key) => {
        if (!seen.has(key)) registry.delete(key);
      });

      const next = new Set();
      registry.forEach((entry, key) => {
        if (entry.impaired || now < entry.eligibleAt) next.add(key);
      });

      setIneligible((prev) => {
        if (prev.size === next.size && [...prev].every((k) => next.has(k))) return prev;
        logHealthEvent('track_liveness_blacklist_changed', {
          count: next.size,
          keys: Array.from(next),
        });
        return next;
      });
    }

    // Room events don't carry their own logic -- they just make the
    // evaluation happen NOW instead of up to POLL_MS later. One decision
    // path, so events and polling can never disagree.
    const onChanged = () => evaluate();
    const EVENTS = [
      RoomEvent.TrackPublished,
      RoomEvent.TrackUnpublished,
      RoomEvent.TrackSubscribed,
      RoomEvent.TrackUnsubscribed,
      RoomEvent.TrackMuted,
      RoomEvent.TrackUnmuted,
      RoomEvent.TrackStreamStateChanged,
      RoomEvent.ParticipantDisconnected,
    ];
    EVENTS.forEach((e) => room.on(e, onChanged));

    evaluate();
    const timer = setInterval(evaluate, POLL_MS);

    return () => {
      clearInterval(timer);
      EVENTS.forEach((e) => room.off(e, onChanged));
    };
  }, [room, probationMs]);

  return ineligible;
}

/**
 * Filter helper so every caller applies the registry identically. Kept
 * here rather than inlined at each call site precisely because EgressPage
 * and LiveDemo disagreeing about eligibility is the failure mode.
 */
export function filterEligible(trackRefs, ineligible) {
  if (!ineligible || ineligible.size === 0) return trackRefs;
  return trackRefs.filter(
    (t) => !ineligible.has(livenessKey(t.participant?.identity, t.publication?.trackSid))
  );
}
