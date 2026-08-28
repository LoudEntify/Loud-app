'use client';

// lib/camfeedDevice.js
// ─────────────────────────────────────────────────────────────
// The paired camera's credential, stored on the DEVICE.
//
// ── ⚠️ THIS REVERSES A DECISION I WROTE, AND THE OLD ONE WAS WRONG ──
//
// components/CamPair.jsx used to say, in as many words:
//
//   "The device credential ... is held only in this tab's memory.
//    Deliberately not persisted: a phone that reloads has been picked up
//    by a person, and a person can scan the code again."
//
// That reasoning is wrong, and the sitting proved it. It assumes a
// reload means someone chose to reload. On a propped phone in a live
// show, a tab closes for reasons that have nothing to do with intent:
// iOS evicting a background tab under memory pressure, a mis-swipe, an
// OS update prompt, a phone call. In every one of those the person is on
// stage with a guitar, and the fix I designed was "walk off, pick up the
// phone, open Kit Check on the other screen, generate a new code, scan
// it" — during the show.
//
// The pairing belongs to the DEVICE, not to the tab. That is what the
// server already believed: app/api/camfeed/session authenticates a
// device by a secret compared against `device_secret_hash`, and hands
// back the SAME `device_identity` every time, precisely so a camera can
// come and go without the director seeing a new one. The whole
// reconnection mechanism was already built. The only thing missing was
// the phone remembering who it was.
//
// ── WHAT IS STORED, AND THE HONEST SECURITY POSITION ──────────
// `{ pairingId, deviceSecret }` in localStorage, origin-scoped.
//
// This is a real change in exposure and it should be stated rather than
// buried: the secret now survives on the device instead of dying with
// the tab. Anyone with the unlocked phone can reopen the page and be
// that camera.
//
// Three things make that the right trade rather than a careless one:
//
//   1. THE CAPABILITY IS SMALL AND ALREADY PHYSICAL. The grant is camera
//      publish only — no microphone, no data channel, no subscribe in
//      rehearsal. Someone holding the unlocked phone can already point
//      the existing tab wherever they like. The credential adds nothing
//      they did not have by holding the device.
//   2. IT IS REVOCABLE, INSTANTLY AND REMOTELY. The artist's rig list
//      has a revoke per camera; a revoked pairing answers 403 on the
//      next poll, and clearCredential() below wipes the device on that
//      answer. A lost phone is one tap, and the phone erases itself.
//   3. THE ALTERNATIVE COSTS MORE THAN IT SAVES. The failure it
//      prevents is theoretical and needs the unlocked handset. The
//      failure it causes is a dead camera mid-performance, which
//      happened, in a real sitting, on the first evening anyone tried.
//
// NOT sessionStorage: that is per-tab and dies with exactly the event
// this exists to survive. NOT a cookie: it is never sent to the server
// automatically, and it should not be — it belongs in a request body,
// deliberately, which is where the poll already puts it.
// ─────────────────────────────────────────────────────────────

const KEY = 'loudentify.camfeed.device';

/**
 * Everything here is wrapped, because storage throws rather than
 * returning null in private browsing and on locked-down devices. A phone
 * that cannot remember its pairing must still work as a camera for as
 * long as the tab stays open — degraded to exactly the old behaviour,
 * never broken.
 */
export function readCredential() {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.pairingId || !parsed?.deviceSecret) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveCredential({ pairingId, deviceSecret }) {
  if (!pairingId || !deviceSecret) return false;
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ pairingId, deviceSecret, savedAt: Date.now() }));
    return true;
  } catch {
    return false;
  }
}

/**
 * Called when the server says this pairing is finished — revoked, or
 * gone. Leaving a dead credential behind would make every reopen spend a
 * request discovering the same rejection, and would show a returning
 * operator a reconnecting screen for a camera that is never coming back.
 */
export function clearCredential() {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* nothing to clear, or nothing that can be */
  }
}

/**
 * Is storage actually usable here?
 *
 * Used for one thing: telling the operator the truth. A phone that
 * cannot persist its pairing will need a new code if the tab closes, and
 * that is worth one honest line on screen rather than a promise the
 * device cannot keep.
 */
export function canRemember() {
  try {
    const probe = `${KEY}.probe`;
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}
