'use client';
// lib/telemetry.js
// ─────────────────────────────────────────────────────────────
// Journey events and correlation ids on the client.
//
// docs/USER_JOURNEY.md "Instrument each journey step": sign-up started and
// completed (with what triggered it), feed card seen, show joined and left,
// reminder set, kit check result per item, go live, end show, clip shared.
// docs/ARCHITECTURE.md v2 adds Versus view changes, stage request
// outcomes, "Bigger" used, leaving to YouTube.
//
// Pseudonymous: the device viewer id only (lib/viewerIdentity.js); never a
// name, email or message body — `props` is filtered against a short list
// of forbidden keys so a future call site cannot leak one by accident.
// Batched and sent with sendBeacon so it never blocks the screen.
// Analytics consent gates journey events; a 'necessary' subset (errors,
// show joined/left, needed to run the service) is always sent.
// ─────────────────────────────────────────────────────────────
import { viewerIdOrSession } from './viewerIdentity.js';
import { loadConsent } from './consent.js';

const FORBIDDEN = ['email', 'name', 'display_name', 'full_name', 'body', 'message', 'password', 'token'];
const NECESSARY = new Set(['show.joined', 'show.left', 'player.error', 'player.offline']);

let sessionCorrelationId = null;
export function sessionCorrelation() {
  if (!sessionCorrelationId) sessionCorrelationId = mintId();
  return sessionCorrelationId;
}
export function mintId() {
  try { return crypto.randomUUID(); } catch { return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`; }
}

let queue = [];
let timer = null;
function flush() {
  timer = null;
  if (!queue.length) return;
  const batch = queue.splice(0, 50);
  const body = JSON.stringify({ viewerId: viewerIdOrSession(), events: batch });
  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/events', new Blob([body], { type: 'application/json' }));
      return;
    }
  } catch { /* fall through */ }
  fetch('/api/events', { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true }).catch(() => {});
}

export function track(event, props = {}, { showId = null, correlationId = null } = {}) {
  if (typeof window === 'undefined') return;
  const consent = loadConsent();
  if (!consent.analytics && !NECESSARY.has(event)) return;
  const clean = {};
  for (const [k, v] of Object.entries(props || {})) {
    if (FORBIDDEN.includes(k.toLowerCase())) continue;
    if (typeof v === 'string' && v.length > 120) continue;
    clean[k] = v;
  }
  queue.push({ event, props: clean, showId, correlationId: correlationId || sessionCorrelation(), clientTs: new Date().toISOString() });
  if (!timer) timer = setTimeout(flush, 2000);
  if (queue.length >= 50) flush();
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
}

/** Headers for an API call: the correlation id rides along. */
export function apiHeaders(extra = {}, correlationId = null) {
  return { 'content-type': 'application/json', 'x-correlation-id': correlationId || mintId(), ...extra };
}
