// lib/camfeedPairing.js
// ─────────────────────────────────────────────────────────────
// Server-side helpers shared by app/api/camfeed/pair and
// app/api/camfeed/session.
//
// THE ONE IDEA IN THIS FILE: a paired phone does not know which room it
// belongs to. It knows which PAIRING it is. The room is a column on that
// pairing row, and the phone re-reads it.
//
// That inversion is what makes Kit Check's whole promise work. An artist
// props three phones, frames them, and walks into a live show sixty
// seconds later — and the phones follow, because handing the rig over is
// one UPDATE of `target_room` plus a bump of `generation`, not three
// people picking up three phones and typing three new codes at the worst
// possible moment.
//
// Two credentials, deliberately different lifetimes:
//   * the six-character CODE is single-use and dies at redeem. It is
//     short because a human reads it off a screen, which is exactly why
//     it must not be a long-lived credential.
//   * the DEVICE SECRET is random, long, never shown to a human, and is
//     what the phone presents on every subsequent poll. Only its SHA-256
//     is stored, so the database never holds anything that could be
//     replayed into a live camera.
//
// PRE-MIGRATION SAFETY: every capability here is gated on
// pairingCapabilities(), which probes once per server process for the
// columns docs/overnight2_01_camfeed_pairings.sql adds. Without them the
// callers fall back to exactly the previous behaviour — one rehearsal
// camera, no follow — instead of 500ing. The branch preview has to work
// before the morning DB session, not after it.
// ─────────────────────────────────────────────────────────────

import 'server-only';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { AccessToken, TrackSource } from 'livekit-server-sdk';

// The code is redeemable for this long. Ten minutes is the span between
// "artist taps Add camera" and "artist has walked across the room and
// picked up the phone", with room to spare.
export const PAIRING_TTL_MS = 10 * 60 * 1000;

// Rehearsal tokens die with the rehearsal. The room cannot outlive its
// tokens, so an artist who closes the laptop lid does not leave a room
// billing overnight.
export const REHEARSAL_TOKEN_TTL = '20m';

// Show tokens have to survive an actual performance, and a camera going
// dark mid-song because a JWT expired is not an acceptable failure. The
// poll refreshes this well before it matters; the long TTL is the
// backstop for a phone whose polling is being throttled by a locked
// screen.
export const SHOW_TOKEN_TTL = '4h';

// The device polls this often. Fast enough that the handover feels
// instant to anyone watching the phone (worst case one interval), slow
// enough to be free: three phones at 4s is 45 requests a minute, all of
// them a single indexed row read.
export const SESSION_POLL_MS = 4000;

// The camera roles the shot grammar understands (lib/shotTypes.js).
// Duplicated here rather than imported because that module is a client
// module and this one is server-only; the list is stable and the
// duplication is one line, where the import would be an architectural
// tangle.
export const CAMERA_ROLES = ['wide', 'close', 'side'];

/**
 * Rehearsal rooms are namespaced away from show rooms so a rehearsal can
 * never be mistaken for, or collide with, a real broadcast.
 */
export function rehearsalRoom(userId) {
  return `rehearsal-${userId}`;
}

/**
 * Where this pairing's device belongs RIGHT NOW.
 *
 * target_room is authoritative when set. A null means the row predates
 * the migration (or has never been migrated into a show), and the answer
 * is the owner's rehearsal room — which is exactly what every
 * pre-existing row meant.
 */
export function roomForPairing(row) {
  return row.target_room || rehearsalRoom(row.created_by);
}

export function hashDeviceSecret(secret) {
  return createHash('sha256').update(String(secret)).digest('hex');
}

export function newDeviceSecret() {
  return randomBytes(32).toString('hex');
}

/**
 * Ambiguous characters removed: someone is typing this off a screen,
 * possibly in bad light, onto a phone.
 */
export function pairingCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(6);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

/**
 * The LiveKit identity for a paired camera.
 *
 * THE FORMAT IS LOAD-BEARING, not cosmetic. components/LiveDemo.jsx
 * parses the camera's role straight out of it (`identity.split('-')[2]`,
 * around :2596) to build the director console's available-roles list. A
 * phone that joins with a role segment the grammar doesn't know is
 * connected, publishing, and invisible to the director — which is worse
 * than not connecting at all, because nothing looks broken.
 *
 * This is also why the identity is STORED on the row and reused on every
 * refreshed token: a changing identity mid-show reads to every other
 * client as this camera dropping and a different one appearing.
 */
export function camfeedIdentity({ slot, role }) {
  const safeRole = CAMERA_ROLES.includes(role) ? role : 'wide';
  return `camfeed-${slot}-${safeRole}-${randomUUID().slice(0, 8)}`;
}

/**
 * A camera-only publish token. No microphone (it would double the room's
 * audio and feed back), no data channel (a lens has no business sending
 * shot commands), no subscribe in rehearsal (nothing to watch).
 *
 * canSubscribe is true in a SHOW room and false in rehearsal — in a show
 * the phone genuinely benefits from being able to render nothing while
 * still being a well-behaved participant, and LiveKit's own reconnect
 * paths are better exercised with subscribe on. Neither costs bandwidth
 * while the phone renders no remote tracks.
 */
export async function mintCameraToken({ apiKey, apiSecret, room, identity, ttl, canSubscribe = false }) {
  const at = new AccessToken(apiKey, apiSecret, { identity, ttl });
  at.addGrant({
    room,
    roomJoin: true,
    canPublish: true,
    canPublishSources: [TrackSource.CAMERA],
    canSubscribe,
    canPublishData: false,
  });
  return at.toJwt();
}

// ─── capability probe ─────────────────────────────────────────
// Cached per server process. `null` means "not yet asked".
let capabilityCache = null;

/**
 * Does this database have docs/overnight2_01_camfeed_pairings.sql
 * applied?
 *
 * Probed with a zero-row select naming the new columns, which is the
 * cheapest question that gets a truthful answer: PostgREST answers from
 * its schema cache, so this costs no table access at all, and it fails
 * with 42703 (undefined column) rather than returning something
 * ambiguous.
 *
 * Deliberately NOT re-probed after a failure within the same process.
 * The morning migration will be run against a database this deployment
 * talks to, and Vercel functions are short-lived enough that a fresh
 * process picks the new answer up within minutes. Re-probing on every
 * request to catch a schema change that happens roughly once would be
 * the wrong trade.
 */
export async function pairingCapabilities(admin) {
  if (capabilityCache !== null) return capabilityCache;
  try {
    const { error } = await admin
      .from('camfeed_pairings')
      .select('id, role, context, target_room, generation, device_secret_hash, device_identity, revoked_at')
      .limit(1);
    capabilityCache = { multiCamera: !error };
    if (error) {
      console.warn('[camfeed] running in single-camera fallback — docs/overnight2_01_camfeed_pairings.sql has not been applied:', error.message);
    }
  } catch (err) {
    console.warn('[camfeed] capability probe failed, assuming single-camera fallback:', err?.message || err);
    capabilityCache = { multiCamera: false };
  }
  return capabilityCache;
}

/** Test seam / manual reset after running the migration mid-process. */
export function resetPairingCapabilities() {
  capabilityCache = null;
}

/**
 * The link a QR code encodes, and the link a human taps. ONE url shape
 * for both, which is the whole point of the unified panel: whatever the
 * artist does with it — scan it, tap it, read the code out loud down a
 * phone line — lands on the same screen in the same state.
 */
export function pairUrl(origin, code) {
  return `${String(origin || '').replace(/\/+$/, '')}/cam/pair?code=${encodeURIComponent(code)}`;
}
