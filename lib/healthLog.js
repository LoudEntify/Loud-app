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
// ── WHAT GOT THROWN AWAY BEFORE ANYONE WAS LISTENING ──────────
// logHealthEvent drops silently when no showId has been set, which is
// correct — an event with no room to file it under is unfilable. What
// was NOT correct was doing it invisibly. A whole instrumented session
// was run and pulled before anyone noticed the instruments had never
// been able to write, and "no rows" reads identically to "nothing
// happened". These counters make the difference visible: as soon as a
// context arrives, what was missed is reported.
let droppedBeforeInit = 0;
const droppedTypes = new Set();
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
    const hadContext = !!ctx.showId;
    ctx = { showId: showId ?? ctx.showId, participantIdentity: participantIdentity ?? ctx.participantIdentity, role: role ?? ctx.role };
    ensureFlushTimer();
    ensurePageLifecycleFlush();

    // First time a context exists: say what was lost getting here.
    // Reported once, from inside the newly-valid context, so it lands in
    // the same capture as everything else.
    if (!hadContext && ctx.showId && droppedBeforeInit > 0) {
      const lost = droppedBeforeInit;
      const types = [...droppedTypes].slice(0, 12);
      droppedBeforeInit = 0;
      droppedTypes.clear();
      logHealthEvent('health_log_dropped_before_init', { count: lost, types });
    }
  } catch {
    // never let logging setup break the caller
  }
}

export function logHealthEvent(eventType, detail = {}) {
  try {
    if (!ctx.showId || !eventType) {
      // Still dropped — there is genuinely nowhere to file it — but
      // counted, so the next initHealthLog can report the hole rather
      // than leaving an empty capture looking like a quiet session.
      if (eventType) { droppedBeforeInit += 1; droppedTypes.add(eventType); }
      return;
    }
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
