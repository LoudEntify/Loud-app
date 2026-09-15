'use client';

// lib/comments.js
// ─────────────────────────────────────────────────────────────
// Comment persistence. Item 5.
//
// PRD: Live Show / Director Experience · S&I: Database, Real-time media
//
// ── THE LIVE PATH IS NOT TOUCHED ──────────────────────────────
// Modelled directly on lib/reactions.js, and for the same reason: a
// comment goes out over the LiveKit data channel and appears on every
// screen in the room within a frame or two. Nothing waits for a server.
// This module is added AFTER that, batched and fire-and-forget, so the
// database write can fail all night without anyone in the room noticing
// anything except that we have no record of it afterwards.
//
// Every function here is fail-silent by construction. A dead network
// costs a log line, never a message.
//
// ── EACH CLIENT PERSISTS ONLY ITS OWN COMMENTS ────────────────
// The same asymmetry lib/reactions.js already relies on. Every client
// receives every comment over the channel, so if each persisted what it
// RECEIVED, a room of forty would write forty copies of every message
// and something would have to arbitrate which one counts. Writing only
// what this device SENT removes the question entirely: there is no
// dedup, no arbitration, and no "which client was responsible".
//
// The cost is stated rather than hidden: a comment written by someone
// whose write failed is lost, even though everybody in the room saw it.
// That is the correct trade for a feature whose live path must not
// depend on a database.
//
// ── WHAT IS STORED IS A DIFFERENT OBJECT FROM WHAT SCROLLED PAST ──
// A stored comment log is a different privacy object from a message that
// scrolls by once. pilot2_03 puts RLS on with zero policies, so only the
// service role can read it and no product surface does — the same
// posture docs/overnight2_11_reaction_events.sql argues for reactions.
//
// ⚠️ The entry form (item 11f) tells every viewer, in as many words:
// "Ask us any time and we'll delete them." pilot2_03 has deleted_at and
// deleted_by columns so that promise is answerable, but NOTHING WRITES
// THEM YET. Honouring a deletion request today means running SQL by
// hand. That is fine for a pilot of 30–50 people and it is not fine for
// a launch, and it is recorded here because a promise with no mechanism
// is the kind of thing that is discovered at the worst moment.
// ─────────────────────────────────────────────────────────────

const ENDPOINT = '/api/show-comments';
const FLUSH_INTERVAL_MS = 2000;
// Bounded like the reaction queue. During a long outage the OLDEST are
// dropped: in a live show the most recent messages are the ones still
// worth having, and an unbounded queue during exactly the kind of outage
// that caused the backlog is how a diagnostic becomes the failure.
const MAX_QUEUE = 100;
const MAX_BODY = 1000;

let queue = [];
let flushTimer = null;
let listenersAttached = false;

function ensureTimers() {
  if (typeof window === 'undefined') return;
  if (!flushTimer) flushTimer = setInterval(flush, FLUSH_INTERVAL_MS);
  if (!listenersAttached) {
    listenersAttached = true;
    // A show ends and the tab closes. The last messages of the last song
    // are the ones most worth having, and they are exactly the ones a
    // 2-second flush timer would otherwise still be holding.
    window.addEventListener('pagehide', flushViaBeacon);
  }
}

/**
 * Record one of THIS device's comments for later.
 *
 * Never throws, never blocks, never returns anything the caller has to
 * check — the call site is one line after the send() that already put
 * the comment on every screen.
 */
export function logComment({ showId, roomName, body, authorName, viewerId, livekitIdentity, offsetMs }) {
  try {
    if (!showId || !body) return;
    const text = String(body).trim();
    // Trimmed rather than rejected. The schema caps at 1,000 and would
    // refuse the row; losing a long comment entirely because it ran over
    // is worse than storing the part that fits, and the UI does not
    // enforce a limit today.
    if (!text) return;
    ensureTimers();
    queue.push({
      show_id: String(showId),
      room_name: roomName ? String(roomName).slice(0, 200) : null,
      body: text.slice(0, MAX_BODY),
      author_name: authorName ? String(authorName).slice(0, 120) : null,
      viewer_id: viewerId ? String(viewerId).slice(0, 200) : null,
      livekit_identity: livekitIdentity ? String(livekitIdentity).slice(0, 200) : null,
      // From showOriginMs (item 3), so a comment lines up with a shot
      // change, a prompt, or a moment in the recording — measured from
      // when the show ACTUALLY started, not when it was scheduled to.
      offset_ms: Number.isFinite(offsetMs) ? Math.max(0, Math.round(offsetMs)) : null,
      client_ts: new Date().toISOString(),
    });
    if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE);
  } catch {
    // never let a log call throw into the show path
  }
}

async function flush() {
  if (queue.length === 0) return;
  const batch = queue;
  queue = [];
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comments: batch }),
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
  } catch {
    // Dropped, never re-queued. Retrying risks unbounded growth during
    // exactly the kind of outage that produced the failure — the same
    // decision, for the same reason, as lib/reactions.js.
  }
}

function flushViaBeacon() {
  if (queue.length === 0) return;
  const batch = queue;
  queue = [];
  try {
    const blob = new Blob([JSON.stringify({ comments: batch })], { type: 'application/json' });
    if (!navigator.sendBeacon?.(ENDPOINT, blob)) {
      fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comments: batch }),
        keepalive: true,
      }).catch(() => {});
    }
  } catch {
    // ignore
  }
}
