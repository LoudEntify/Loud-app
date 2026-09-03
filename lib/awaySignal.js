'use client';

// lib/awaySignal.js
// ─────────────────────────────────────────────────────────────
// The departure announcement: a performer telling the room that their
// capture has stopped, at the moment it stops, instead of leaving every
// viewer to work it out from missing frames.
//
// PRD: Director Experience / Live Show (interruption handling)
// S&I: Real-time media
//
// ── WHAT THIS BUYS, PRECISELY ─────────────────────────────────
// Two things, and it is worth separating them because only one is about
// speed:
//
//   1. AUDIO LOSS BECOMES VISIBLE AT ALL. The receiving-side watchdog in
//      lib/trackLiveness.js watches VIDEO frames. A performer whose
//      microphone is taken while their camera keeps running is, to every
//      existing signal, perfectly healthy — the picture moves, the
//      publication is unmuted, frames arrive. The audience simply hears
//      nothing, indefinitely, and nothing in the system disagrees. This
//      is the only mechanism that catches that case.
//
//   2. VIDEO LOSS IS CAUGHT SOONER. ~1s instead of the watchdog's 3s.
//      Worth having, but secondary — the watchdog already covers it.
//
// ── WHAT IT CANNOT DO, STATED SO NOBODY RELIES ON IT ──────────
// It cannot announce a suspension. When the OS freezes the page, no code
// here runs — that is what suspension means — so nothing is sent. That
// case belongs to the frame watchdog and always will. This is a fast
// path for interruptions the device is awake to notice, and it expires
// back into the slow path (see AWAY_TTL_MS) rather than replacing it.
//
// ── WHY A DATA MESSAGE AND NOT A MUTE ─────────────────────────
// Muting the published track would reach viewers through machinery that
// already exists (publication_muted is an impairment reason). It was
// rejected: mute changes what is actually being sent, and a device that
// mutes and is then suspended before it can unmute has published a
// silence it cannot take back. A data message asserts something about
// the performer without touching the media, so the worst case of a lost
// message is a stale claim that expires, not a track nobody can revive.
//
// Same channel and the same {type} convention as lib/shotCommands.js.
// LiveDemo's data handler is a flat sequence of `if (payload.type ===
// ...)` checks with no default branch, so an unrecognised type is
// ignored on every client — which is what makes adding one safe to
// deploy against clients that predate it.
// ─────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from 'react';
import { RoomEvent } from 'livekit-client';
import { logHealthEvent } from './healthLog';

export const AWAY_MESSAGE_TYPE = 'PERFORMER_AWAY';

// How long an away claim stands without being renewed.
//
// ── WHY IT EXPIRES ────────────────────────────────────────────
// The failure this prevents: a performer announces away, and the 'back'
// never arrives — the device died, the message was lost, the tab was
// discarded. Without a TTL that feed is blacklisted for the rest of the
// show by a claim nobody can retract.
//
// Expiring is safe in the only case that matters. If they are genuinely
// still gone, their frames have long since stalled and the watchdog holds
// the feed impaired on its own evidence. So the announcement decays into
// the mechanism that was always going to be right, rather than
// overriding it forever. Renewed every RENEW_MS while the loss persists,
// so a real absence stays marked without the claim ever being permanent.
const AWAY_TTL_MS = 20000;
const RENEW_MS = 6000;

// ── CONFIRM BEFORE ANNOUNCING ─────────────────────────────────
// How long a capability must stay lost before the room is told.
//
// The failure this prevents was found in the iOS run
// (docs/INTERRUPTION_FEASIBILITY.md §4.1): the assistant/alarm step took
// the audio session for 9.8 seconds, but a brief grab — a notification
// chime, a route change — can be shorter than a single sample. Announcing
// on the first lost sample would make the audience's holding frame appear
// and vanish, and a holding screen that flickers reads as broken in a way
// that a held frame does not.
//
// Two samples, not a longer wait. The receiving-side frame watchdog lands
// at 3s, so the announcement still arrives first for the cases it exists
// to catch — and for the case it uniquely catches, a microphone taken
// while the camera keeps running, nothing else is coming at all.
//
// Deliberately NOT symmetric: coming BACK is announced immediately. A
// stale away claim costs the audience a held frame they should not be
// seeing, and there is no flicker to prevent in that direction.
const ANNOUNCE_CONFIRM_MS = 2000;

const encoder = new TextEncoder();

/**
 * Announce that this performer's capture has stopped, or resumed.
 *
 * Fire-and-forget. A publish failure is logged and swallowed: this runs
 * at the moment something has already gone wrong on the device, and an
 * announcement that throws into the interruption handler would turn one
 * problem into two.
 */
export async function publishAwaySignal(room, { away, reason, identity }) {
  if (!room?.localParticipant) return false;
  try {
    const payload = encoder.encode(JSON.stringify({
      type: AWAY_MESSAGE_TYPE,
      away: !!away,
      reason: reason || null,
      identity: identity || room.localParticipant.identity || null,
      ts: Date.now(),
    }));
    await room.localParticipant.publishData(payload, { reliable: true });
    logHealthEvent('performer_away_published', { away: !!away, reason: reason || null });
    return true;
  } catch (err) {
    logHealthEvent('performer_away_publish_failed', { away: !!away, reason: reason || null, error: String(err?.message || err) });
    return false;
  }
}

/**
 * Which identities are currently claiming to be away.
 *
 * Returned as a Set for the same reason lib/trackLiveness.js returns one:
 * every consumer applies it identically, and there is no second opinion
 * about who is away.
 *
 * The identity is taken from the RECEIVED PARTICIPANT, never from the
 * message body. A body-supplied identity would let any participant
 * declare any other participant away — a data channel every viewer can
 * publish on is not a place to accept claims about third parties. The
 * body carries one for logging only.
 */
export function useAwayIdentities(room) {
  const [awayIdentities, setAwayIdentities] = useState(() => new Set());
  const claimsRef = useRef(new Map()); // identity -> expiresAt

  useEffect(() => {
    if (!room) return undefined;

    function recompute() {
      const now = Date.now();
      const next = new Set();
      claimsRef.current.forEach((expiresAt, identity) => {
        if (expiresAt > now) next.add(identity);
        else claimsRef.current.delete(identity);
      });
      setAwayIdentities((prev) => {
        if (prev.size === next.size && [...prev].every((k) => next.has(k))) return prev;
        logHealthEvent('performer_away_set_changed', { away: Array.from(next) });
        return next;
      });
    }

    function onData(payload, participant) {
      try {
        const parsed = JSON.parse(new TextDecoder().decode(payload));
        if (parsed?.type !== AWAY_MESSAGE_TYPE) return;
        const identity = participant?.identity;
        if (!identity) return;
        if (parsed.away) claimsRef.current.set(identity, Date.now() + AWAY_TTL_MS);
        else claimsRef.current.delete(identity);
        recompute();
      } catch {
        // Not our message, or not JSON. Everything else on this channel
        // is somebody else's business.
      }
    }

    function onParticipantDisconnected(participant) {
      // A participant who has left is handled by the track pool
      // disappearing; keeping an away claim for them would only survive
      // to greet them on reconnect.
      if (participant?.identity && claimsRef.current.delete(participant.identity)) recompute();
    }

    room.on(RoomEvent.DataReceived, onData);
    room.on(RoomEvent.ParticipantDisconnected, onParticipantDisconnected);
    // Expiry has to be driven by something: a claim that lapses while no
    // message arrives would otherwise sit in the set until the next one.
    const timer = setInterval(recompute, 2000);

    return () => {
      room.off(RoomEvent.DataReceived, onData);
      room.off(RoomEvent.ParticipantDisconnected, onParticipantDisconnected);
      clearInterval(timer);
    };
  }, [room]);

  return awayIdentities;
}

/**
 * The publishing side: announce on capability loss, renew while it
 * lasts, retract when it returns.
 *
 * Deliberately driven by `lost` (a capability verdict) rather than by
 * visibility — see isCapabilityLost in lib/interruptionState.js for the
 * measured reason that distinction matters.
 */
export function useAwayAnnouncer(room, { lost, reason, enabled = true }) {
  const announcedRef = useRef(false);
  // Read through a ref so that a loss CHANGING SHAPE mid-interruption
  // (audio goes, then the camera follows) does not restart the
  // confirmation window and delay the announcement by another two
  // seconds. The reason rides along on the message; it is not what the
  // decision to send is made from.
  const reasonRef = useRef(reason);
  reasonRef.current = reason;

  useEffect(() => {
    if (!enabled || !room) return undefined;

    if (!lost) {
      // Immediate, and only if something was actually claimed. Coming
      // back is not debounced: see ANNOUNCE_CONFIRM_MS.
      if (announcedRef.current) {
        announcedRef.current = false;
        publishAwaySignal(room, { away: false, reason: reasonRef.current || null });
      }
      return undefined;
    }

    let renewTimer = null;
    // The confirmation window. If the loss clears inside it this effect
    // is torn down and the timer never fires, so nothing is ever sent
    // for an interruption that resolved itself.
    const confirmTimer = setTimeout(() => {
      if (!announcedRef.current) {
        announcedRef.current = true;
        publishAwaySignal(room, { away: true, reason: reasonRef.current || null });
      }
      // Renewal, so a loss that outlives the TTL is not silently
      // forgiven while it is still happening. Started only after the
      // announcement, so a confirmed loss is the only thing that ever
      // renews.
      renewTimer = setInterval(() => {
        publishAwaySignal(room, { away: true, reason: reasonRef.current || null });
      }, RENEW_MS);
    }, announcedRef.current ? 0 : ANNOUNCE_CONFIRM_MS);

    return () => {
      clearTimeout(confirmTimer);
      if (renewTimer) clearInterval(renewTimer);
    };
  }, [room, lost, enabled]);

  // Retract on unmount: leaving the page while marked away would leave
  // the claim to expire on its own, and twenty seconds of a held frame
  // after the performer has already come back is exactly the kind of
  // stale state this file's TTL exists to bound rather than to cause.
  useEffect(() => {
    if (!enabled || !room) return undefined;
    return () => {
      if (announcedRef.current) {
        announcedRef.current = false;
        publishAwaySignal(room, { away: false, reason: 'teardown' });
      }
    };
  }, [room, enabled]);
}
