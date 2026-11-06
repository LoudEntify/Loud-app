// native/src/spike/commands.js — the main-device control protocol over
// LiveKit data messages. JSON on topic TOPIC, reliable delivery. Every
// command carries the sender's server-clock timestamp; every ack carries
// the six timestamps B5 asks for, so a round trip can be reconstructed
// from either side's record.
//
// PRD rows 12, 13, 127, 128. S&I: Real-time media, Observability.

import { PAN_DEFAULTS, BOP_DEFAULTS } from './zoomPlan.js';

export const TOPIC = 'loud.camera';
export const PROTOCOL_VERSION = 1;

const enc = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
const dec = typeof TextDecoder !== 'undefined' ? new TextDecoder() : null;

let seq = 0;
export function mintId(prefix = 'cmd') { seq += 1; return `${prefix}-${Date.now().toString(36)}-${seq.toString(36)}`; }

export function zoomCommand({ target, durationMs = 2000, easing = 'ease-in-out', decidedAt, source = 'main-device', decisionId = mintId('dec') }) {
  return { v: PROTOCOL_VERSION, type: 'zoom', id: mintId(), decisionId, source, target, durationMs, easing, decidedAt };
}
export function panCommand({ direction, degree = PAN_DEFAULTS.degree, window = PAN_DEFAULTS.window, durationMs = PAN_DEFAULTS.durationMs, easing = PAN_DEFAULTS.easing, decidedAt, source = 'main-device', decisionId = mintId('dec') }) {
  return { v: PROTOCOL_VERSION, type: 'pan', id: mintId(), decisionId, source, direction, degree, window, durationMs, easing, decidedAt };
}
/** A bop (zoomPlan.js bopPlan): direction ∈ BOP_DIRECTIONS, tempo in bpm, length in ms, strength 0.2 to 2. */
export function bopCommand({ direction, bpm = BOP_DEFAULTS.bpm, durationMs = BOP_DEFAULTS.durationMs, strength = BOP_DEFAULTS.strength, decidedAt, source = 'main-device', decisionId = mintId('dec') }) {
  return { v: PROTOCOL_VERSION, type: 'bop', id: mintId(), decisionId, source, direction, bpm, durationMs, strength, decidedAt };
}
export function surveyRequest({ decidedAt, decisionId = mintId('dec') }) { return { v: PROTOCOL_VERSION, type: 'survey', id: mintId(), decisionId, decidedAt }; }

// ── pro mode (docs/SPIKE_PRO_MODE_PLAN.md section 2) ──────────────
/**
 * One manual-control change on the camera: control ∈ iso | shutter | wb |
 * focus | ev | lock | unlock | enable | disable; value as proMode.js
 * says (ISO number, shutter ms, Kelvin, diopters, stops; 'ae' | 'awb' |
 * 'af' for the locks; ignored for enable/disable).
 */
export function proCommand({ control, value = null, decidedAt, source = 'main-device', decisionId = mintId('dec') }) {
  return { v: PROTOCOL_VERSION, type: 'pro', id: mintId(), decisionId, source, control, value, decidedAt };
}
/**
 * Match cameras, in two phases: 'read' asks the reference camera for its
 * current exposure and white balance; 'apply' carries those targets to
 * every camera, which locks to the nearest values it can achieve.
 */
export function matchCommand({ phase, targets = null, reference = null, decidedAt, source = 'main-device', decisionId = mintId('dec') }) {
  return { v: PROTOCOL_VERSION, type: 'match', id: mintId(), decisionId, source, phase, targets, reference, decidedAt };
}
/** Tell the camera which test stage it is in ('A' | 'B'), so both sides tag their records the same. */
export function stageCommand({ stage, decidedAt, decisionId = mintId('dec') }) {
  return { v: PROTOCOL_VERSION, type: 'stage', id: mintId(), decisionId, stage, decidedAt };
}
/**
 * The show's orientation for every camera ('portrait' | 'landscape',
 * docs/DECISIONS.md 2026-10-14; src/spike/orientation.js). Sent from the
 * main device before the show and locked once live: a camera that is
 * live (a stage or a move running) refuses it with `refused: true`.
 */
export function orientationCommand({ orientation, decidedAt, source = 'main-device', decisionId = mintId('dec') }) {
  return { v: PROTOCOL_VERSION, type: 'orientation', id: mintId(), decisionId, source, orientation, decidedAt };
}

/**
 * Camera → controller, on every change of the mount (never per frame): the
 * physical mount, whether it agrees with the show, the warning and its
 * one-line fix. A resolved mount sends `mismatch: false` and clears the warning
 * on the controller (docs/DECISIONS.md 2026-10-15).
 */
export function mountStatus({ chosen, physical, mismatch, warning = null, fix = null, desiredRotation = null, atMs = null }) {
  return { v: PROTOCOL_VERSION, type: 'mount', id: mintId('mnt'), decisionId: mintId('dec'), chosen, physical, mismatch: Boolean(mismatch), warning, fix, desiredRotation, atMs };
}

/** The reply a camera sends once a move has settled (or been refused). */
export function ack({ command, receivedAt, startedAt, completedAt, result, diag = null }) {
  return {
    v: PROTOCOL_VERSION, type: 'ack', id: command.id, decisionId: command.decisionId, forType: command.type,
    timestamps: { decided: command.decidedAt, sent: command.sentAt ?? null, received: receivedAt, started: startedAt, completed: completedAt },
    result, // { mode, requested, achieved, clamped, reason, lens, lensSwitch, droppedFrames, actualDurationMs }
    // The camera's own view of the receipt, for a slow command: its local
    // clock at receipt, the clock offset it used and the sender's local
    // send time are what tell a stalled link from a stepped clock.
    ...(diag ? { diag } : {}),
  };
}

export function encode(message) {
  const text = JSON.stringify(message);
  return enc ? enc.encode(text) : Uint8Array.from(Buffer.from(text, 'utf8'));
}
export function decode(bytes) {
  const text = dec ? dec.decode(bytes) : Buffer.from(bytes).toString('utf8');
  const m = JSON.parse(text);
  if (m?.v !== PROTOCOL_VERSION || typeof m.type !== 'string') throw new Error('not a loud.camera message');
  return m;
}

/** The whole command cycle as the controller sees it: ack arrival minus command send, on one clock. It INCLUDES the move (2-3 s by design). */
export function roundTripMs(sentAt, ackArrivedAt) { return Math.max(0, ackArrivedAt - sentAt); }

/**
 * The three latencies an ack lets the controller measure:
 *   moveCycleMs       send → ack arrived, local clock: the whole cycle
 *                     including the move itself (what the old reports
 *                     called "rtt");
 *   commandLatencyMs  sent → received on the camera, server clock: the
 *                     network leg out (null until both clocks are synced);
 *   ackLegMs          completed on the camera → ack arrived here, server
 *                     clock: the network leg back.
 */
export function ackLatencies(ackMessage, { sentLocal, arrivedLocal, arrivedServer = null }) {
  const t = ackMessage?.timestamps || {};
  const leg = (a, b) => (Number.isFinite(a) && Number.isFinite(b) ? b - a : null);
  return { moveCycleMs: roundTripMs(sentLocal, arrivedLocal), commandLatencyMs: leg(t.sent, t.received), ackLegMs: leg(t.completed, arrivedServer), moveMs: leg(t.started, t.completed) };
}

/** A command whose network leg out took longer than this is logged with its diagnostics (one took 30 s on 14 Oct and the records could not say why). */
export const SLOW_COMMAND_MS = 2000;
/**
 * Why a command was slow, from the two sides' diagnostics: the controller's
 * local send time and clock offset (`sent`), the camera's local receipt
 * time and offset (the ack's `diag`). On the two local clocks the leg is
 * sent → received minus the offsets' difference; when that local figure is
 * also long the link stalled; when the server-clock figure is long but the
 * local one is not, one side's clock offset stepped between syncs.
 */
export function slowCommandDiagnosis(lat, { sentLocal, offsetAtSend = null }, diag = null) {
  const leg = lat?.commandLatencyMs;
  if (!Number.isFinite(leg) || leg < SLOW_COMMAND_MS) return null;
  const d = diag || {};
  const localLeg = Number.isFinite(d.receivedLocalMs) && Number.isFinite(sentLocal) && Number.isFinite(d.offsetMs) && Number.isFinite(offsetAtSend)
    ? (d.receivedLocalMs + d.offsetMs) - (sentLocal + offsetAtSend) : null;
  const clockStep = localLeg != null ? Math.abs(leg - localLeg) : null;
  const verdict = localLeg == null ? 'no camera diagnostics in the ack: cannot tell a stalled link from a stepped clock'
    : clockStep > SLOW_COMMAND_MS / 2 ? `a clock offset changed by ~${Math.round(clockStep)} ms between the send and the receipt (not the link)`
      : d.stallMs > SLOW_COMMAND_MS / 2 ? `the camera's JS thread was blocked for ~${Math.round(d.stallMs)} ms before the command was handled`
        : d.linkEvents?.length ? `the camera's LiveKit connection changed state (${d.linkEvents.join(', ')}) in that window: the link stalled`
          : 'the link stalled with no connection-state change and no clock step recorded';
  return { commandLatencyMs: leg, localLegMs: localLeg != null ? Math.round(localLeg) : null, clockStepMs: clockStep != null ? Math.round(clockStep) : null, cameraStallMs: d.stallMs ?? null, linkEvents: d.linkEvents ?? [], verdict };
}

/** n / p50 / p90 / max of each latency over a session, or null with nothing recorded. */
export function summariseLatencies(list) {
  if (!list?.length) return null;
  const stat = (key) => {
    const s = list.map((l) => l[key]).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
    if (!s.length) return null;
    const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
    return { n: s.length, p50: q(0.5), p90: q(0.9), max: s[s.length - 1] };
  };
  return { moveCycleMs: stat('moveCycleMs'), commandLatencyMs: stat('commandLatencyMs'), ackLegMs: stat('ackLegMs'), moveMs: stat('moveMs') };
}
