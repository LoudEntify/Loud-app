'use client';

// lib/dndPrompt.js
// ─────────────────────────────────────────────────────────────
// Whether this artist has been told to turn on Do Not Disturb, and said
// they have.
//
// PRD: Director Experience / Live Show (interruption handling)
// S&I: (none — no table, no route)
//
// ── WHY A PROMPT AND NOT A CHECK ──────────────────────────────
// The spec originally carried an exception: no interruption if the
// artist has DND on. No web API exposes Focus or Do Not Disturb state,
// on any platform, so the app cannot read it. That is not a gap to work
// around — it is the end of that design.
//
// What makes it survivable is that the rule is already true without any
// code. With DND on, the call does not ring, the audio session is never
// interrupted, and the app sees nothing at all. The OS enforces the
// exception; the app's only useful role is to ask.
//
// The thing this file must never do is let the product CLAIM it. There
// is no "DND is on — you are protected" state here and there must not
// be one: the app would be asserting something it cannot observe, to the
// person who would rely on it most. What is stored is only ever "this
// artist said they had done it", which is a record of an answer, not a
// reading of the device.
//
// ── WHY localStorage AND NOT A COLUMN ─────────────────────────
// A profiles column would make this follow the artist across devices,
// and it was not worth a migration. The fact is per-artist AND
// per-device by nature: the prompt is asking about the handset in their
// hand, and a new phone genuinely should ask again rather than inherit
// a tick from the old one. Keyed by artist id so a shared device does
// not answer for somebody else.
//
// If this ever does earn a column, it belongs with the other profile
// preferences, in one migration, not a table of its own.
// ─────────────────────────────────────────────────────────────

const KEY_PREFIX = 'loudentify.dnd.ack.';

function key(artistId) {
  return `${KEY_PREFIX}${artistId || 'anonymous'}`;
}

/**
 * Has this artist acknowledged the prompt on this device?
 *
 * Everything is wrapped: storage throws rather than returning null in
 * private browsing, and an artist who cannot store an acknowledgement
 * must still get the prompt rather than a broken page. Degrading to
 * "ask every time" is the correct direction for a reminder.
 */
export function readDndAck(artistId) {
  try {
    const raw = window.localStorage.getItem(key(artistId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.acknowledgedAt ? parsed : null;
  } catch {
    return null;
  }
}

export function saveDndAck(artistId) {
  try {
    window.localStorage.setItem(key(artistId), JSON.stringify({ acknowledgedAt: Date.now() }));
    return true;
  } catch {
    return false;
  }
}

export function clearDndAck(artistId) {
  try { window.localStorage.removeItem(key(artistId)); } catch { /* nothing to clear */ }
}
