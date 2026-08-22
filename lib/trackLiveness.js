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
// ── v4: the death nobody could see ──
// A camfeed phone locked by its power button halts capture while the
// publication stays live and unmuted. Every signal this registry watched
// was DECLARED state -- signalled, negotiated, propagated -- and a screen
// lock changes none of it: not isMuted, not the subscription, not
// streamState, not readyState. It cannot, because the one device that
// could announce the death has had its JavaScript suspended by the OS.
// The registry was right that the track was live. It was live and
// frozen, so the auto director kept a healthy-looking corpse in rotation
// and viewers were cut to a still image every ~10 seconds.
//
// Frames are the only thing a source freeze actually changes, so v4 adds
// a receiving-side frame-progress watchdog as the registry's first
// OBSERVED-state signal. It reports through the same reason/probation/
// telemetry machinery as everything else, so auto exclusion, the honoured
// manual cut's frozen frame, and the snapshots all cover it unchanged.
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

// How long an ABSENT track keeps its history before the entry is
// dropped. Absence is impairment, not amnesia (see the header note on
// v3) -- but an entry must not live forever, so a camera that has been
// gone this long is finally allowed a clean slate.
const ABSENT_TTL_MS = 30000;

// Snapshot telemetry pacing. Emitted whenever the registry's view
// CHANGES (rate-limited), plus a heartbeat so a quiet window still
// proves the evaluator was running rather than leaving us to infer it
// from absence of evidence -- which is exactly what made this symptom
// survive two fixes.
const SNAPSHOT_MIN_INTERVAL_MS = 1000;
const SNAPSHOT_HEARTBEAT_MS = 5000;

// ── Frame-progress watchdog (v4) ────────────────────────────────
// How often receiver stats are sampled, and how long a subscribed video
// track may deliver ZERO new frames before it counts as stalled. 3s
// clears ordinary network hiccups (0.5-2s) and lands well inside the
// auto director's 9-18s cadence, so a frozen feed leaves the rotation
// before the next cut decision.
const FRAME_SAMPLE_MS = 1000;
const FRAME_STALL_MS = 3000;

// A track that has never delivered a frame is STARTING, not stalled --
// but it cannot be trusted forever either. Past this, a subscribed
// track that has never produced a frame is treated as stalled too.
const FRAME_START_GRACE_MS = 10000;

export function livenessKey(identity, trackSid) {
  return `${identity}:${trackSid || ''}`;
}

// Identities contain '-' but never ':', so the last ':' is the split.
function identityFromKey(key) {
  const i = key.lastIndexOf(':');
  return i === -1 ? key : key.slice(0, i);
}

// The single place that decides whether a track is currently usable.
// Returns a reason string when impaired, or null when healthy. Every
// reason here describes a condition that can END -- there are no
// terminal states, because a track that is genuinely gone disappears
// from `tracks` and its entry is pruned instead.
function impairmentReason(trackRef, entry, now) {
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

  // ── The only OBSERVED-state check (v4) ────────────────────────
  // Everything above is DECLARED state: signalled, negotiated,
  // propagated. A phone dying by screen lock changes none of it. The
  // capture halts, the publication stays live and unmuted, the
  // subscription stays up, readyState stays 'live' -- because the one
  // device that could announce the death has had its JavaScript
  // suspended by the OS and cannot run the code to announce it. The
  // frozen feed stays in rotation and viewers get cut to a still image
  // every ~10 seconds.
  //
  // Frames are the only thing that actually changes, so frames are what
  // this watches. Deliberately measured as DELIVERY COUNTERS
  // (framesDecoded/framesReceived from getReceiverStats), never pixel
  // content: a performer holding perfectly still keeps delivering
  // frames, so stillness can never be mistaken for death.
  //
  // `mediaStreamTrack.muted` used to produce a 'media_stalled' reason
  // here. RETIRED in v4: across every capture it fired twice, both
  // transient false positives at publish time, and never once caught a
  // real death -- including the screen-lock freeze it was nominally
  // there for, where it stayed false on all three clients for 70+
  // seconds. One signal per meaning keeps timelines readable.
  const sinceProgress = now - (entry.lastProgressAt || now);
  if (entry.everDelivered) {
    if (sinceProgress >= FRAME_STALL_MS) return 'frames_stalled';
  } else if (now - (entry.presentSince || now) >= FRAME_START_GRACE_MS) {
    return 'frames_stalled';
  }
  return null;
}

/**
 * Returns a Set of `identity:trackSid` keys that must not be selected
 * right now -- currently impaired, or healthy again but still serving
 * probation.
 */
export function useIneligibleTracks(room, tracks, { probationMs = DEFAULT_PROBATION_MS } = {}) {
  const [ineligible, setIneligible] = useState(() => new Set());
  // key -> { impaired, reason, eligibleAt, lastSeenAt, presentSince,
  // lastProgressAt, frames, everDelivered }. A ref because
  // this is re-evaluated several times a second and only the derived set
  // needs to cause a render.
  const registryRef = useRef(new Map());
  const lastSnapshotRef = useRef({ at: 0, signature: null });
  const tracksRef = useRef(tracks);
  tracksRef.current = tracks;

  useEffect(() => {
    if (!room) return undefined;
    const registry = registryRef.current;

    // One transition path for every track, present or absent, so a
    // verdict can never be reached by a route that skips the logging.
    function applyVerdict(entry, key, identity, reason, now) {
      if (reason && !entry.impaired) {
        entry.impaired = true;
        entry.reason = reason;
        logHealthEvent('track_liveness_impaired', { key, identity, reason });
      } else if (reason && entry.impaired && entry.reason !== reason) {
        // Still impaired, different cause (e.g. muted -> absent). Worth
        // a row: it is how a mute that becomes a teardown is told apart
        // from one that stays a mute.
        logHealthEvent('track_liveness_impairment_changed', {
          key,
          identity,
          from: entry.reason,
          to: reason,
        });
        entry.reason = reason;
      } else if (!reason && entry.impaired) {
        // Recovered. Probation, not instant re-eligibility -- this is
        // the part that stops a flapping publication from yanking the
        // on-air shot back and forth.
        entry.impaired = false;
        entry.eligibleAt = now + probationMs;
        logHealthEvent('track_liveness_recovered', {
          key,
          identity,
          previousReason: entry.reason,
          probationMs,
        });
        entry.reason = null;
      }
    }

    function evaluate() {
      const now = Date.now();
      const current = tracksRef.current || [];
      const seen = new Set();

      current.forEach((t) => {
        const key = livenessKey(t.participant?.identity, t.publication?.trackSid);
        seen.add(key);
        const entry = registry.get(key) || {
          impaired: false, reason: null, eligibleAt: 0, lastSeenAt: now,
          presentSince: 0, lastProgressAt: 0, frames: undefined, everDelivered: false,
        };
        entry.lastSeenAt = now;
        // Re-baseline the frame watchdog on every transition INTO
        // presence. Without this, a track that was absent for 10s and
        // came back would be judged against a 10-second-old progress
        // timestamp and impair instantly for a stall it never had.
        if (!entry.presentSince) {
          entry.presentSince = now;
          entry.lastProgressAt = now;
          entry.frames = undefined;
          entry.everDelivered = false;
        }
        applyVerdict(entry, key, t.participant?.identity ?? null, impairmentReason(t, entry, now), now);
        registry.set(key, entry);
      });

      // ── Absence is IMPAIRMENT, not amnesia (v3, Test 4 retest) ──
      // This is where v2 was wrong. useTracks reports only publications
      // that currently hold a live track object (@livekit/components-core
      // getTrackReferences, onlySubscribed defaults true), so a camera
      // that dies simply DISAPPEARS from the list rather than showing up
      // as impaired. v2 deleted the entry on absence, which erased the
      // track's history -- so when it flickered back it was, by this
      // registry's own rules, a brand-new never-impaired track: eligible
      // instantly, no probation, immediately selectable again. That is
      // the oscillation, and it is why the whole flap produced zero
      // track_liveness_impaired rows: nothing was ever impaired, it was
      // absent, and absence was not a state this registry recorded.
      //
      // Now absence is just another reason. The entry survives, stays
      // impaired for as long as the track is gone, and takes the normal
      // recovery-plus-probation path if it ever comes back.
      registry.forEach((entry, key) => {
        if (seen.has(key)) return;
        if (now - (entry.lastSeenAt ?? 0) > ABSENT_TTL_MS) {
          registry.delete(key);
          logHealthEvent('track_liveness_forgotten', { key, identity: identityFromKey(key) });
          return;
        }
        // Clearing presentSince is what arms the re-baseline above for
        // whenever this track comes back.
        entry.presentSince = 0;
        applyVerdict(entry, key, identityFromKey(key), 'absent', now);
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

      // ── Snapshot: what the registry BELIEVES, on the record ────────
      // The transition events above only fire on change, so a window
      // with no rows is ambiguous: it could mean nothing happened, or it
      // could mean the evaluator was not running / not seeing the track
      // at all. That ambiguity is precisely what let this symptom
      // survive two targeted fixes -- both times the selection logic was
      // changed without anyone being able to see what the registry
      // thought it was selecting from. The heartbeat removes it: a quiet
      // window now positively proves the evaluator ran and saw a healthy
      // pool.
      const entries = [];
      registry.forEach((entry, key) => {
        entries.push({
          key,
          reason: entry.impaired ? entry.reason : null,
          probation: !entry.impaired && now < entry.eligibleAt,
          // F3 -- the frame watchdog's raw working state. This is what
          // makes a stall visible WHILE IT IS HAPPENING: staleSec climbs
          // 0,1,2 across heartbeats before the verdict lands at 3. A
          // capture that shows only the verdict cannot distinguish a
          // real freeze from a mis-firing detector, which is the
          // ambiguity that cost this arc three rounds.
          frames: entry.frames ?? null,
          staleSec: entry.lastProgressAt ? Math.round((now - entry.lastProgressAt) / 1000) : null,
        });
      });
      // staleSec is deliberately EXCLUDED from the change signature --
      // it ticks every second and would force a snapshot per second per
      // client. It rides along on the 5s heartbeat instead, which is
      // enough granularity to watch a 3s threshold approach.
      const signature = entries
        .map((e) => `${e.key}|${e.reason || 'ok'}|${e.probation ? 'p' : ''}`)
        .sort()
        .join(',');
      const sinceLast = now - lastSnapshotRef.current.at;
      const changed = signature !== lastSnapshotRef.current.signature;
      if ((changed && sinceLast >= SNAPSHOT_MIN_INTERVAL_MS) || sinceLast >= SNAPSHOT_HEARTBEAT_MS) {
        lastSnapshotRef.current = { at: now, signature };
        logHealthEvent('track_liveness_snapshot', {
          trackCount: current.length,
          ineligibleCount: next.size,
          entries,
        });
      }
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

    // ── F1: frame-progress sampler ──────────────────────────────
    // Runs on its OWN interval and only ANNOTATES entries; evaluate()
    // stays synchronous and merely reads the last sample. getReceiverStats
    // is async, and an async verdict path would let two evaluations
    // interleave and reach different conclusions about the same track --
    // which is the failure mode this whole file has been fighting.
    //
    // Feature-detected rather than branching on isLocal: only
    // RemoteVideoTrack exposes getReceiverStats, so this naturally covers
    // exactly the tracks whose death is invisible from their own device.
    // A local freeze suspends its own client anyway; remote observers are
    // precisely who should catch it.
    let sampling = false;
    async function sampleFrames() {
      if (sampling) return; // never let a slow getStats stack up
      sampling = true;
      try {
        const current = tracksRef.current || [];
        const now = Date.now();
        await Promise.all(
          current.map(async (t) => {
            const track = t.publication?.track;
            if (!track || typeof track.getReceiverStats !== 'function') return;
            let stats;
            try {
              stats = await track.getReceiverStats();
            } catch {
              return; // stats unavailable this tick -- not evidence of anything
            }
            if (!stats) return;
            const frames = stats.framesDecoded ?? stats.framesReceived;
            if (typeof frames !== 'number') return;

            const key = livenessKey(t.participant?.identity, t.publication?.trackSid);
            const entry = registry.get(key);
            if (!entry) return; // evaluate() owns entry creation; catch it next tick

            if (entry.frames === undefined || frames < entry.frames) {
              // First sample, or the counter reset under us (a fresh
              // track object after a resubscribe). Re-baseline rather
              // than reading a reset as a stall.
              entry.frames = frames;
              entry.lastProgressAt = now;
              if (frames > 0) entry.everDelivered = true;
              return;
            }
            if (frames > entry.frames) {
              entry.frames = frames;
              entry.lastProgressAt = now;
              entry.everDelivered = true;
            }
            // No progress: lastProgressAt deliberately untouched, so the
            // gap grows and impairmentReason can see it.
          })
        );
      } finally {
        sampling = false;
      }
    }

    evaluate();
    sampleFrames();
    const frameTimer = setInterval(sampleFrames, FRAME_SAMPLE_MS);
    const timer = setInterval(evaluate, POLL_MS);

    return () => {
      clearInterval(frameTimer);
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
