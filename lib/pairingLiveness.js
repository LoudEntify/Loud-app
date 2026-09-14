// lib/pairingLiveness.js
// ─────────────────────────────────────────────────────────────
// What counts as part of the artist's camera rig, as a pure function
// over a camfeed_pairings row and a clock.
//
// PRD: Multi-camera / Kit Check · S&I: Database
//
// DELIBERATELY SEPARATE FROM lib/camfeedPairing.js, which imports
// 'server-only' and therefore cannot be loaded by a plain Node script.
// Same reasoning as lib/showWindow.js: a predicate that decides whether
// an artist can pair a camera at all is a predicate that has to be
// runnable in isolation. scripts/window-tests.mjs covers it, and the
// comment at the top of that file explains why — the countdown broke
// twice, both times in a predicate nobody could run on its own.
//
// camfeedPairing.js re-exports both of these, so callers keep importing
// from the one module they already use.
// ─────────────────────────────────────────────────────────────

// How long after a phone was last heard from it still counts as a
// camera. Same order as the expires_at push in migrateToShow
// (app/api/camfeed/pair/route.js), and for the same reason: a show plus
// the setup either side of it, with room for a phone that spends part of
// it on a locked screen.
export const PAIRING_LIVENESS_MS = 6 * 60 * 60 * 1000;

/**
 * Is this pairing row part of the artist's rig RIGHT NOW?
 *
 * The cap counts cameras, and a camera is a thing that exists or is
 * about to. Before this existed the cap counted ROWS — every code ever
 * minted, forever, because nothing prunes — so an artist who had
 * rehearsed a few times could not pair a camera at all, and the error
 * told them to remove one of six cameras that did not exist.
 *
 * Three states, and only two of them are a camera:
 *
 *   not redeemed, not expired  live. A camera is about to exist.
 *   redeemed, seen recently    live. A camera exists.
 *   not redeemed, expired      dead. Nobody ever picked up the phone.
 *   redeemed, long unseen      dead. A phone from a previous rehearsal.
 *
 * `expires_at` is deliberately NOT consulted for a redeemed row. It stops
 * meaning anything the moment a single-use code is redeemed, and
 * migrateToShow pushes it out by six hours anyway — reading it here would
 * make a live camera's liveness depend on a field that is only updated
 * when the artist happens to walk into a show.
 *
 * `last_seen_at ?? used_at` because last_seen_at is only maintained on
 * the multi-camera path (the session poll, and redemption when
 * caps.multiCamera). A row redeemed before that column was written has a
 * null there and an old used_at, and falling back to it gives the honest
 * answer — "the last moment we had any evidence this device existed" —
 * rather than treating an ancient row as either permanently live or
 * mysteriously dead.
 */
export function isLivePairing(row, now = Date.now()) {
  if (!row || row.revoked_at) return false;

  if (!row.used_at) {
    const expiresAt = row.expires_at ? new Date(row.expires_at).getTime() : NaN;
    // An unparseable or absent expiry cannot be shown to be live. Erring
    // toward dead here loosens the cap rather than locking an artist out
    // of their own rig, which is the failure this item exists to fix.
    return Number.isFinite(expiresAt) && expiresAt > now;
  }

  const lastEvidence = new Date(row.last_seen_at || row.used_at).getTime();
  return Number.isFinite(lastEvidence) && now - lastEvidence < PAIRING_LIVENESS_MS;
}
