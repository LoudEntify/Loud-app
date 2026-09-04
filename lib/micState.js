'use client';

// lib/micState.js
// ─────────────────────────────────────────────────────────────
// Who currently has an open microphone, broadcast to the room.
//
// PRD: Director Experience / Live Show (Versus)
// S&I: Real-time media
//
// ── WHY THIS HAS TO BE BROADCAST AT ALL ───────────────────────
// Because this app's mic mute is a GAIN NODE, not a track mute.
// components/LiveDemo.jsx's toggleMic calls tuneMicMuted(), which ramps
// `micMuteGain` inside the Web Audio graph (lib/audioProcessing.js). That
// was a deliberate fix: muting the published MediaStreamTrack silenced
// the backing track too, because the published track IS the mix.
//
// The consequence is that mute state is completely invisible to every
// other participant. There is no `publication.isMuted`, no TrackMuted
// event, nothing on the wire. A remote client cannot know, and cannot
// infer it from the audio without measuring levels and guessing.
//
// So it is published explicitly. That is a real cost — one more piece of
// state that two clients could disagree about — and it is accepted for
// one reason: a viewer arriving mid-show hears a voice and cannot tell
// which of two similar panels it is coming from. That is an orientation
// problem for every new arrival, at the exact moment they decide whether
// this looks produced or confusing.
//
// ── ⚠️ WHAT THIS CHANNEL IS NOT ──────────────────────────────
// It carries MUTE STATE. Nothing else, ever.
//
// The temptation will be to make it a general performer-state channel —
// "while we're sending something, add whether they're ready / which song
// / their connection quality". Refuse. Every field added here is a fact
// that lives in two places and can drift, and the drift is invisible
// until it matters. This codebase has already refused that shape twice:
// show_session_state holds set_list_id and nothing else, and b-roll's
// discriminator lives on the publication precisely so there is no side
// channel to keep in sync.
//
// If something else needs broadcasting, it gets its own message type and
// its own argument for existing.
//
// ── WHAT IT DELIBERATELY DOES NOT DECIDE ──────────────────────
// Who the "active performer" is. There is no such assignment any more —
// two performers cue each other verbally and the one not performing
// mutes. This channel reports mic state and the UI renders it literally:
// one open mic, one border; two open, two borders; none open, none. See
// liveSlotsFromMicState below for why that is the whole rule.
// ─────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from 'react';
import { RoomEvent } from 'livekit-client';
import { logHealthEvent } from './healthLog';

export const MIC_STATE_MESSAGE_TYPE = 'MIC_STATE';

const encoder = new TextEncoder();

/**
 * Tell the room whether this performer's microphone is open.
 *
 * Fire-and-forget: a failure here costs a border, not a show, and
 * throwing into a mute toggle would turn a cosmetic problem into a
 * functional one.
 */
export async function publishMicState(room, { micOn, slot }) {
  if (!room?.localParticipant) return false;
  try {
    await room.localParticipant.publishData(
      encoder.encode(JSON.stringify({ type: MIC_STATE_MESSAGE_TYPE, micOn: !!micOn, slot: slot || null })),
      { reliable: true }
    );
    // Both halves are logged so a border that does not appear can be
    // told apart in one capture: published-but-never-received is a
    // transport problem, received-but-not-drawn is a rendering one, and
    // neither is a missing feature. The first version of the border was
    // the second of those and cost a device round to find.
    logHealthEvent('mic_state_published', { micOn: !!micOn, slot: slot || null });
    return true;
  } catch (err) {
    logHealthEvent('mic_state_publish_failed', { micOn: !!micOn, error: String(err?.message || err) });
    return false;
  }
}

/**
 * Which slots currently have an open mic, as seen from this client.
 *
 * ── THE RULE, AND WHY THERE IS NO ARBITRATION ─────────────────
 * The border means "this microphone is open". Literally, always:
 *
 *   one open   -> one border
 *   BOTH open  -> BOTH borders. They are talking over each other, which
 *                 is a real thing that happens, and both being live is
 *                 the true description of it. Picking a winner would be
 *                 inventing an answer to a question nobody asked.
 *   NONE open  -> no borders. Between songs, both muted. Also true.
 *
 * The rejected alternative was to keep the last speaker lit so the stage
 * always shows someone. That is memory, and memory is the derived state
 * that drifts: two clients that saw the mutes in a different order would
 * light different people, with nothing to reconcile them. Rendering the
 * current fact cannot disagree with itself.
 *
 * A local mic state is passed in separately rather than round-tripped
 * through the room: a performer's own border should track their own tap
 * immediately, not after a data message comes back to them.
 */
export function useMicState(room, { localSlot = null, localMicOn = true, enabled = true } = {}) {
  const [remote, setRemote] = useState(() => ({}));
  const remoteRef = useRef({});

  useEffect(() => {
    if (!room || !enabled) return undefined;

    function onData(payload, participant) {
      try {
        const parsed = JSON.parse(new TextDecoder().decode(payload));
        if (parsed?.type !== MIC_STATE_MESSAGE_TYPE) return;
        // The slot is taken from the SENDER's own claim rather than
        // resolved from identity here, because the sender is the only
        // one that knows which slot it holds — but it is only ever
        // applied to that sender's own entry, so a client cannot use
        // this to say anything about anybody else.
        const key = parsed.slot || participant?.identity;
        if (!key) return;
        remoteRef.current = { ...remoteRef.current, [key]: !!parsed.micOn };
        setRemote(remoteRef.current);
        logHealthEvent('mic_state_received', { from: key, micOn: !!parsed.micOn });
      } catch {
        // Not our message, or not JSON. Everything else on this channel
        // is somebody else's business.
      }
    }

    function onParticipantConnected() {
      // A late arrival has no history, and this channel has no retained
      // state. Re-announcing on every join is what makes a viewer who
      // walks in mid-song see the right border immediately rather than
      // waiting for the next mute toggle — which, between songs, could
      // be minutes.
      publishMicState(room, { micOn: localMicOn, slot: localSlot });
    }

    room.on(RoomEvent.DataReceived, onData);
    room.on(RoomEvent.ParticipantConnected, onParticipantConnected);
    return () => {
      room.off(RoomEvent.DataReceived, onData);
      room.off(RoomEvent.ParticipantConnected, onParticipantConnected);
    };
  }, [room, enabled, localMicOn, localSlot]);

  // The local slot's own state always comes from the local toggle, never
  // from the echo — see the note above.
  const liveSlots = { ...remote };
  if (localSlot) liveSlots[localSlot] = !!localMicOn;

  return liveSlots;
}

/** Convenience for callers that just want the set of lit slots. */
export function litSlots(liveSlots) {
  return Object.keys(liveSlots || {}).filter((k) => liveSlots[k]);
}

/**
 * Publish the local mic state whenever it changes.
 *
 * Separate from the subscription so a surface can listen without
 * announcing — viewers have no microphone and must never claim a slot.
 */
export function useMicStateAnnouncer(room, { slot, micOn, enabled = true }) {
  const publish = useCallback(() => {
    if (!enabled || !room || !slot) return;
    publishMicState(room, { micOn, slot });
  }, [room, slot, micOn, enabled]);

  useEffect(() => { publish(); }, [publish]);
}
