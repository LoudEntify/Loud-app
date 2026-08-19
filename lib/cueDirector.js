// lib/cueDirector.js
// ─────────────────────────────────────────────────────────────
// Cue-Sheet Director, Phase 1 (CD-2): fires a hand-written cue sheet's
// rows as ordinary shot commands, timed against the backing track's own
// clock. Mirrors createAutoDirector's shape (lib/autoDirector.js) --
// create/start/stop/dispose, one instance, main performer only -- and
// reuses the exact suspend()/resume() pair onExclusiveMode already
// drives for staccato (components/LiveDemo.jsx) to keep auto silent
// while cues are playing: cue playback is another exclusive mode, not
// a special case.
//
// Clock source: NEVER wall clock. There is no HTMLMediaElement here --
// lib/audioProcessing.js's loadBackingTrack returns a plain object
// wrapping a Web Audio AudioBufferSourceNode, with no timeupdate/
// seeking events to hook. This polls getPlayerState() on a short
// interval and infers play/pause/seek transitions from the deltas
// instead -- see tick() below.
//
// PRD: Cue-Sheet Director Phase 1 (CD-2)
// ─────────────────────────────────────────────────────────────

import { logHealthEvent } from './healthLog';
import { validateCueSheet } from './cueSheetValidation';

const POLL_INTERVAL_MS = 200;
// Generous vs the 200ms nominal tick -- absorbs setInterval jitter/tab
// throttling without mistaking it for a real seek, while still well
// under how far even a fast manual seek-and-release actually lands.
const SEEK_TOLERANCE_MS = 750;

// fallback_behaviour resolution for a cue whose slot_role has no live
// feed right now. 'auto_director' deliberately behaves exactly like
// 'default_wide' in this phase -- handing playback control back to the
// real autoDirector instance for just this gap is a real design (when
// does it reclaim control? does it re-suspend on the next cue
// boundary regardless of whether that one resolves either?) that
// belongs with CD-4, where cue/auto/human precedence gets designed as
// one system, not improvised piecemeal here. The enum value itself is
// NOT collapsed into 'default_wide' -- it's stored and logged under its
// own name (reason: 'auto_handback_deferred_phase1') so this deferral
// reads clearly in the health-event timeline and doesn't look like a
// silent alias later.
function resolveFallbackShot(fallbackBehaviour) {
  if (fallbackBehaviour === 'hold_last') return null;
  return 'wide'; // 'default_wide' and (this phase) 'auto_director' both land here
}

// findNextIndex -- "next cue = first cue with timestamp_ms >= elapsedMs."
// The one rule that handles both seek directions: a forward seek skips
// past cues without firing them (their index is behind the new
// pointer); a backward seek re-arms them (their index is at/after the
// new pointer again).
function findNextIndex(cues, elapsedMs) {
  for (let i = 0; i < cues.length; i++) {
    if (cues[i].timestamp_ms >= elapsedMs) return i;
  }
  return cues.length;
}

// createCueDirector({
//   sheet,             — the fetched cue_sheets row ({ id, cues, fallback_behaviour, ... })
//   fireShot,          — (shotKey, decisionSource, meta) => command | undefined
//                        same contract autoDirector's caller (fireAutoShot)
//                        exposes; meta.framingHint carries the cue's
//                        slot_role, meta.params carries cue.motion mapped
//                        onto the direction/vertigo params ShotRenderer
//                        already reads. Must return the built command
//                        (for its resolved targetIdentity) so cueDirector
//                        can log what actually fired.
//   getAvailableRoles, — () => roles currently live for this slot
//   getPlayerState,    — () => { elapsedMs, isPlaying } — polled, never cached
//   suspendAuto,       — () => void — same as auto.suspend() via onExclusiveMode
//   resumeAuto,        — () => void — same as auto.resume() via onExclusiveMode
// })
export function createCueDirector({ sheet, fireShot, getAvailableRoles, getPlayerState, suspendAuto, resumeAuto }) {
  const { cues, errors } = validateCueSheet(sheet?.cues);
  if (errors.length > 0) {
    console.warn('[cueDirector] dropping malformed cue row(s):', errors);
  }

  let pollTimer = null;
  let started = false;
  let nextCueIndex = 0;
  let lastElapsedMs = null;
  let lastWasPlaying = false;

  function fireCue(cue) {
    const roles = getAvailableRoles();
    if (roles.includes(cue.slot_role)) {
      const params = cue.motion
        ? {
            ...(cue.motion.direction !== undefined ? { direction: cue.motion.direction } : {}),
            ...(cue.motion.vertigo !== undefined ? { vertigo: cue.motion.vertigo } : {}),
          }
        : undefined;
      const command = fireShot(cue.shot_type, 'cue', { framingHint: cue.slot_role, params });
      logHealthEvent('cue_fired', {
        sheetId: sheet.id,
        timestampMs: cue.timestamp_ms,
        shot: cue.shot_type,
        slotRole: cue.slot_role,
        resolvedTarget: command?.targetIdentity ?? null,
      });
      return;
    }

    const fallbackShot = resolveFallbackShot(sheet.fallback_behaviour);
    if (fallbackShot) {
      const command = fireShot(fallbackShot, 'cue', { framingHint: cue.slot_role });
      logHealthEvent('cue_fallback', {
        sheetId: sheet.id,
        cueTimestampMs: cue.timestamp_ms,
        slotRole: cue.slot_role,
        fallbackBehaviour: sheet.fallback_behaviour,
        reason: sheet.fallback_behaviour === 'auto_director' ? 'auto_handback_deferred_phase1' : 'no_live_feed',
        resolvedTarget: command?.targetIdentity ?? null,
      });
    } else {
      logHealthEvent('cue_fallback', {
        sheetId: sheet.id,
        cueTimestampMs: cue.timestamp_ms,
        slotRole: cue.slot_role,
        fallbackBehaviour: sheet.fallback_behaviour,
        reason: 'no_live_feed',
      });
    }
  }

  function tick() {
    const { elapsedMs, isPlaying } = getPlayerState();

    if (!isPlaying) {
      // Paused (or not yet started) -- cues don't advance. Keep
      // lastElapsedMs in sync so a seek-while-paused doesn't read as a
      // huge jump on the tick play resumes on.
      lastElapsedMs = elapsedMs;
      lastWasPlaying = false;
      return;
    }

    // Just started/resumed -- always resync the pointer from scratch
    // rather than assuming continuity. Covers both a plain resume (a
    // no-op resync) and a seek that happened while paused (the only
    // case that actually needs it), without having to tell them apart.
    if (!lastWasPlaying) {
      nextCueIndex = findNextIndex(cues, elapsedMs);
      lastElapsedMs = elapsedMs;
      lastWasPlaying = true;
      return;
    }

    const expectedElapsedMs = lastElapsedMs + POLL_INTERVAL_MS;
    if (Math.abs(elapsedMs - expectedElapsedMs) > SEEK_TOLERANCE_MS) {
      logHealthEvent('cue_seek_detected', {
        sheetId: sheet.id,
        fromMs: lastElapsedMs,
        toMs: elapsedMs,
      });
      nextCueIndex = findNextIndex(cues, elapsedMs);
      lastElapsedMs = elapsedMs;
      return;
    }

    while (nextCueIndex < cues.length && cues[nextCueIndex].timestamp_ms <= elapsedMs) {
      fireCue(cues[nextCueIndex]);
      nextCueIndex += 1;
    }
    lastElapsedMs = elapsedMs;
  }

  return {
    start() {
      if (started) return;
      started = true;
      nextCueIndex = 0;
      lastElapsedMs = null;
      lastWasPlaying = false;
      suspendAuto();
      logHealthEvent('cue_playback_started', { sheetId: sheet.id, cueCount: cues.length });
      pollTimer = setInterval(tick, POLL_INTERVAL_MS);
    },
    stop() {
      if (!started) return;
      started = false;
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      resumeAuto();
      logHealthEvent('cue_playback_stopped', { sheetId: sheet.id });
    },
    dispose() {
      this.stop();
    },
    get state() {
      return started ? 'running' : 'off';
    },
  };
}
