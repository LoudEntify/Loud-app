'use client';

// lib/useWakeLock.js
// ─────────────────────────────────────────────────────────────
// Keep the screen on while this device is doing something that must not
// be interrupted: publishing a camera, running a live show, or watching
// one. The YouTube behaviour — a video plays, the phone does not dim.
//
// ── WHY A DIMMED SCREEN IS NOT A COSMETIC PROBLEM ─────────────
// On a propped camfeed phone, the OS dimming the display is the first
// step of a sequence that ends with the display off and, on iOS,
// JavaScript suspended. Capture halts. The publication stays live and
// unmuted, because the device that would announce the death has been
// suspended by the OS and cannot run the code to announce it. The
// director's console keeps a frozen frame in rotation.
//
// That is the exact failure lib/trackLiveness.js's frame watchdog was
// built for, and it cost a full device sitting to diagnose.
//
// ── HOW THIS AND frames_stalled RELATE ────────────────────────
// They are not the same mechanism and neither replaces the other.
// Stating it plainly because building the second one without saying
// this is how you end up with two systems fighting:
//
//   THIS is PREVENTION, and it only covers the ACCIDENTAL case — the OS
//   dimming a phone nobody has touched. That is the common case and the
//   one that is pure loss: nobody wanted it and nobody noticed it.
//
//   frames_stalled is DETECTION, and it covers everything else. A wake
//   lock does NOT survive the power button. A person deliberately
//   locking the handset overrides it, by design, at the OS level — no
//   web API can or should prevent that. The screen goes off, capture
//   halts, and the ONLY remaining signal is that frames stopped
//   arriving, observed from another device.
//
// So the watchdog stays exactly as it is. This makes it fire less often;
// it does not make it unnecessary, and nothing here should ever be taken
// as a reason to relax it. Prevention that is claimed to be complete is
// worse than no prevention, because it retires the detection.
//
// ── RELEASE WHEN HIDDEN ───────────────────────────────────────
// A wake lock held by a backgrounded tab is a battery bug. The browser
// releases it automatically on visibilitychange, and this re-acquires on
// return — that re-acquisition is required, not optional: without it the
// lock is silently gone for the rest of the session after the first time
// the operator checks a message.
// ─────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from 'react';
import { logHealthEvent } from './healthLog';

export const WAKE_LOCK_SUPPORTED =
  typeof navigator !== 'undefined' && 'wakeLock' in navigator;

/**
 * Hold a screen wake lock while `active` is true.
 *
 * Returns { supported, held, reason } for the UI to report honestly. A
 * device that cannot hold the screen on should say so rather than let
 * someone prop a phone believing it is handled.
 *
 * @param {boolean} active  hold the lock now
 * @param {string}  label   what for — goes into health events, so a
 *                          timeline shows WHICH role held it
 */
export function useWakeLock(active, label = 'device') {
  const [held, setHeld] = useState(false);
  const [reason, setReason] = useState(null);
  const sentinelRef = useRef(null);
  // Effects re-run; the log should reflect real transitions, not renders.
  const loggedRef = useRef(false);

  useEffect(() => {
    if (!active) return undefined;

    if (!WAKE_LOCK_SUPPORTED) {
      setReason('unsupported');
      // iOS Safari before 16.4 is the population that matters here, and
      // it is a real share of the phones an artist will prop up. Logged
      // once so a device sitting can tell "the lock was not supported"
      // apart from "the lock was supported and failed".
      if (!loggedRef.current) {
        loggedRef.current = true;
        logHealthEvent('wake_lock_unsupported', { label });
      }
      return undefined;
    }

    let cancelled = false;

    async function acquire() {
      // Never while hidden: the browser rejects it, and the rejection is
      // indistinguishable from a real failure in the catch below.
      if (cancelled || document.visibilityState !== 'visible') return;
      if (sentinelRef.current) return;
      try {
        const sentinel = await navigator.wakeLock.request('screen');
        if (cancelled) { sentinel.release().catch(() => {}); return; }
        sentinelRef.current = sentinel;
        setHeld(true);
        setReason(null);
        logHealthEvent('wake_lock_acquired', { label });
        // Fires when the browser drops it for us — tab hidden, OS power
        // policy, the handset being locked. Not an error, and not
        // something to retry blindly: the visibility handler below is
        // what brings it back, when there is a screen to keep awake.
        sentinel.addEventListener('release', () => {
          sentinelRef.current = null;
          setHeld(false);
          logHealthEvent('wake_lock_released_by_system', { label });
        });
      } catch (err) {
        // The common non-failure: an OS-level low-power mode refusing.
        // Reported, not retried in a loop — a retry storm on a phone
        // already in low power is the wrong response to being told no.
        setReason('refused');
        logHealthEvent('wake_lock_refused', { label, detail: String(err?.message || err) });
      }
    }

    function onVisibility() {
      if (document.visibilityState === 'visible') acquire();
    }

    acquire();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      const sentinel = sentinelRef.current;
      sentinelRef.current = null;
      setHeld(false);
      if (sentinel) {
        // The role ended (show over, camera released, page left). Holding
        // on past that is the battery bug this is careful about.
        sentinel.release().catch(() => {});
        logHealthEvent('wake_lock_released', { label, cause: 'role_ended' });
      }
    };
  }, [active, label]);

  return { supported: WAKE_LOCK_SUPPORTED, held, reason };
}
