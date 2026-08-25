// lib/shotCommands.js
// ─────────────────────────────────────────────────────────────
// Shot command transport + staccato sequencer + flywheel logging.
//
// Architecture (locked): director broadcasts small JSON commands over
// the LiveKit data channel (relies on canPublishData: true in the
// token route — already in place since the reactions fix). Every
// ViewerStage applies the transform locally via ShotRenderer.
//
// PRD: Director Experience | S&I: Real-time media, Observability
// ─────────────────────────────────────────────────────────────

import { DataPacket_Kind } from 'livekit-client';
import { SHOT_TYPES, resolveTransition, resolveSourceRole } from './shotTypes';
import { logHealthEvent } from './healthLog';
import { describeTransport } from './transportDiagnostics';
import {
  BROLL_ROLE,
  belongsToSlot,
  cameraRolesOnly,
  cameraTracksOnly,
  roleOfTrack,
  sourceKey,
} from './trackSources';

const encoder = new TextEncoder();

// ─── Publish outcome subscription (fix (c), SHOW-1 diagnosis round) ──
// Lets RoomInner track consecutive publish failures and drive recovery
// without broadcastShotCommand needing to know anything about React,
// the director, or DirectorShotPanel -- every shot (auto, human,
// staccato) already funnels through this one function, so subscribing
// here is the single choke point that sees all of them. A listener
// throwing is caught and swallowed so a bad subscriber can never break
// a live cut.
const publishOutcomeListeners = new Set();
export function onPublishOutcome(listener) {
  publishOutcomeListeners.add(listener);
  return () => publishOutcomeListeners.delete(listener);
}
function notifyPublishOutcome(outcome) {
  publishOutcomeListeners.forEach((fn) => {
    try {
      fn(outcome);
    } catch (err) {
      console.warn('[shotCommands] onPublishOutcome listener failed', err);
    }
  });
}

// ─── Command construction ────────────────────────────────────
export function buildShotCommand({
  showId,
  slot,
  shotKey,
  fromShotKey = null,
  sourceRole,
  targetIdentity = null, // resolved by the caller BEFORE broadcasting -- viewers never role-match
  // WHICH TRACK of that participant. `targetIdentity` was a complete
  // answer while one participant meant one track; b-roll made it
  // ambiguous, because a clip is published by the artist's OWN
  // participant and so carries the artist's identity. Without this a
  // command meaning "the clip" resolves, on every receiving client, to
  // "the face".
  //
  // Null is legal and means "identity is the whole test" — see
  // matchesTarget in lib/trackSources.js for why that keeps a
  // mid-deploy mix of old and new clients working.
  targetSourceKey = null,
  params = {},
  decisionSource = 'human', // 'human' | 'auto' — the flywheel label
  showPhase = 'live', // 'soundcheck' | 'live' — soundcheck taps must not pollute Layer 3 training data
  availableRoles = [], // roles publishing (and unmuted) for this slot at fire time -- flywheel context (L6-5)
}) {
  return {
    type: 'SHOT_COMMAND',
    commandId:
      (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    timestamp: Date.now(),
    showId,
    slot,
    shot: shotKey,
    fromShot: fromShotKey, // negative signal: what the human cut AWAY from
    sourceRole,
    targetIdentity,
    targetSourceKey,
    transition: resolveTransition(fromShotKey, shotKey),
    params,
    decisionSource,
    showPhase,
    availableRoles,
  };
}

// ─── Target resolution (director side) ───────────────────────
// Maps a shot's desired role to a concrete participant identity from the
// live track list. Falls back: exact role → main (contestant) → any feed.
// Muted tracks are excluded (SHOW_LIFECYCLE_SPEC.md L6-1) -- a muted
// participant is unavailable the same as one who never published.
export function resolveTargetTrack(tracks, slot, role) {
  const slotTracks = (tracks || []).filter(
    (t) => belongsToSlot(t, slot) && !t.publication?.isMuted
  );

  // Exact role match first. roleOfTrack (lib/trackSources.js) is what
  // makes this correct for b-roll: it reads the PUBLICATION, so a clip
  // published by the artist's own participant answers 'broll' and never
  // 'main', however the identity happens to read.
  if (role) {
    const match = slotTracks.find((t) => roleOfTrack(t) === role);
    if (match) return match;
  }

  // ── NO FALLBACK OUT OF B-ROLL ──
  // If a clip was asked for and no clip is publishing, the answer is
  // nothing. Falling through to the camera chain below would put the
  // artist's face on air under a command that says "clip" — which is the
  // precise failure this round exists to make impossible, arrived at
  // from the other direction.
  if (role === BROLL_ROLE) return null;

  // ── AND NO FALLBACK INTO IT ──
  // Every camera fallback resolves against cameras only. A director who
  // asks for WIDE with no wide camera up should land on the performer,
  // never on whatever clip happens to be playing.
  const cameras = cameraTracksOnly(slotTracks);
  const main = cameras.find((t) => roleOfTrack(t) === 'main');
  return main || cameras[0] || null;
}

/**
 * Identity only. Kept because several call sites genuinely want the
 * participant and nothing more (telemetry, the auto director's
 * same-feed comparison). Anything BUILDING a command wants
 * resolveTargetTrack, so it can carry the source key too.
 */
export function resolveTargetIdentity(tracks, slot, role) {
  return resolveTargetTrack(tracks, slot, role)?.participant?.identity ?? null;
}

/** Both halves of a command's target, resolved once, from one selection. */
export function resolveTarget(tracks, slot, role) {
  const track = resolveTargetTrack(tracks, slot, role);
  return {
    targetIdentity: track?.participant?.identity ?? null,
    targetSourceKey: track ? sourceKey(track) : null,
  };
}

// ─── Broadcast (director side) ───────────────────────────────
// No topic -- LiveDemo routes every data message through one
// useDataChannel callback, distinguishing by `type` the same way it
// already does for 'comment' and (legacy) 'active-camera'.
export async function broadcastShotCommand(room, command) {
  const payload = encoder.encode(JSON.stringify(command));
  // Health-event visibility (Phase 2 diagnostic instrumentation) --
  // connectionState is read at call time so a publishData failure during
  // a reconnect window is distinguishable from one during a nominally
  // healthy connection. Logging is fail-silent by construction
  // (lib/healthLog.js); never gates or delays the actual publish below.
  const connectionState = room?.state ?? null;
  try {
    await room.localParticipant.publishData(payload, {
      reliable: true,
    });
    logHealthEvent('shot_publish_success', {
      commandId: command.commandId,
      shot: command.shot,
      slot: command.slot,
      decisionSource: command.decisionSource,
      connectionState,
    });
    notifyPublishOutcome({ success: true, room, connectionState });
  } catch (err) {
    // Fix (b3) -- connectionState alone was never enough to explain a
    // failure here: it reads 'connected' throughout the poisoned-engine
    // case (confirmed in a real capture). The transport snapshot is what
    // distinguishes "publisher path is gone" (hasPcManager: false, the
    // exact precondition for 'PC manager is closed') from a genuine
    // network problem.
    logHealthEvent('shot_publish_failure', {
      commandId: command.commandId,
      shot: command.shot,
      slot: command.slot,
      decisionSource: command.decisionSource,
      connectionState,
      transport: describeTransport(room),
      error: String(err?.message || err),
    });
    notifyPublishOutcome({ success: false, room, connectionState, error: err });
    throw err;
  }
  // Fire-and-forget flywheel log — never block the live cut on the DB
  logShotCommand(command).catch((err) =>
    console.warn('[flywheel] shot log failed', err)
  );
  return command;
}

// ─── Health probe (audio-reconnect round) ─────────────────────
// Not a shot command -- a minimal reliable data-channel message used
// only to accumulate fix (c)'s 3-consecutive-failures threshold faster
// than waiting on the director's own cut cadence (10-20s between
// attempts, confirmed from a real capture: 53s to reach 3 failures).
// Routes through the same notifyPublishOutcome pub/sub as
// broadcastShotCommand, so a probe failure counts toward the same
// consecutive-failure counter in RoomInner, but logs under its own event
// names so it's distinguishable from a real shot failure in the
// timeline. {type: 'HEALTH_PROBE'} is not one of the types LiveDemo.jsx's
// useDataChannel handler recognizes (comment/SHOT_COMMAND/SHOW_LIVE/
// SHOW_ENDED/ACTIVE_PERFORMER_SWITCH) -- confirmed by reading that
// handler directly, not assumed: it's a flat sequence of independent
// `if (payload.type === ...)` checks with no default/else branch, so an
// unrecognized type is silently ignored on every receiving client.
export async function publishHealthProbe(room) {
  const payload = encoder.encode(JSON.stringify({ type: 'HEALTH_PROBE', ts: Date.now() }));
  const connectionState = room?.state ?? null;
  try {
    await room.localParticipant.publishData(payload, { reliable: true });
    logHealthEvent('health_probe_publish_success', { connectionState });
    notifyPublishOutcome({ success: true, room, connectionState });
  } catch (err) {
    logHealthEvent('health_probe_publish_failure', { connectionState, transport: describeTransport(room), error: String(err?.message || err) });
    notifyPublishOutcome({ success: false, room, connectionState, error: err });
    throw err;
  }
}

// ─── Staccato sequencer (director side) ──────────────────────
// A mode, not a cut: start() begins emitting auto-labelled hard cuts
// from the pool at intervalMs; stop() halts it. Last-command-wins:
// starting staccato should be preceded by the caller suspending the
// auto-rotate timer (exclusive: true in the registry).
export function createStaccatoSequencer({ room, showId, slot, availableRoles, resolveTargetFor, showPhase }) {
  let timer = null;
  let poolIndex = 0;
  let lastShotKey = null;

  const cfg = SHOT_TYPES.staccato.transform;

  function fireCut() {
    const pool = cfg.pool;
    const shotKey = pool[poolIndex % pool.length];
    poolIndex += 1;

    // CAMERAS ONLY. The sequencer must never wander into a b-roll clip:
    // its whole character is a rapid hard-cut run between framings of a
    // performer, and hard-cutting into and out of a playing clip every
    // 500ms is not a shot, it is a strobe over somebody's edit. Filtered
    // here rather than trusted from the caller so no future caller can
    // hand it a role list containing 'broll'.
    const sourceRole = resolveSourceRole(shotKey, cameraRolesOnly(availableRoles));
    if (!sourceRole) return; // camera not publishing — skip this beat

    // Resolved fresh on every cut (not once at sequencer creation) so a
    // dropped or newly-joined camera feed mid-staccato is picked up
    // gracefully instead of the sequencer targeting a stale identity.
    const { targetIdentity, targetSourceKey } = resolveTargetFor
      ? resolveTargetFor(sourceRole)
      : { targetIdentity: null, targetSourceKey: null };

    const command = buildShotCommand({
      showId,
      slot,
      shotKey,
      fromShotKey: lastShotKey,
      sourceRole,
      targetIdentity,
      targetSourceKey,
      decisionSource: 'auto', // weak label — sequencer cut, not human cut
      // showPhase is a getter, not a value, for the same reason as
      // resolveTarget above -- read fresh on every cut.
      ...(showPhase ? { showPhase: showPhase() } : {}),
      availableRoles,
    });
    lastShotKey = shotKey;
    // Not awaited (this runs off setInterval, not an async caller) and
    // deliberately caught here -- a beat landing during a disconnected/
    // reconnecting window (LiveKit auto-reconnects; the engine's
    // pcManager is transiently null in between, confirmed against the
    // compiled SDK source) throws UnexpectedConnectionState. That's
    // expected and self-heals on the next beat once reconnected -- same
    // fire-and-forget, log-and-swallow principle as the flywheel log
    // above and triggerEgress in LiveDemo.jsx, not a bug to propagate.
    // Uncaught, this was 37 unhandled-rejection console entries for a
    // single dropped connection during Stage 6 testing.
    broadcastShotCommand(room, command).catch((err) =>
      console.warn('[staccato] cut broadcast failed (likely a transient reconnect)', err)
    );
  }

  return {
    start(intervalMs = cfg.intervalMs) {
      if (timer) return;
      fireCut(); // cut immediately, then on the interval
      timer = setInterval(fireCut, intervalMs);
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
    get running() {
      return timer !== null;
    },
  };
}

// ─── Flywheel logging (Supabase) ─────────────────────────────
// Each command is one labelled training row. Uses a lazy dynamic
// import so this file stays usable in any component without forcing
// the Supabase client into every bundle.
//
// Run this once in the Supabase SQL editor:
//
//   create table if not exists shot_commands (
//     command_id      uuid primary key,
//     show_id         text not null,
//     slot            text not null,
//     shot            text not null,
//     from_shot       text,          -- negative signal
//     source_role     text,
//     transition      text,
//     params          jsonb default '{}'::jsonb,
//     decision_source text not null, -- 'human' = gold, 'auto' = weak
//     fired_at        timestamptz not null,
//     created_at      timestamptz default now()
//   );
//   create index if not exists shot_commands_show_idx
//     on shot_commands (show_id, fired_at);
//
// SHOW_LIFECYCLE_SPEC.md section 2 adds one more column, run separately:
//
//   alter table shot_commands add column if not exists show_phase text default 'live';
//
async function logShotCommand(command) {
  const { getSupabase } = await import('./supabaseClient'); // your existing client helper
  const supabase = getSupabase();
  await supabase.from('shot_commands').insert({
    command_id: command.commandId,
    show_id: command.showId,
    slot: command.slot,
    shot: command.shot,
    from_shot: command.fromShot,
    source_role: command.sourceRole,
    transition: command.transition,
    params: command.params,
    decision_source: command.decisionSource,
    show_phase: command.showPhase,
    // available_roles column already exists per the L6 addendum -- no
    // SQL needed here, unlike show_phase above.
    available_roles: command.availableRoles,
    fired_at: new Date(command.timestamp).toISOString(),
  });
}
