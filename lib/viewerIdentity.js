'use client';

// lib/viewerIdentity.js
// ─────────────────────────────────────────────────────────────
// Who is watching — as a DEVICE, across shows.
//
// PRD: Live Show, Accounts & Identity · S&I: Database, Auth
//
// ── THE PROBLEM THIS EXISTS FOR (§0.4) ────────────────────────
// The LiveKit identity the app mints is
// `viewer-${userId8|anon}-${Date.now()}` (components/LiveDemo.jsx),
// which is unique per CONNECTION, not per person. A viewer who reloads
// once is two identities. Counting those answers "how many connections
// were there", not "how many people watched" and not "how long did each
// person stay" — which are the two numbers the pilot exists to produce.
//
// ── ⚠️ THIS VALUE NEVER GOES OVER THE LIVEKIT WIRE ────────────
// A LiveKit identity is visible to every other participant in the room.
// A stable cross-show identifier there would let any viewer with a
// console open follow any other viewer from show to show — a tracking
// facility we would be handing out to the audience, for free, in the
// name of counting them.
//
// So the split is deliberate and load-bearing:
//
//   viewer_id         THIS value. Device-scoped, stable across shows.
//                     Sent ONLY to our own API routes, over HTTPS, and
//                     stored in tables with RLS on and zero policies.
//                     Never to LiveKit, never to another participant.
//   livekit_identity  one connection. Already opaque, already public
//                     within the room, unchanged by this work.
//
// Anything that puts viewer_id into a token, a participant name, or a
// data-channel message breaks the one property that makes it safe.
//
// ── WHY localStorage, AND WHAT IT HONESTLY MEASURES ───────────
// It measures a BROWSER PROFILE ON A DEVICE, and nothing stronger.
// Clearing site data, a private window, a second browser, or a second
// device all produce a new id and count as a new viewer; a shared family
// tablet counts two people as one. That is the known limit of counting
// an anonymous audience without making them sign in, and the pilot's
// numbers should be read as "devices" rather than "humans" wherever the
// difference matters.
//
// Same storage decision as lib/camfeedDevice.js, for the same reason: a
// value that dies with the tab measures tabs.

const KEY = 'loudentify.viewerId';

function safeStorage() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    // Touch it. Safari in Lockdown/private mode exposes localStorage and
    // then throws on write, so the only reliable probe is a write.
    const probe = '__loudentify_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return null;
  }
}

function mint() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch {
    // fall through
  }
  // Not a UUID and not claiming to be. The column is text precisely so a
  // client-minted value that is malformed lands as data to be cleaned
  // rather than rejecting the row (see pilot2_02_viewer_sessions.sql).
  return `v-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e12).toString(36)}`;
}

/**
 * This device's viewer id, minting one on first call.
 *
 * Returns null when storage is unavailable — a browser that cannot
 * persist genuinely has no stable identity to offer, and inventing a
 * per-call value would be worse than admitting it: it would inflate the
 * unique-viewer count by one per page load while looking like real data.
 * viewer_sessions.viewer_id is NOT NULL, so callers use
 * `viewerIdOrSession()` below rather than writing null.
 */
export function getViewerId() {
  const store = safeStorage();
  if (!store) return null;
  try {
    const existing = store.getItem(KEY);
    if (existing) return existing;
    const fresh = mint();
    store.setItem(KEY, fresh);
    return fresh;
  } catch {
    return null;
  }
}

/**
 * A viewer id that is always a string, with the fallback LABELLED.
 *
 * A device with no storage still watched the show and still deserves to
 * be counted as a session. What it must not do is be counted as a
 * RETURNING viewer, or silently merge with every other storage-less
 * device into one phantom super-viewer — which is what a constant
 * fallback like 'anonymous' would do.
 *
 * The `nostore-` prefix makes both readable in one query: these rows are
 * real sessions, and they are not evidence about unique people. Count
 * them in watch time, exclude them from distinct-viewer counts.
 */
export function viewerIdOrSession() {
  const stable = getViewerId();
  if (stable) return stable;
  return `nostore-${mint()}`;
}

/** True when this id came from the storage-less fallback above. */
export function isEphemeralViewerId(id) {
  return typeof id === 'string' && id.startsWith('nostore-');
}

// ── The entry details (item 11f) ──────────────────────────────
// Kept on the device so a viewer who reloads mid-show is not asked
// again. Name and email are ALSO written to viewer_sessions, which is
// the record; this is only so the form does not reappear.
const ENTRY_KEY = 'loudentify.viewerEntry';

export function getSavedEntry() {
  const store = safeStorage();
  if (!store) return null;
  try {
    const raw = store.getItem(ENTRY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    // A saved entry without both required fields is not a completed
    // entry, and must not be allowed to skip the form.
    if (!parsed.displayName || !parsed.ageConfirmedAt) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveEntry({ displayName, email, ageConfirmedAt }) {
  const store = safeStorage();
  if (!store) return;
  try {
    store.setItem(ENTRY_KEY, JSON.stringify({ displayName, email: email || null, ageConfirmedAt }));
  } catch {
    // A viewer who cannot persist simply sees the form again on reload.
  }
}

// ── Which prompts this device has answered (item 6) ───────────
//
// Two jobs, and the second is the one that made this necessary:
//
//   1. The catch-up must never re-show a prompt someone has answered.
//   2. The "your answer is in" state must survive a reload. It used to
//      be React state only, so a viewer who reloaded — or had a second
//      tab — was shown the card again and could answer twice. The SERVER
//      handled that correctly (prompt_responses is one-row-per-viewer,
//      last-one-wins, which is deliberate: changing your mind is
//      legitimate). But the client inviting it was not deliberate, and a
//      device test on 15 Sept found a viewer doing exactly that.
//
// Device-scoped like the viewer id itself, and for the same reason: the
// question "have I answered this" is about this person on this device,
// and there is no signed-in account to hang it on.
//
// Capped, oldest-first. A device that watches many shows would otherwise
// grow this forever in a store with a hard size limit, and the id of a
// prompt from a show three weeks ago has no consumer.
const ANSWERED_KEY = 'loudentify.answeredPrompts';
const ANSWERED_MAX = 200;

export function getAnsweredPromptIds() {
  const store = safeStorage();
  if (!store) return [];
  try {
    const raw = store.getItem(ANSWERED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

export function markPromptAnswered(promptId) {
  if (!promptId) return getAnsweredPromptIds();
  const store = safeStorage();
  const current = getAnsweredPromptIds();
  if (current.includes(promptId)) return current;
  const next = [...current, promptId].slice(-ANSWERED_MAX);
  if (store) {
    try {
      store.setItem(ANSWERED_KEY, JSON.stringify(next));
    } catch {
      // A device that cannot persist sees the card again after a reload
      // and can answer again. The server still keeps one row, so the
      // DATA stays correct; only the experience degrades.
    }
  }
  return next;
}
