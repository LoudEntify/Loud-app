// lib/siteGate.js
// ─────────────────────────────────────────────────────────────
// Is the public site closed, and does this path stay open anyway?
//
// DELIBERATELY SEPARATE FROM middleware.js, which imports
// 'next/server' and therefore cannot be loaded by a plain Node script.
// Same reasoning as lib/showWindow.js and lib/pairingLiveness.js: a
// predicate that decides whether anyone can reach the product is a
// predicate that has to be runnable, and testable, on its own.
//
// ── THE GATE ──────────────────────────────────────────────────
// With SITE_MODE=coming_soon, every page of the public site renders
// the mark and three words. Asked for on 3 Nov so nobody can use the
// product on the production domain while the pilot is still being
// built.
//
// An environment variable rather than a code switch, because taking
// the gate down must not need a deploy: production sets it, staging
// does not, and one build serves both.
//
// ── WHAT STAYS OPEN, AND WHY ──────────────────────────────────
// Not everything on this domain is a person browsing. Four things run
// here that blocking would break the product rather than close it:
//
//   /api/…     the native app's backend — the production app profile
//              points at this domain (native/eas.json) — and YouTube's
//              OAuth callback, where an artist reconnecting their
//              channel lands. Gating it locks every artist out of
//              their own account.
//   /egress    LiveKit's compositor navigates a headless browser here
//              to render the broadcast (EGRESS_TEMPLATE_BASE_URL).
//              Gate it and shows go out blank.
//   /cam…      what a scanned pairing QR opens on a second phone.
//   /privacy,  Google's OAuth consent screen links to the policy and
//   /legal…    the app stores require it to resolve. A policy that
//              404s while an app is live is a compliance problem, not
//              a closed shop.
// ─────────────────────────────────────────────────────────────

/** The one value that closes the site. Anything else leaves it open. */
export const GATE_MODE = 'coming_soon';

/** The page every gated request renders. */
export const GATE_PAGE = '/coming-soon';

/** Paths that keep working with the gate up. */
export const GATE_EXEMPT = Object.freeze([
  '/api',
  '/egress',
  '/cam',
  '/privacy',
  '/legal',
  GATE_PAGE,
]);

/**
 * Segment-aware, not a bare prefix: `/apifoo` is not `/api`, and a gate
 * that a lookalike path can talk its way through is not a gate.
 */
export function isExempt(pathname) {
  const path = String(pathname || '');
  return GATE_EXEMPT.some((p) => path === p || path.startsWith(`${p}/`));
}

/** Closed only when production says so. Absent, empty or anything else: open. */
export function gateIsUp(env = {}) {
  return env.SITE_MODE === GATE_MODE;
}

/** The one question the middleware asks. */
export function shouldGate(pathname, env = {}) {
  return gateIsUp(env) && !isExempt(pathname);
}
