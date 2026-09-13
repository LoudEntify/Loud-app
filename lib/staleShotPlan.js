// lib/staleShotPlan.js
// ─────────────────────────────────────────────────────────────
// Item 1 — what happens to a shot whose target camera has left.
//
// PRD: Live Show / Director Experience · S&I: Real-time media, Observability
//
// ── WHY THIS IS A PURE FUNCTION IN ITS OWN FILE ──
// The first version of item 1 lived as TWO useEffects inside RoomInner,
// each calling logHealthEvent from INSIDE a setActiveShot updater, with
// different dependency arrays: one on the track pool, one on the clock.
// That was wrong twice over.
//
//   1. A React state updater must be pure. React invokes it during the
//      render phase, may invoke it more than once for a single logical
//      update, and discards the result entirely when it decides to bail
//      out. Emitting a health event from inside one means the event and
//      the state change it describes have no guaranteed relationship —
//      the log can fire without the change landing, or the change can
//      land without the log.
//   2. Splitting suspend and downgrade across two effects meant two
//      independent triggers racing over one piece of state, and the
//      transition between them (suspended -> downgraded) was owned by
//      neither.
//
// The first device test found both: `stale_command_suspended` landed,
// `stale_command_resumed` and `stale_command_downgraded` never did, while
// the on-screen behaviour looked correct.
//
// So the decision is one pure function over (state, presence, clock) and
// the caller does exactly two side effects with its output: emit the
// events, then set the state. Same shape as lib/showWindow.js and
// lib/pairingLiveness.js, and testable for the same reason.
// ─────────────────────────────────────────────────────────────

// How long a command's target may stay out of the pool before the slot
// gives up on it and downgrades to a plain live shot (item 10).
//
// 20s is chosen against the thing it has to outlast: a camfeed that
// drops and returns comes back under the SAME identity — the session
// route reuses the stored device_identity
// (app/api/camfeed/session/route.js). That self-healing is worth
// protecting, and a LiveKit reconnect is seconds, not tens of seconds.
export const STALE_TARGET_DOWNGRADE_MS = 20000;

/**
 * Decide what every slot's command should become, and what to log.
 *
 * Returns `{ next, events, changed }`. `next` is the new activeShot map
 * (the same object reference when nothing changed, so the caller can
 * skip the setState entirely). `events` is an ordered list of
 * `{ type, detail }` for the caller to hand to logHealthEvent.
 *
 * @param activeShot      slot -> SHOT_COMMAND
 * @param isTargetPresent (slot, cmd) => boolean. Is the command's target
 *                        currently in this slot's renderable pool? The
 *                        caller supplies this so the predicate stays
 *                        identical to the one renderSlot uses.
 * @param describeSlot    (slot, cmd) => object. Extra detail for the
 *                        suspend event — the fallback actually chosen.
 *                        Called only when a suspension is emitted.
 * @param now             ms
 * @param ttlMs           downgrade TTL
 */
export function planStaleShots({
  activeShot,
  isTargetPresent,
  describeSlot = () => ({}),
  now,
  ttlMs = STALE_TARGET_DOWNGRADE_MS,
}) {
  const next = {};
  const events = [];
  let changed = false;

  Object.entries(activeShot || {}).forEach(([slot, cmd]) => {
    next[slot] = cmd;
    if (!cmd?.targetIdentity) return;

    const present = !!isTargetPresent(slot, cmd);
    const suspended = !!cmd.framingSuspended;
    const downgraded = !!cmd.downgradedFrom;

    // ── THE TARGET IS BACK ────────────────────────────────────
    // Restores after a downgrade too, and that is a deliberate
    // behaviour change from the first version, which had
    // `if (cmd.downgradedFrom) return` and so could never resume once
    // the TTL had fired. In manual mode that meant the operator had to
    // re-pin the camera after every blip long enough to downgrade —
    // which, on a two-location show where a wifi blip is routine, is not
    // an operable instruction.
    //
    // The director pinned THIS camera with THIS framing. The camera came
    // back under the same identity, so their decision has not been
    // superseded by anything; honouring it again is not a surprise cut,
    // it is the cut they asked for. `wasDowngraded` and `awayMs` go on
    // the event so a long restoration is still visible on the 21st.
    if (present && (suspended || downgraded)) {
      const restoredShot = cmd.downgradedFrom || cmd.shot;
      events.push({
        type: 'stale_command_resumed',
        detail: {
          slot,
          shot: restoredShot,
          targetIdentity: cmd.targetIdentity,
          awayMs: cmd.framingSuspendedAt ? now - cmd.framingSuspendedAt : null,
          wasDowngraded: downgraded,
        },
      });
      const { framingSuspended, framingSuspendedAt, downgradedFrom, ...rest } = cmd;
      next[slot] = { ...rest, shot: restoredShot };
      changed = true;
      return;
    }

    if (present) return;

    // ── THE TARGET HAS GONE ───────────────────────────────────
    // Keep the command and its target: a same-identity return
    // re-acquires the shot by itself, which is the live stage's
    // self-healing and the reason this does not simply drop the command
    // the way EgressPage does. Neutralise only the part that is actually
    // wrong — a replacement camera must never wear a crop composed for a
    // camera that no longer exists.
    if (!suspended && !downgraded) {
      events.push({
        type: 'stale_command_suspended',
        detail: {
          slot,
          shot: cmd.shot,
          targetIdentity: cmd.targetIdentity,
          targetSourceKey: cmd.targetSourceKey || null,
          ...describeSlot(slot, cmd),
        },
      });
      next[slot] = { ...cmd, framingSuspended: true, framingSuspendedAt: now };
      changed = true;
      return;
    }

    // ── STILL GONE AFTER THE TTL ──────────────────────────────
    // Give up and land on a plain, live, unzoomed shot (item 10).
    // SHOT_TYPES.wide.transform is null, so this is the neutral frame by
    // construction rather than by a magic number.
    //
    // targetIdentity is KEPT. It matches nothing, so renderSlot's
    // fallback picks the best live camera exactly as item 10 asks — and
    // if the camera returns later the resume branch above still fires.
    if (
      suspended &&
      !downgraded &&
      cmd.shot !== 'wide' &&
      cmd.framingSuspendedAt &&
      now - cmd.framingSuspendedAt >= ttlMs
    ) {
      events.push({
        type: 'stale_command_downgraded',
        detail: {
          slot,
          fromShot: cmd.shot,
          targetIdentity: cmd.targetIdentity,
          awayMs: now - cmd.framingSuspendedAt,
        },
      });
      const { framingSuspended, framingSuspendedAt, ...rest } = cmd;
      next[slot] = { ...rest, shot: 'wide', downgradedFrom: cmd.shot };
      changed = true;
    }
  });

  return { next: changed ? next : activeShot, events, changed };
}
