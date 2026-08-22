'use client';

// lib/trackLiveness.js
// ─────────────────────────────────────────────────────────────
// Fix (a) follow-up, Finding 1 -- promotion hysteresis.
//
// THE BUG THIS EXISTS FOR: killing the on-air camera fell back to the
// survivor correctly, then oscillated back to the dead camera's frozen
// frame ~3 times before settling. Same when cutting to an already-dead
// camera.
//
// WHY: selection had no memory. `tracksForSlot` filtered only on
// `!isMuted`, so a dying camera's publication can stay listed -- or
// briefly reappear -- while its media is dead. The selection chain picks
// it again, ShotVideo makes it active again, the orphan-rescue fires
// again. The instant a dead key came back it was fully eligible, with
// nothing damping the transition.
//
// WHAT THIS DOES: tracks per-publication liveness and refuses to let a
// track be SELECTED while it is dead or on probation. Two distinct
// rules, and the second is the one that actually stops the flapping:
//
//   1. Dead on: unpublish, participant disconnect, SFU stream pause,
//      mute, or an ended MediaStreamTrack.
//   2. Revival is NOT instant. A track that comes back must be
//      genuinely republished/unpaused AND then survive a probation
//      window before it is eligible again. Reappearing in the list is
//      not evidence that it is delivering frames.
//
// A track never seen before is eligible immediately -- probation applies
// only to REVIVAL after a death. A camera joining mid-show must be
// instantly cuttable (that case already passed its device test and must
// not regress).
//
// Deliberately keyed on `identity:trackSid`, the same key ShotRendering's
// trackKey() uses, so this registry and the layer pool can never
// disagree about what a "track" is.
//
// PRD: Director Experience / Live Show | S&I: Real-time media
// ─────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from 'react';
import { RoomEvent, Track } from 'livekit-client';

export const DEFAULT_PROBATION_MS = 750;
const POLL_MS = 500;

export function livenessKey(identity, trackSid) {
  return `${identity}:${trackSid || ''}`;
}

/**
 * Returns a Set of `identity:trackSid` keys that must NOT be selected
 * right now -- dead, or alive again but still inside probation.
 *
 * @param room       the LiveKit Room (may be undefined before connect)
 * @param tracks     current track references, used by the poll to spot
 *                   deaths that arrive as a silent state change on the
 *                   MediaStreamTrack rather than as a room event
 */
export function useIneligibleTracks(room, tracks, { probationMs = DEFAULT_PROBATION_MS } = {}) {
  const [ineligible, setIneligible] = useState(() => new Set());
  // key -> { dead: boolean, eligibleAt: number }. A ref, not state: this
  // is updated from room-event handlers many times per second during a
  // messy reconnect, and only the DERIVED set below needs to re-render.
  const registryRef = useRef(new Map());
  const tracksRef = useRef(tracks);
  tracksRef.current = tracks;

  useEffect(() => {
    if (!room) return undefined;
    const registry = registryRef.current;

    function markDead(key) {
      if (!key) return;
      const entry = registry.get(key) || {};
      registry.set(key, { ...entry, dead: true, eligibleAt: Infinity });
    }

    // Revival: never immediate. Probation starts now; the poll below is
    // what actually clears it once the window has elapsed.
    function markAlive(key) {
      if (!key) return;
      const entry = registry.get(key);
      if (!entry || !entry.dead) return; // never died -- nothing to serve
      registry.set(key, { dead: false, eligibleAt: Date.now() + probationMs });
    }

    const keyOf = (pub, participant) => livenessKey(participant?.identity, pub?.trackSid);

    const onPublished = (pub, participant) => markAlive(keyOf(pub, participant));
    const onSubscribed = (_track, pub, participant) => markAlive(keyOf(pub, participant));
    const onUnpublished = (pub, participant) => markDead(keyOf(pub, participant));
    const onUnsubscribed = (_track, pub, participant) => markDead(keyOf(pub, participant));
    const onMuted = (pub, participant) => markDead(keyOf(pub, participant));
    const onUnmuted = (pub, participant) => markAlive(keyOf(pub, participant));
    // The SFU pausing a subscribed track is the cleanest "this is not
    // delivering frames" signal the SDK gives us, and it arrives without
    // the publication ever leaving the list -- exactly the case that
    // made the old selection flap.
    const onStreamState = (pub, streamState, participant) => {
      const key = keyOf(pub, participant);
      if (streamState === Track.StreamState.Paused) markDead(key);
      else markAlive(key);
    };
    const onParticipantDisconnected = (participant) => {
      const prefix = `${participant?.identity}:`;
      registry.forEach((_v, key) => {
        if (key.startsWith(prefix)) markDead(key);
      });
    };

    room.on(RoomEvent.TrackPublished, onPublished);
    room.on(RoomEvent.TrackSubscribed, onSubscribed);
    room.on(RoomEvent.TrackUnpublished, onUnpublished);
    room.on(RoomEvent.TrackUnsubscribed, onUnsubscribed);
    room.on(RoomEvent.TrackMuted, onMuted);
    room.on(RoomEvent.TrackUnmuted, onUnmuted);
    room.on(RoomEvent.TrackStreamStateChanged, onStreamState);
    room.on(RoomEvent.ParticipantDisconnected, onParticipantDisconnected);

    // The poll does two jobs the events can't: it notices a
    // MediaStreamTrack that has quietly ended (a yanked USB camera does
    // this without any room event at all), and it is what actually
    // expires probation.
    const timer = setInterval(() => {
      (tracksRef.current || []).forEach((t) => {
        const key = livenessKey(t.participant?.identity, t.publication?.trackSid);
        const mst = t.publication?.track?.mediaStreamTrack;
        if (mst && (mst.readyState === 'ended' || mst.muted)) markDead(key);
      });

      const now = Date.now();
      const next = new Set();
      registry.forEach((entry, key) => {
        if (entry.dead || now < (entry.eligibleAt ?? 0)) next.add(key);
      });
      setIneligible((prev) => {
        if (prev.size === next.size && [...prev].every((k) => next.has(k))) return prev;
        return next;
      });
    }, POLL_MS);

    return () => {
      clearInterval(timer);
      room.off(RoomEvent.TrackPublished, onPublished);
      room.off(RoomEvent.TrackSubscribed, onSubscribed);
      room.off(RoomEvent.TrackUnpublished, onUnpublished);
      room.off(RoomEvent.TrackUnsubscribed, onUnsubscribed);
      room.off(RoomEvent.TrackMuted, onMuted);
      room.off(RoomEvent.TrackUnmuted, onUnmuted);
      room.off(RoomEvent.TrackStreamStateChanged, onStreamState);
      room.off(RoomEvent.ParticipantDisconnected, onParticipantDisconnected);
    };
  }, [room, probationMs]);

  return ineligible;
}

/**
 * Filter helper so callers apply the registry identically. Kept here
 * rather than inlined at each call site precisely because EgressPage and
 * LiveDemo disagreeing about eligibility is the failure mode.
 */
export function filterEligible(trackRefs, ineligible) {
  if (!ineligible || ineligible.size === 0) return trackRefs;
  return trackRefs.filter(
    (t) => !ineligible.has(livenessKey(t.participant?.identity, t.publication?.trackSid))
  );
}
