// native/src/spike/commands.js — the main-device control protocol over
// LiveKit data messages. JSON on topic TOPIC, reliable delivery. Every
// command carries the sender's server-clock timestamp; every ack carries
// the six timestamps B5 asks for, so a round trip can be reconstructed
// from either side's record.
//
// PRD rows 12, 13, 127, 128. S&I: Real-time media, Observability.

export const TOPIC = 'loud.camera';
export const PROTOCOL_VERSION = 1;

const enc = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
const dec = typeof TextDecoder !== 'undefined' ? new TextDecoder() : null;

let seq = 0;
export function mintId(prefix = 'cmd') { seq += 1; return `${prefix}-${Date.now().toString(36)}-${seq.toString(36)}`; }

export function zoomCommand({ target, durationMs = 2000, easing = 'ease-in-out', decidedAt, source = 'main-device', decisionId = mintId('dec') }) {
  return { v: PROTOCOL_VERSION, type: 'zoom', id: mintId(), decisionId, source, target, durationMs, easing, decidedAt };
}
export function panCommand({ direction, degree = 0.5, window = 0.85, durationMs = 3000, easing = 'ease-in-out', decidedAt, source = 'main-device', decisionId = mintId('dec') }) {
  return { v: PROTOCOL_VERSION, type: 'pan', id: mintId(), decisionId, source, direction, degree, window, durationMs, easing, decidedAt };
}
export function surveyRequest({ decidedAt }) { return { v: PROTOCOL_VERSION, type: 'survey', id: mintId(), decidedAt }; }

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

/** Round-trip time as the controller sees it: ack arrival minus command send, on one clock. */
export function roundTripMs(sentAt, ackArrivedAt) { return Math.max(0, ackArrivedAt - sentAt); }
