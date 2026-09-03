'use client';

// lib/interruptionState.js
// ─────────────────────────────────────────────────────────────
// The shape classifier. What the platform WILL tell us about an
// interruption, expressed as capability rather than cause.
//
// PRD: Director Experience / Live Show (interruption handling)
// S&I: Real-time media, Observability
//
// ── WHY THIS DOES NOT NAME CAUSES ─────────────────────────────
// There is no telephony API on the web. A call, Siri, an alarm, a timer,
// another app taking the microphone and a Bluetooth route change are the
// same event to a page. Anything here called `phoneCall` would be a guess
// printed as a fact, and it would be wrong often enough to matter.
//
// So the vocabulary is capabilities: what still works. The audience-side
// consequence is identical across all three interruptions in the spec —
// cut to another camera if one exists, otherwise hold the frame — so a
// misclassification costs the audience nothing. It changes only what the
// artist is told, and there the honest sentence is "your audio was
// interrupted", which is true whatever caused it.
//
// ── WHY THERE ARE NO PLATFORM BRANCHES ────────────────────────
// Every branch below is a function of OBSERVATIONS, never of a user
// agent. That is what lets this ship before an iPhone has ever been
// measured: iPhone evidence does not change what the branches are, only
// which ones iOS reaches. It is also the standing rule of this codebase —
// lib/brollPlayback.js, lib/useSourceDimensions.js and LiveDemo's
// fullscreen note all feature-detect rather than sniff.
//
// Which branches have actually been reached on a real device, and which
// are still unverified, is recorded in docs/INTERRUPTION_FEASIBILITY.md
// and must be kept current there rather than asserted here.
//
// ── THE ONE SIGNAL THAT LOOKS LIKE A MISTAKE AND IS NOT ───────
// `videoAlive` is derived from the local track's DECLARED state
// (readyState/muted). lib/trackLiveness.js retired exactly that signal
// in v4, and was right to: `mediaStreamTrack.muted` stayed false for 70+
// seconds across a real screen-lock freeze, because the device that
// would have set it had been suspended by the OS.
//
// The difference is who is asking. That was a REMOTE client trying to
// judge a publisher whose JavaScript had stopped — declared state cannot
// travel from a device that cannot run code. This is the publisher
// itself, asking about its own capture, in code that is by definition
// executing. When another app takes the camera and this page is still
// running, the browser sets those properties and we read them
// immediately. When this page is NOT running, nothing here is consulted
// at all and the receiving-side frame watchdog is the whole answer.
//
// Two signals, two situations, no overlap. Neither replaces the other.
// ─────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from 'react';
import { logHealthEvent } from './healthLog';

export const INTERRUPTION = {
  // Everything works.
  LIVE: 'live',
  // Running and visible, audio gone, camera fine. The shape an incoming
  // call makes while the page is still foregrounded.
  AUDIO_INTERRUPTED: 'audio_interrupted',
  // Running, camera gone, audio fine. Another app took the camera.
  CAMERA_TAKEN: 'camera_taken',
  // Running, both gone.
  CAPTURE_LOST: 'capture_lost',
  // Hidden, still running, nothing lost. A laptop minimised, or a phone
  // whose platform keeps capture alive in the background.
  BACKGROUNDED_RUNNING: 'backgrounded_running',
  // Hidden, still running, some capture lost.
  BACKGROUNDED_DEGRADED: 'backgrounded_degraded',
};

// Only ever assigned retrospectively. A page cannot observe its own
// suspension while suspended; it can only find the gap afterwards.
export const SUSPENDED_RETURN = 'suspended_return';

/**
 * The whole classifier. Pure, so it can be reasoned about and tested
 * without a room, a device or a permission prompt.
 */
export function classifyCapability({ visible, audioAlive, videoAlive }) {
  const lost = (audioAlive === false) || (videoAlive === false);
  if (!visible) {
    return lost ? INTERRUPTION.BACKGROUNDED_DEGRADED : INTERRUPTION.BACKGROUNDED_RUNNING;
  }
  if (audioAlive === false && videoAlive === false) return INTERRUPTION.CAPTURE_LOST;
  if (audioAlive === false) return INTERRUPTION.AUDIO_INTERRUPTED;
  if (videoAlive === false) return INTERRUPTION.CAMERA_TAKEN;
  return INTERRUPTION.LIVE;
}

/**
 * Has a capability actually been lost?
 *
 * ── THE TRIGGER RULE, AND WHY IT IS NOT VISIBILITY ────────────
 * This is the predicate the departure announcement fires on, and getting
 * it wrong in the obvious way would break a case that currently works.
 *
 * The obvious implementation announces on `visibilitychange`. That would
 * drop the show every time an artist on a laptop checks a message — and
 * a laptop loses nothing when hidden. Measured, not assumed: across the
 * captures in this repo an artist tab was hidden for 270 seconds with a
 * maximum silent gap of 2.0s, pub_stats every ~2s, cues firing, and the
 * AudioContext reading `running` at both the hide and the return.
 *
 * Capability loss is the honest trigger. It is silent on a device that
 * loses nothing and immediate on a device that loses everything, so one
 * rule is correct on both without either being special-cased.
 */
export function isCapabilityLost(state) {
  return state === INTERRUPTION.AUDIO_INTERRUPTED
    || state === INTERRUPTION.CAMERA_TAKEN
    || state === INTERRUPTION.CAPTURE_LOST
    || state === INTERRUPTION.BACKGROUNDED_DEGRADED;
}

/**
 * Artist-facing sentence for a state.
 *
 * ── COPY CONSTRAINT, ENFORCED HERE ────────────────────────────
 * Nothing in this map may promise what minimising does. Whether a
 * backgrounded phone keeps performing is unmeasured on iOS, and a
 * sentence like "you're still live while minimised" would be an
 * assumption shipped as a fact to the artist most likely to rely on it.
 * The backgrounded strings therefore describe what was OBSERVED on this
 * device just now, in the past tense, and promise nothing about next
 * time. Revisit only with evidence in docs/INTERRUPTION_FEASIBILITY.md.
 */
export function describeInterruption(state) {
  switch (state) {
    case INTERRUPTION.AUDIO_INTERRUPTED: return 'Your audio was interrupted.';
    case INTERRUPTION.CAMERA_TAKEN: return 'Your camera was taken by another app.';
    case INTERRUPTION.CAPTURE_LOST: return 'Your audio and camera were interrupted.';
    case INTERRUPTION.BACKGROUNDED_DEGRADED: return 'Your camera stopped while you were away from this screen.';
    case INTERRUPTION.BACKGROUNDED_RUNNING: return 'You left this screen.';
    default: return '';
  }
}

// ─────────────────────────────────────────────────────────────
// THE CONSOLE LINES — same held frame, different reader
//
// The audience keeps "Back in a moment". The artist's own console gets
// the specific cause, because the two are doing different jobs: the
// audience needs reassurance that nothing is broken and they should
// stay, and the artist is the only person who can actually fix it and
// needs to know what happened.
//
// ── THE RULES THESE OBEY ──────────────────────────────────────
//   * One short phrase, under 40 characters. The artist's console is a
//     phone now, and a pill that wraps to two lines at 11px is not
//     readable at a glance from behind a microphone.
//   * Name the fact. The only imperative in the whole set is "check the
//     phone", where the action is unambiguous and always right.
//   * No instruction anywhere else. Where the action depends on state
//     the artist cannot see, guessing at one is worse than naming what
//     happened — and the RESUME card already carries the action for the
//     cases that have one. The pill carries the fact, the card carries
//     the action.
//   * Plain English. No component names, no states, no jargon.
//   * The same constraint as above: nothing promises what minimising
//     does. The backgrounded and suspended lines are past tense and
//     describe this device, this time. Neither says whether it will
//     happen again, and neither distinguishes a locked phone from a
//     backgrounded one, because this device cannot tell them apart.
// ─────────────────────────────────────────────────────────────

/** Group A — this device's own capture. '' means "say nothing". */
export function describeInterruptionShort(state) {
  switch (state) {
    case INTERRUPTION.AUDIO_INTERRUPTED: return 'Your microphone was interrupted';
    case INTERRUPTION.CAMERA_TAKEN: return 'Another app took your camera';
    case INTERRUPTION.CAPTURE_LOST: return 'Your sound and picture stopped';
    case INTERRUPTION.BACKGROUNDED_DEGRADED: return 'Your camera stopped while you were away';
    // BACKGROUNDED_RUNNING says nothing, deliberately. Nothing was lost,
    // so no frame is held and no overlay renders — a line for it would
    // describe a state the artist cannot be looking at.
    default: return '';
  }
}

/**
 * Shown briefly on return when this page was frozen by the OS.
 *
 * Rarely reached, and that is correct rather than a bug: if the capture
 * did not survive the freeze, Group A above is more specific and wins;
 * if it did survive, no frame is held and nothing renders. This covers
 * the narrow case where the page was away, came back, and something is
 * still being held while it recovers.
 */
export const SUSPENDED_RETURN_LINE = 'The show paused while you were away';

/**
 * Group B — the held feed is not this device's own capture.
 *
 * Without these the artist's most fixable failure — a propped phone that
 * died three feet away — is the one with no words on it.
 *
 * The shape keys come from feedLossShape() in lib/trackLiveness.js.
 * Deliberately duplicated as literals rather than imported: that file
 * owns what SHAPE a loss is, this one owns what it is CALLED, and the
 * words for every artist-facing string stay in one place. If a shape is
 * added there, it lands in the default here and says nothing, which is
 * the safe direction — silence rather than a wrong sentence.
 */
export function describeFeedLoss(shape) {
  switch (shape) {
    case 'froze': return 'This camera froze — check the phone';
    case 'lost_connection': return 'This camera lost connection';
    case 'switched_off': return 'This camera was switched off';
    case 'away': return 'The other performer is away';
    default: return '';
  }
}

// How long the audio clock may fall behind the wall clock before audio
// counts as gone. Sampled at 1Hz; a 400ms shortfall is far outside
// ordinary scheduling jitter and far inside the shortest interruption a
// person can physically cause.
const AUDIO_LAG_TOLERANCE_MS = 400;
const SAMPLE_MS = 1000;

// A gap longer than this means this page was not running. Three missed
// samples, so ordinary timer throttling cannot be mistaken for a freeze.
const SUSPEND_GAP_MS = 3000;

/**
 * Watch this device's own capture and classify what it is doing.
 *
 * @param audioContext  the live graph's context (lib/audioHost.js)
 * @param getTracks     () => ({ audio, video }) local MediaStreamTracks
 * @param enabled       only the publishing performer should run this
 *
 * Returns { state, since, lastLoss, suspendedForMs }.
 *
 * ── COST ──────────────────────────────────────────────────────
 * One timer at 1Hz reading three properties and one float. No getStats,
 * no canvas, no decode. Stated because the round-2 CPU investigation is
 * paused and unattributed, and anything added to a live artist device
 * while that is open has to be able to account for itself.
 */
export function useCapabilityWatch({ audioContext, getTracks, enabled = true }) {
  const [state, setState] = useState(INTERRUPTION.LIVE);
  // WHEN, not just how long. A caller showing "the show paused while you
  // were away" needs to know how recently it happened, and two
  // suspensions of the same length would not change a duration.
  const [suspendedAt, setSuspendedAt] = useState(0);
  const [suspendedForMs, setSuspendedForMs] = useState(0);
  const lastRef = useRef({ wall: 0, audioTime: 0 });
  const stateRef = useRef(INTERRUPTION.LIVE);

  useEffect(() => {
    if (!enabled) return undefined;
    lastRef.current = { wall: Date.now(), audioTime: audioContext?.currentTime ?? 0 };

    const id = setInterval(() => {
      const now = Date.now();
      const prev = lastRef.current;
      const wallDelta = now - prev.wall;
      const audioTime = audioContext?.currentTime ?? null;
      const audioDelta = audioTime === null ? null : (audioTime - prev.audioTime) * 1000;
      lastRef.current = { wall: now, audioTime: audioTime ?? prev.audioTime };

      // ── THE SUSPENSION, FOUND AFTERWARDS ──────────────────────
      // The only direct evidence that the OS froze this page. Reported
      // and then dropped from the capability verdict below: by the time
      // this runs the page is awake again, and what matters now is what
      // still works, not what stopped while nobody could look.
      if (wallDelta > SUSPEND_GAP_MS) {
        setSuspendedForMs(wallDelta);
        setSuspendedAt(now);
        logHealthEvent(SUSPENDED_RETURN, {
          gapMs: wallDelta,
          // Whether the audio session kept running while this page did
          // not — the same measurement the probe makes, and the one that
          // decides whether a backgrounded phone was still performing.
          audioRatio: audioDelta === null ? null : Math.round((Math.max(0, audioDelta) / wallDelta) * 100) / 100,
          audioContextState: audioContext?.state ?? null,
        });
      }

      const tracks = getTracks?.() ?? {};
      const audioTrack = tracks.audio ?? null;
      const videoTrack = tracks.video ?? null;

      // Audio is alive when the audio clock kept pace. Deliberately not
      // "the context says running": an interrupted session on some
      // platforms reports a state that has not caught up yet, and the
      // clock cannot lie about whether the audio thread ran.
      const audioAlive = audioContext
        ? (audioDelta !== null && audioDelta >= wallDelta - AUDIO_LAG_TOLERANCE_MS)
        : null;
      const videoAlive = videoTrack
        ? (videoTrack.readyState !== 'ended' && !videoTrack.muted)
        : null;
      // A track the browser has ended is gone whatever the clock says.
      const audioTrackDead = audioTrack ? (audioTrack.readyState === 'ended' || audioTrack.muted) : false;

      const next = classifyCapability({
        visible: typeof document === 'undefined' ? true : document.visibilityState === 'visible',
        audioAlive: audioTrackDead ? false : audioAlive,
        videoAlive,
      });

      if (next !== stateRef.current) {
        logHealthEvent('interruption_state_changed', { from: stateRef.current, to: next });
        stateRef.current = next;
        setState(next);
      }
    }, SAMPLE_MS);

    return () => clearInterval(id);
  }, [audioContext, getTracks, enabled]);

  return { state, suspendedAt, suspendedForMs, lost: isCapabilityLost(state) };
}
