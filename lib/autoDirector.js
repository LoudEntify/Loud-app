// lib/autoDirector.js
// ─────────────────────────────────────────────────────────────
// Layer 1 Auto-Director: rules-based, hands-free default.
//
// Rule of engagement (locked):
//   1. Auto runs by default when a show starts.
//   2. Any human SHOT_COMMAND executes instantly (last-command-wins)
//      and silences auto for OVERRIDE_COOLDOWN_MS. Each human tap
//      resets the cooldown.
//   3. Staccato (exclusive mode) suspends auto until stopped.
//      An explicit disable() covers full-manual shows.
//
// Emits through the same pipe as human taps — buildShotCommand +
// broadcast — with decisionSource: 'auto' (weak labels). Human
// interruptions of auto are the flywheel's gold signal, captured
// via fromShot on the overriding command.
//
// Layer 2 upgrade path: replace the randomised interval with
// beat-aware timing from audio analysis. Same schema, smarter clock.
//
// PRD: Director Experience / AI Director Layer 1
// S&I: Real-time media, Observability
// ─────────────────────────────────────────────────────────────

import { SHOT_TYPES } from './shotTypes';

export const OVERRIDE_COOLDOWN_MS = 45_000;

// Pilot cutting brain: weighted shot pool + varied pacing.
const AUTO_POOL = [
  { shot: 'wide',    weight: 30 },
  { shot: 'mediumCU',weight: 20 },
  { shot: 'closeUp', weight: 20 },
  { shot: 'bRoll',   weight: 18 },
  { shot: 'zoomIn',  weight: 12 }, // occasional push for energy
];
const MIN_HOLD_MS = 8_000;
const MAX_HOLD_MS = 20_000;

function pickWeighted(pool, excludeShot) {
  const candidates = pool.filter((p) => p.shot !== excludeShot);
  const total = candidates.reduce((s, p) => s + p.weight, 0);
  let r = Math.random() * total;
  for (const p of candidates) {
    r -= p.weight;
    if (r <= 0) return p.shot;
  }
  return candidates[candidates.length - 1].shot;
}

function nextHoldMs(shotKey) {
  // Moving shots hold for their animation duration + a beat;
  // static shots hold a randomised interval.
  const t = SHOT_TYPES[shotKey]?.transform;
  if (t?.kind === 'animatedZoom') return t.durationMs + 2_000;
  return MIN_HOLD_MS + Math.random() * (MAX_HOLD_MS - MIN_HOLD_MS);
}

// ─────────────────────────────────────────────────────────────
// createAutoDirector({ fireShot, getAvailableShots })
//   fireShot(shotKey, decisionSource) — caller's emit function; must
//     route through buildShotCommand/broadcast so grammar + logging
//     apply identically to human taps. Returns nothing.
//   getAvailableShots() — returns shot keys currently viable (i.e.
//     whose source feeds are live); auto only picks from these.
//
// Wire-up contract with DirectorShotPanel:
//   - every HUMAN fire() in the panel must call auto.notifyHumanCommand()
//   - staccato start/stop calls auto.suspend()/auto.resume()
//   - the Auto ON/OFF toggle calls auto.disable()/auto.enable()
// ─────────────────────────────────────────────────────────────
export function createAutoDirector({ fireShot, getAvailableShots }) {
  let timer = null;          // pending next-cut timeout
  let cooldownTimer = null;  // pending resume-after-human timeout
  let enabled = true;        // master switch (UI toggle)
  let suspended = false;     // exclusive mode (staccato) hold
  let started = false;       // true only between start() and stop()
  let lastShot = null;

  function clearTimers() {
    if (timer) { clearTimeout(timer); timer = null; }
  }

  // `started` is the authoritative gate -- every path that can lead to a
  // cut (start, resume, enable, cut's own no-feeds retry, and the
  // cooldown-expiry callback below) all funnel through this one
  // function, so gating it here is what actually makes "auto only ever
  // cuts between start() and stop()" true, not just true for the one
  // call site that motivated the fix. `enabled` alone wasn't enough: it
  // defaults to true at construction, so before start() is ever called,
  // an armed-but-never-started instance would still schedule a cut once
  // notifyHumanCommand()'s cooldown expired -- a soundcheck shot tap
  // firing an auto cut 45s later, before the show was ever live.
  function scheduleNext(delayMs) {
    clearTimers();
    if (!started || !enabled || suspended) return;
    timer = setTimeout(cut, delayMs);
  }

  function cut() {
    if (!enabled || suspended) return;
    const available = getAvailableShots();
    const pool = AUTO_POOL.filter((p) => available.includes(p.shot));
    if (pool.length === 0) {
      scheduleNext(3_000); // no feeds yet — check again soon
      return;
    }
    const shotKey = pickWeighted(pool.length > 1 ? pool : AUTO_POOL, lastShot);
    lastShot = shotKey;
    fireShot(shotKey, 'auto'); // weak label
    scheduleNext(nextHoldMs(shotKey));
  }

  return {
    start() {
      started = true;
      enabled = true;
      suspended = false;
      scheduleNext(1_000); // first cut shortly after show start
    },

    // Human tap anywhere on the panel → instant silence + cooldown.
    // The human's own command is fired by the panel, not by us. Taps
    // before start() (soundcheck) still reset this timer -- harmless,
    // since scheduleNext requires `started` regardless -- but the
    // explicit check here means that's true by inspection, not just by
    // tracing into scheduleNext.
    notifyHumanCommand() {
      clearTimers();
      if (cooldownTimer) clearTimeout(cooldownTimer);
      cooldownTimer = setTimeout(() => {
        cooldownTimer = null;
        if (started && enabled && !suspended) scheduleNext(500);
      }, OVERRIDE_COOLDOWN_MS);
    },

    // Exclusive modes (staccato) — hard hold, no cooldown logic.
    suspend() {
      suspended = true;
      clearTimers();
    },
    resume() {
      suspended = false;
      if (enabled && !cooldownTimer) scheduleNext(1_000);
    },

    // Master switch (UI toggle for full-manual shows).
    enable() {
      enabled = true;
      if (!suspended && !cooldownTimer) scheduleNext(1_000);
    },
    disable() {
      enabled = false;
      started = false;
      clearTimers();
      if (cooldownTimer) { clearTimeout(cooldownTimer); cooldownTimer = null; }
    },

    stop() { // teardown on unmount / show end
      this.disable();
    },

    get state() {
      if (!started || !enabled) return 'off';
      if (suspended) return 'suspended';
      if (cooldownTimer) return 'cooldown';
      return 'running';
    },
  };
}
