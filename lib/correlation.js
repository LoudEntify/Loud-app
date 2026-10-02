// lib/correlation.js
// ─────────────────────────────────────────────────────────────
// Correlation ids on the server.
//
// docs/ARCHITECTURE.md "Knowing what is happening": "Every request carries
// a correlation id that runs through logs, traces and audit entries, so
// one identifier answers what happened." PRD row 165.
//
// The client sends `x-correlation-id` (lib/telemetry.js mints one per page
// session and one per action); a route takes it if it is a uuid, mints one
// otherwise, writes it on every row it touches and on every audit entry,
// and echoes it back in the response header so a support ticket can quote it.
// ─────────────────────────────────────────────────────────────
import { randomUUID } from 'node:crypto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function correlationFrom(request) {
  const h = request?.headers?.get?.('x-correlation-id') || '';
  return UUID.test(h) ? h.toLowerCase() : randomUUID();
}

/** Wrap a NextResponse so the id goes back out. */
export function withCorrelation(response, correlationId) {
  try { response.headers.set('x-correlation-id', correlationId); } catch { /* ignore */ }
  return response;
}

/** Structured log line with no personal data in it. */
export function logEvent(level, event, fields = {}) {
  const line = JSON.stringify({ t: new Date().toISOString(), level, event, ...fields });
  if (level === 'error') console.error(line); else console.log(line);
}
