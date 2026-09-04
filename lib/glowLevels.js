'use client';

// lib/glowLevels.js
// ─────────────────────────────────────────────────────────────
// The performer glow: each artist's panel lit by their own voice.
//
// PRD: Director Experience / Live Show (Versus)
// S&I: Real-time media
//
// ── WHERE THE LEVEL COMES FROM, AND WHAT IT COSTS ─────────────
// livekit-client already computes `participant.audioLevel` (0-1) for
// every participant including the local one, delivered on the signalling
// connection that is open anyway. So the level source costs NOTHING: no
// AnalyserNode, no second AudioContext, no audio processing on any
// client, and — the important one — NO MESSAGES.
//
// Broadcasting a level over the data channel was considered and refused.
// At any rate worth looking at it would be tens of messages per second
// per performer, on the SAME channel shot commands use, whose entire
// design premise is that a director's tap arrives instantly. Continuous
// chatter underneath the one thing that must never queue is a bad trade
// for a visual effect. lib/micState.js stays a mute flag.
//
// ── ⚠️ WHY THIS IS NOT THE LOOP UNDER INVESTIGATION ───────────
// There is a PAUSED investigation into a display loop in
// BackingTrackPanel — 60fps rAF, writing style.width every frame
// regardless of change, animating 360 SVG rects — suspected of causing
// camera CPU pressure. This was built to be a different thing on every
// axis that matters:
//
//   NO TIMER AT ALL. The producer is event-driven: LiveKit fires
//   ActiveSpeakersChanged when levels change and this writes then. A
//   silent room does no work whatsoever, where an rAF loop runs at full
//   rate over a still picture.
//
//   WRITES ONLY ON CHANGE. The level is quantised to 16 steps and
//   written only when the step moves. Holding a note writes nothing.
//   The paused loop's defining flaw is that it writes every frame
//   whether or not anything changed.
//
//   COMPOSITED PROPERTIES ONLY. The value lands in a CSS custom
//   property driving `opacity` and `transform: scale()` — the two things
//   a browser animates without layout or paint. `width` (the paused
//   loop) forces both.
//
//   TWO ELEMENTS, not 360.
//
//   CSS DOES THE SMOOTHING. A transition between updates makes an
//   event-rate of a couple of hertz look continuous, because the
//   interpolation happens in the compositor rather than in JavaScript.
//
// ── THE HONEST LIMIT ──────────────────────────────────────────
// LiveKit's speaker updates arrive roughly twice a second. That is
// plenty for "who is performing" and may read as sluggish for "level
// meter". Shipping the free version first is deliberate: if the device
// test says it lags, the next step is an AnalyserNode per subscribed
// track — real audio processing on every client — and that should be
// bought with evidence rather than a suspicion.
// ─────────────────────────────────────────────────────────────

import { useEffect } from 'react';
import { RoomEvent } from 'livekit-client';
import { logHealthEvent } from './healthLog';

// 16 steps. Fine enough that a voice reads as continuous once CSS
// interpolates between values, coarse enough that ordinary speech does
// not write on every single update.
const STEPS = 16;

// Identity convention, the same one presentSlots uses:
// `contestant-a-…` / `camfeed-a-wide-…` — the slot is the second piece.
function slotOfParticipant(p) {
  const id = p?.identity;
  if (!id) return null;
  const parts = id.split('-');
  return parts.length > 1 ? parts[1] : null;
}

function quantise(level) {
  const v = Math.max(0, Math.min(1, level || 0));
  return Math.round(v * STEPS) / STEPS;
}

/**
 * Drive `--glow-a` / `--glow-b` on `stageRef` from live audio levels.
 *
 * Writes straight to the DOM node. Deliberately NOT React state: state
 * at speaker-update rate would re-render the whole stage — every video
 * layer, every overlay — several times a second, to change one number
 * that only CSS reads.
 */
export function useGlowLevels(room, stageRef, { enabled = true } = {}) {
  useEffect(() => {
    if (!room || !enabled) return undefined;
    const last = { a: null, b: null };
    let logged = false;

    const write = (slot, value) => {
      if (last[slot] === value) return; // nothing changed; write nothing
      last[slot] = value;
      stageRef.current?.style?.setProperty(`--glow-${slot}`, String(value));
    };

    const sample = () => {
      const el = stageRef.current;
      if (!el) return;

      const levels = { a: 0, b: 0 };
      const consider = (p) => {
        const slot = slotOfParticipant(p);
        if (slot !== 'a' && slot !== 'b') return;
        // The LOUDEST publisher for that slot wins. A performer with a
        // paired camfeed phone has more than one participant carrying
        // their identity prefix, and the slot is lit by the person, not
        // by whichever participant object was enumerated last.
        levels[slot] = Math.max(levels[slot], p.audioLevel || 0);
      };

      consider(room.localParticipant);
      room.remoteParticipants?.forEach?.(consider);

      write('a', quantise(levels.a));
      write('b', quantise(levels.b));

      if (!logged) {
        logged = true;
        // Recorded once so "does the free level source update fast
        // enough" is answered from a capture rather than an impression —
        // the same discipline the CPU investigation is being held to.
        logHealthEvent('glow_level_source', { source: 'livekit_audioLevel' });
      }
    };

    // Event-driven, not polled. A room where nobody is speaking does no
    // work at all.
    room.on(RoomEvent.ActiveSpeakersChanged, sample);
    sample();

    return () => {
      room.off(RoomEvent.ActiveSpeakersChanged, sample);
    };
  }, [room, stageRef, enabled]);
}
