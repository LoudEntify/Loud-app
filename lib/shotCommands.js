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

const encoder = new TextEncoder();

// ─── Command construction ────────────────────────────────────
export function buildShotCommand({
  showId,
  slot,
  shotKey,
  fromShotKey = null,
  sourceRole,
  targetIdentity = null, // resolved by the caller BEFORE broadcasting -- viewers never role-match
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
export function resolveTargetIdentity(tracks, slot, role) {
  const slotTracks = tracks.filter(
    (t) =>
      (t.participant.identity.startsWith(`contestant-${slot}-`) ||
        t.participant.identity.startsWith(`camfeed-${slot}-`)) &&
      !t.publication?.isMuted
  );
  if (role && role !== 'main') {
    const match = slotTracks.find((t) =>
      t.participant.identity.startsWith(`camfeed-${slot}-${role}-`)
    );
    if (match) return match.participant.identity;
  }
  const main = slotTracks.find((t) =>
    t.participant.identity.startsWith(`contestant-${slot}-`)
  );
  return (main || slotTracks[0])?.participant.identity ?? null;
}

// ─── Broadcast (director side) ───────────────────────────────
// No topic -- LiveDemo routes every data message through one
// useDataChannel callback, distinguishing by `type` the same way it
// already does for 'comment' and (legacy) 'active-camera'.
export async function broadcastShotCommand(room, command) {
  const payload = encoder.encode(JSON.stringify(command));
  await room.localParticipant.publishData(payload, {
    reliable: true,
  });
  // Fire-and-forget flywheel log — never block the live cut on the DB
  logShotCommand(command).catch((err) =>
    console.warn('[flywheel] shot log failed', err)
  );
  return command;
}

// ─── Staccato sequencer (director side) ──────────────────────
// A mode, not a cut: start() begins emitting auto-labelled hard cuts
// from the pool at intervalMs; stop() halts it. Last-command-wins:
// starting staccato should be preceded by the caller suspending the
// auto-rotate timer (exclusive: true in the registry).
export function createStaccatoSequencer({ room, showId, slot, availableRoles, resolveTarget, showPhase }) {
  let timer = null;
  let poolIndex = 0;
  let lastShotKey = null;

  const cfg = SHOT_TYPES.staccato.transform;

  function fireCut() {
    const pool = cfg.pool;
    const shotKey = pool[poolIndex % pool.length];
    poolIndex += 1;

    const sourceRole = resolveSourceRole(shotKey, availableRoles);
    if (!sourceRole) return; // camera not publishing — skip this beat

    // Resolved fresh on every cut (not once at sequencer creation) so a
    // dropped or newly-joined camera feed mid-staccato is picked up
    // gracefully instead of the sequencer targeting a stale identity.
    const targetIdentity = resolveTarget ? resolveTarget(sourceRole) : null;

    const command = buildShotCommand({
      showId,
      slot,
      shotKey,
      fromShotKey: lastShotKey,
      sourceRole,
      targetIdentity,
      decisionSource: 'auto', // weak label — sequencer cut, not human cut
      // showPhase is a getter, not a value, for the same reason as
      // resolveTarget above -- read fresh on every cut.
      ...(showPhase ? { showPhase: showPhase() } : {}),
      availableRoles,
    });
    lastShotKey = shotKey;
    broadcastShotCommand(room, command);
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
