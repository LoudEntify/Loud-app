import { createHash } from 'node:crypto';

export const DEFAULT_LATENCY_ALLOWANCE_MS = 30_000;
export const MAX_LATENCY_ALLOWANCE_MS = 60_000;

export function hashInteractionToken(token) {
  return createHash('sha256').update(String(token || '')).digest('hex');
}

export function votingWindow(prompt, now = Date.now()) {
  const opens = new Date(prompt?.opens_at || prompt?.pushed_at || 0).getTime();
  const closes = prompt?.closes_at || prompt?.closed_at ? new Date(prompt.closes_at || prompt.closed_at).getTime() : Infinity;
  const allowance = Math.min(MAX_LATENCY_ALLOWANCE_MS, Math.max(0, Number(prompt?.latency_allowance_ms ?? DEFAULT_LATENCY_ALLOWANCE_MS)));
  if (!Number.isFinite(opens) || now < opens) return { open: false, reason: 'NOT_OPEN', closesAt: Number.isFinite(closes) ? new Date(closes).toISOString() : null };
  if (Number.isFinite(closes) && now > closes + allowance) return { open: false, reason: 'CLOSED', closesAt: new Date(closes).toISOString() };
  return { open: true, reason: Number.isFinite(closes) && now > closes ? 'LATENCY_GRACE' : 'OPEN', closesAt: Number.isFinite(closes) ? new Date(closes).toISOString() : null };
}

export function voterKey({ userId, sessionId }) {
  if (userId) return `user:${userId}`;
  if (sessionId) return `session:${sessionId}`;
  throw new Error('An authenticated interaction identity is required');
}

export function boundedLatency(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(120_000, Math.max(0, Math.round(number))) : null;
}
