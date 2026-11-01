// lib/rigCameras.js — the artist's paired phones, as the cuts see them.
//
// Two vocabularies had to meet and never did. A phone is paired into a
// ROLE (lib/camfeedPairing.js CAMERA_ROLES: wide, close, side — where the
// phone is standing). The console offers CUTS (lib/liveCuts.js: main,
// side, close, broll — what the artist presses). Nothing translated
// between them, and worse, the console endpoint never returned the rig at
// all: native/app/artist/console/[id].js fell back to
// `{ main: { live: true } }`, so Side, Close and B-roll were refused for
// every show ever, no matter how many phones were paired. The manual cue
// buttons existed and could not be used.
//
// wide → main, because they are the same camera described from two ends:
// "the whole stage, from the back" is the camera an artist performs to.
//
// Pure function over rows and a clock, so it is testable without a
// database — same reasoning as lib/pairingLiveness.js, which it uses.
import { isLivePairing } from './pairingLiveness.js';

/** camfeed_pairings role → the cut that shows that camera. */
export const CUT_FOR_PAIRING_ROLE = Object.freeze({ wide: 'main', close: 'close', side: 'side' });

/**
 * The rig keyed by cut role: { main: { live }, side: …, close: … }.
 *
 * A camera is present once a phone has redeemed its code; `live` says
 * whether it is still sending. A code minted but never scanned is NOT a
 * camera — the console should say "Pair a phone as this camera", which it
 * does for an absent one, rather than "This camera stopped sending",
 * which it says for a dead one and which would be a lie about a phone
 * nobody has picked up.
 *
 * When two phones hold the same role the live one wins, so swapping a
 * phone mid-rehearsal does not leave the dead one speaking for the role.
 */
export function rigCameras(rows = [], now = Date.now()) {
  const cameras = {};
  for (const row of rows) {
    const cut = CUT_FOR_PAIRING_ROLE[row?.role];
    if (!cut || !row.used_at || row.revoked_at) continue;
    const live = isLivePairing(row, now);
    if (cameras[cut]?.live && !live) continue;
    cameras[cut] = { live, pairingId: row.id, lastSeenAt: row.last_seen_at || row.used_at };
  }
  return cameras;
}
