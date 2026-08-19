// lib/autoDirector.js
// ─────────────────────────────────────────────────────────────
// Layer 1 Auto-Director: rules-based, hands-free default.
//
// Rule of engagement (CD-4, supersedes the old fixed-cooldown rule):
//   1. Auto runs by default when a show starts.
//   2. Any human SHOT_COMMAND executes instantly (last-command-wins) and
//      does NOT touch auto's own already-scheduled timer at all -- auto
//      simply fires its next cut whenever it was already going to,
//      silently overwriting the human's tap. That's the whole override
//      rule now: a human tap wins until the next automatic decision,
//      then auto resumes -- no separate cooldown window to track.
//   3. Staccato (exclusive mode) suspends auto until stopped.
//      An explicit disable() covers full-manual shows.
//
// Emits through the same pipe as human taps — buildShotCommand +
// broadcast — with decisionSource: 'auto' (weak labels). Human
// interruptions of auto are the flywheel's gold signal, captured
// via fromShot on the overriding command.
//
// Choreography (replaces the old weighted-random picker): a fixed
// framing cycle, walked in order, that skips a step if its feed isn't
// live OR if it would only be a crop-size change on the feed already
// showing (no real angle change) -- falling back to a same-feed step
// only when nothing in the pattern resolves to a different feed at
// all (single-camera mode). staccato is never in the pattern and is
// explicitly excluded by getAvailableShots's 'multi' branch too.
//
// Layer 2 upgrade path: replace the randomised hold timing with
// beat-aware timing from audio analysis. Same schema, smarter clock.
//
// PRD: Director Experience / AI Director Layer 1
// S&I: Real-time media, Observability
// ─────────────────────────────────────────────────────────────

import { SHOT_TYPES } from './shotTypes';

// Fixed choreography rhythm -- NOT random. Repeats: wide -> mediumCU ->
// closeUp -> bRoll -> mediumCU -> (wide again). mediumCU appears twice
// per lap (once on the way in, once on the way back out) so the shape
// is wide-anchored without needing a distinct "medium out" shot.
const CYCLE_PATTERN = ['wide', 'mediumCU', 'closeUp', 'bRoll', 'mediumCU'];

// Hold-time range per framing, ms. Wider shots read fine held a little
// longer; tighter shots feel stale faster if held too long.
const HOLD_RANGE_MS = {
  wide: [12_000, 18_000],
  mediumCU: [9_000, 14_000],
  closeUp: [6_000, 10_000],
  bRoll: [8_000, 14_000],
};

// Per-framing probability a technique (zoom/pan) is substituted in for
// a plain static cut. 0 on closeUp -- never, already tight. bRoll is
// deliberately sparser than wide/medium.
const TECHNIQUE_CHANCE = { wide: 0.3, mediumCU: 0.25, closeUp: 0, bRoll: 0.1 };
// Plain (non-technique) steps required between any two technique steps.
const TECHNIQUE_COOLDOWN_STEPS = 2;
const TECHNIQUE_POOL = ['zoomIn', 'zoomOut', 'pan'];

// Single-camera mode (every live framing resolves to the feed already
// on screen -- no angle change exists anywhere in the pattern). Movement
// is the only source of visual variety here (Item 4c), so this is still
// higher than the normal per-framing rates above -- but techniques
// should read as seasoning, not the main event; the remaining share
// holds the current shot longer instead of cutting.
const SINGLE_CAM_TECHNIQUE_CHANCE = 0.2;
const SINGLE_CAM_HOLD_BONUS_MS = 6_000; // extra hold on top of the normal range when movement IS applied
const SINGLE_CAM_HOLD_EXTENSION_MS = 10_000; // how long to wait before re-checking when just holding

const NO_FEED_RETRY_MS = 3_000; // nothing in the pattern is live at all -- check again soon

function nextHoldMs(framing, shotKey, singleCamMode) {
  const t = SHOT_TYPES[shotKey]?.transform;
  const base =
    t?.kind === 'animatedZoom' || t?.kind === 'animatedPan'
      ? t.durationMs + 2_000 // hold a beat after the move settles
      : (() => {
          const [min, max] = HOLD_RANGE_MS[framing];
          return min + Math.random() * (max - min);
        })();
  return singleCamMode ? base + SINGLE_CAM_HOLD_BONUS_MS : base;
}

// ─────────────────────────────────────────────────────────────
// createAutoDirector({ fireShot, getAvailableShots, resolveFeed, getCurrentFeed })
//   fireShot(shotKey, decisionSource, meta) — caller's emit function;
//     must route through buildShotCommand/broadcast so grammar +
//     logging apply identically to human taps. `meta.framingHint` is
//     the cycle's intended framing (e.g. 'wide') even when shotKey is
//     a technique standing in for it -- the caller resolves the
//     technique's source role against the HINT, not the technique's
//     own ambiguous 'currentOrSelected' source, so a themed zoom/pan
//     lands on the same feed the cycle actually chose. Returns nothing.
//   getAvailableShots() — shot keys currently viable (source feed live).
//   resolveFeed(shotKey) — the concrete feed (participant identity) a
//     shot key would resolve to right now, given live roles/tracks.
//   getCurrentFeed() — the feed identity of whatever is ACTUALLY
//     showing for this slot right now (reflects human cuts too, not
//     just auto's own last pick).
//
// Wire-up contract with DirectorShotPanel:
//   - staccato start/stop calls auto.suspend()/auto.resume()
//   - the mode control calls auto.start()/auto.disable() (CD-4's
//     Manual/Auto/Cue three-state control, components/LiveDemo.jsx)
// A human tap needs no call into this module at all anymore -- see the
// rule-of-engagement note above.
// ─────────────────────────────────────────────────────────────
export function createAutoDirector({ fireShot, getAvailableShots, resolveFeed, getCurrentFeed }) {
  let timer = null;          // pending next-cut timeout
  let enabled = true;        // master switch (UI toggle)
  let suspended = false;     // exclusive mode (staccato) hold
  let started = false;       // true only between start() and stop()
  let cycleIndex = 0;        // pointer into CYCLE_PATTERN
  let stepsSinceTechnique = TECHNIQUE_COOLDOWN_STEPS; // eligible from the first step

  function clearTimers() {
    if (timer) { clearTimeout(timer); timer = null; }
  }

  // `started` is the authoritative gate -- every path that can lead to a
  // cut (start, resume, enable, and cut's own no-feeds retry) all funnel
  // through this one function, so gating it here is what actually makes
  // "auto only ever cuts between start() and stop()" true, not just true
  // for the one call site that motivated the fix. `enabled` alone wasn't
  // enough: it defaults to true at construction, so before start() is
  // ever called, an armed-but-never-started instance could still
  // schedule a cut from some other call path.
  function scheduleNext(delayMs) {
    clearTimers();
    if (!started || !enabled || suspended) return;
    timer = setTimeout(cut, delayMs);
  }

  function fireNormalStep(framing) {
    let shotKey = framing;
    if (stepsSinceTechnique >= TECHNIQUE_COOLDOWN_STEPS && Math.random() < (TECHNIQUE_CHANCE[framing] ?? 0)) {
      shotKey = TECHNIQUE_POOL[Math.floor(Math.random() * TECHNIQUE_POOL.length)];
    }
    stepsSinceTechnique = shotKey === framing ? stepsSinceTechnique + 1 : 0;
    fireShot(shotKey, 'auto', { framingHint: framing });
    scheduleNext(nextHoldMs(framing, shotKey, false));
  }

  function cut() {
    if (!enabled || suspended) return;
    const available = getAvailableShots();
    const currentFeed = getCurrentFeed();

    // Walk the pattern from the pointer, preferring the next step that
    // is BOTH live AND resolves to a different feed than what's already
    // showing (a real angle change) -- re-evaluated fresh every tick so
    // a camera joining/dropping mid-show changes the cycle live. A
    // step whose feed matches the current one is remembered as a
    // fallback but skipped in favor of a real angle change if one is
    // available anywhere in the pattern.
    let framing = null;
    let fallback = null;
    for (let i = 0; i < CYCLE_PATTERN.length; i++) {
      const idx = (cycleIndex + i) % CYCLE_PATTERN.length;
      const candidate = CYCLE_PATTERN[idx];
      if (!available.includes(candidate)) continue;
      const sameFeed = currentFeed != null && resolveFeed(candidate) === currentFeed;
      if (!sameFeed) {
        framing = candidate;
        cycleIndex = (idx + 1) % CYCLE_PATTERN.length;
        break;
      }
      if (!fallback) fallback = { candidate, idx };
    }

    if (framing) {
      fireNormalStep(framing);
      return;
    }

    if (!fallback) {
      scheduleNext(NO_FEED_RETRY_MS); // nothing in the cycle is live yet
      return;
    }

    // Single-camera mode: every live framing lands on the feed already
    // on screen -- no angle change exists to cut to anywhere in the
    // pattern. Per Item 4c: never fake multi-shot with a flat crop-cut
    // here. Either apply movement (a themed zoom/pan on the same feed,
    // held longer than usual), or hold the current shot longer and fire
    // nothing this tick -- re-evaluated on the next scheduled check in
    // case a second camera joins.
    if (Math.random() < SINGLE_CAM_TECHNIQUE_CHANCE) {
      const shotKey = TECHNIQUE_POOL[Math.floor(Math.random() * TECHNIQUE_POOL.length)];
      cycleIndex = (fallback.idx + 1) % CYCLE_PATTERN.length;
      fireShot(shotKey, 'auto', { framingHint: fallback.candidate });
      scheduleNext(nextHoldMs(fallback.candidate, shotKey, true));
    } else {
      scheduleNext(SINGLE_CAM_HOLD_EXTENSION_MS);
    }
  }

  return {
    start() {
      started = true;
      enabled = true;
      suspended = false;
      scheduleNext(1_000); // first cut shortly after show start
    },

    // Exclusive modes (staccato) — hard hold.
    suspend() {
      suspended = true;
      clearTimers();
    },
    resume() {
      suspended = false;
      if (enabled) scheduleNext(1_000);
    },

    // Master switch -- the mode control (CD-4) calls these directly on
    // every Manual/Auto/Cue transition.
    enable() {
      enabled = true;
      if (!suspended) scheduleNext(1_000);
    },
    disable() {
      enabled = false;
      started = false;
      clearTimers();
    },

    stop() { // teardown on unmount / show end
      this.disable();
    },

    get state() {
      if (!started || !enabled) return 'off';
      if (suspended) return 'suspended';
      return 'running';
    },
  };
}
