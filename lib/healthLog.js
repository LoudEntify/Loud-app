// lib/healthLog.js
// ─────────────────────────────────────────────────────────────
// Phase 2 diagnostic instrumentation (SHOW-1/SHOW-2 defect triage).
// Batched, best-effort health-event logger -- writes to the
// `health_events` table (docs/health_events_migration.sql) via
// app/api/health-events/route.js, same service-role-behind-an-API-route
// pattern as app/api/participants/route.js.
//
// Every export here is fail-silent by construction: a throw anywhere in
// this file must never propagate to the caller, and a dead network must
// never block or slow the caller. This is diagnostic-only -- it is not
// allowed to become a dependency of the show.
//
// Throttling: events are queued in memory and flushed at most once a
// second (FLUSH_INTERVAL_MS), regardless of how many logHealthEvent
// calls happen in between -- this is what keeps this under the ~1
// write/sec/client budget even under a burst (e.g. a run of TrackMuted
// events). The queue is bounded (MAX_QUEUE) so a prolonged network
// outage drops the oldest events instead of growing unbounded.
//
// PRD: Director Experience / Live Show | S&I: Observability
// ─────────────────────────────────────────────────────────────

const ENDPOINT = '/api/health-events';
const FLUSH_INTERVAL_MS = 1000;
const MAX_QUEUE = 200;

let ctx = { showId: null, participantIdentity: null, role: null };
let queue = [];
let flushTimer = null;
let listenersAttached = false;

function ensureFlushTimer() {
  if (flushTimer || typeof window === 'undefined') return;
  flushTimer = setInterval(flush, FLUSH_INTERVAL_MS);
}

function ensurePageLifecycleFlush() {
  if (listenersAttached || typeof window === 'undefined') return;
  listenersAttached = true;
  // Best-effort final drain on teardown -- sendBeacon (not fetch) because
  // a page actually going away won't reliably let an async fetch finish.
  window.addEventListener('pagehide', flushViaBeacon);
}

// Call once per session, as soon as the room/participant identity is
// known (RoomInner mount). Safe to call again if identity/role changes
// (e.g. a slot claim resolves after the gate flow) -- just updates
// context, doesn't reset the queue.
export function initHealthLog({ showId, participantIdentity, role }) {
  try {
    ctx = { showId: showId ?? ctx.showId, participantIdentity: participantIdentity ?? ctx.participantIdentity, role: role ?? ctx.role };
    ensureFlushTimer();
    ensurePageLifecycleFlush();
  } catch {
    // never let logging setup break the caller
  }
}

export function logHealthEvent(eventType, detail = {}) {
  try {
    if (!ctx.showId || !eventType) return; // not initialized yet -- drop silently
    queue.push({
      show_id: ctx.showId,
      participant_identity: ctx.participantIdentity,
      role: ctx.role,
      event_type: eventType,
      detail,
      client_ts: new Date().toISOString(),
    });
    if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE);
  } catch {
    // never let a logging call throw into show-path code
  }
}

async function flush() {
  if (queue.length === 0) return;
  const batch = queue;
  queue = [];
  try {
    await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: batch }),
      keepalive: true,
    });
  } catch {
    // best-effort only -- dropped on failure, never retried/re-queued
    // (retrying risks unbounded growth during exactly the kind of
    // extended network outage this system exists to observe).
  }
}

function flushViaBeacon() {
  if (queue.length === 0) return;
  const batch = queue;
  queue = [];
  try {
    const blob = new Blob([JSON.stringify({ events: batch })], { type: 'application/json' });
    const sent = navigator.sendBeacon?.(ENDPOINT, blob);
    if (!sent) {
      // sendBeacon unsupported/refused -- best-effort fallback. keepalive
      // lets this outlive pagehide for a short window; still fire-and-forget.
      fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events: batch }),
        keepalive: true,
      }).catch(() => {});
    }
  } catch {
    // ignore
  }
}
