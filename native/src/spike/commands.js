// native/src/spike/commands.js — the main-device control protocol over
// LiveKit data messages. JSON on topic TOPIC, reliable delivery. Every
// command carries the sender's server-clock timestamp; every ack carries
// the six timestamps B5 asks for, so a round trip can be reconstructed
// from either side's record.
//
// PRD rows 12, 13, 127, 128. S&I: Real-time media, Observability.

import { PAN_DEFAULTS } from './zoomPlan.js';

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

/** The reply a camera sends once a move has settled (or been refused). */
export function ack({ command, receivedAt, startedAt, completedAt, result }) {
  return {
    v: PROTOCOL_VERSION, type: 'ack', id: command.id, decisionId: command.decisionId, forType: command.type,
    timestamps: { decided: command.decidedAt, sent: command.sentAt ?? null, received: receivedAt, started: startedAt, completed: completedAt },
    result, // { mode, requested, achieved, clamped, reason, lens, lensSwitch, droppedFrames, actualDurationMs }
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
