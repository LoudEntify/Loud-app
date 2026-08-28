'use client';

// lib/sessionResume.js
// ─────────────────────────────────────────────────────────────
// Round D's resume ladder, and the one rule it exists to enforce:
//
//   A PERFORMER WHO DROPS MID-SHOW IS NEVER ASKED TO LOG IN AGAIN.
//
// That rule is the whole feature. Everything else here is bookkeeping in
// service of it.
//
// ── WHY THIS IS SMALL ──
// The heavy lifting already exists and is worth stating so nobody adds a
// second mechanism on top of it:
//
//   * The Supabase session persists in this browser on its own
//     (persistSession: true), so the credential survives a reload, a
//     crash and a closed laptop lid.
//   * app/api/performer/join-show REBINDS THE SAME SLOT BY ACCOUNT. It
//     does not need to be told which slot — it looks up who is asking and
//     gives them back what was already theirs.
//
// So a silent re-claim is: call join-show again with the session that is
// already in the tab. There is no stored credential here, and there must
// not be — a performer's publish rights living in localStorage would be a
// far worse trade than one extra API call.
//
// What IS stored is a marker: which show this device was performing in,
// and when it was last seen there. It grants nothing. It answers one
// question the app otherwise cannot: is this person ARRIVING, or COMING
// BACK? Those deserve different words on screen, and telling them apart
// is the difference between "Back on slot A" and a silent reconnection
// that leaves someone wondering whether they are still on air.
//
// sessionStorage, not localStorage, deliberately: the marker should die
// with the tab. A performer who closes the tab has left the show, and a
// resume offer surfacing next week is noise.
// ─────────────────────────────────────────────────────────────

const KEY = 'loudentify.resume';

// Past this, a returning device is treated as a fresh arrival. Twelve
// hours comfortably outlasts any show plus a long interruption, and is
// short enough that yesterday's marker never colours today's join.
const MARKER_TTL_MS = 12 * 60 * 60 * 1000;

export function rememberPerformerSession({ showId, slot }) {
  try {
    if (typeof window === 'undefined' || !showId) return;
    window.sessionStorage.setItem(KEY, JSON.stringify({ showId, slot, at: Date.now() }));
  } catch {
    // Private browsing, a full quota, a locked-down device. The resume
    // path still works — join-show does not need this — the messaging is
    // just less specific.
  }
}

/**
 * Was this device performing in this show recently?
 *
 * Returns null for "no", or the marker. Never throws.
 */
export function recallPerformerSession(showId) {
  try {
    if (typeof window === 'undefined' || !showId) return null;
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;
    const marker = JSON.parse(raw);
    if (!marker || marker.showId !== showId) return null;
    if (Date.now() - (marker.at || 0) > MARKER_TTL_MS) {
      window.sessionStorage.removeItem(KEY);
      return null;
    }
    return marker;
  } catch {
    return null;
  }
}

export function forgetPerformerSession() {
  try {
    if (typeof window !== 'undefined') window.sessionStorage.removeItem(KEY);
  } catch {
    // nothing to do
  }
}
