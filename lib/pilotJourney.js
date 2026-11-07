// lib/pilotJourney.js
// ─────────────────────────────────────────────────────────────
// The pilot journey's routes, and whether they are reachable.
//
// Korey, 5 Nov: "I can see that some pages on teh web app is showing
// some old pilot pages which should not be."
//
// He is right, and docs/ONE_JOURNEY.md §1 says why: there are two
// complete artist journeys in this repository and both route. The pilot's
// is `/kit-check` (components/KitCheck.jsx, 827 lines), `/pilot` and
// `/pilot/live` (components/LiveDemo.jsx, 6,591 lines), plus a
// middleware rewrite that quietly sent `/live?show=<id>` into the pilot
// show screen. Anyone who still had a pilot link, or typed a pilot URL,
// landed in the old product.
//
// ── WHY GATED AND NOT DELETED ─────────────────────────────────
// ONE_JOURNEY §7 sequences the retirement AFTER the pilot's capability
// panels are reused behind the new screens, and for a reason: the pilot
// journey is the only working version of cueing a backing track, the
// audio deck, the shot console, cue sheets and headphone calibration.
// Deleting the routes today would delete the specification along with
// them, which is exactly the mistake docs/ONE_JOURNEY.md §3 records.
//
// So the routes close and the components stay importable. Korey stops
// finding old pages; the panels stay available to be lifted behind the
// new journey; and when they have been, these pages and their components
// go together in one commit.
//
// ── WHY THE SAME GATE AS THE SPIKE ────────────────────────────
// app/spike/controller already closes itself with devHarnessAllowed(),
// decided on the server before anything renders, so the URL is a plain
// 404 and the page's code is never sent to a browser. That is the right
// shape here too, and reusing it means one idea of "this is a harness,
// not the product" rather than two.
//
// Imports nothing and names no framework, so it can be tested without
// Next.js — the same rule as lib/siteGate.js, for the same reason.
// ─────────────────────────────────────────────────────────────

/**
 * Every path the pilot journey answers on.
 *
 * Listed rather than pattern-matched: this is a fixed set that should
 * only ever shrink, and a pattern would quietly catch a new route that
 * happened to sit under one of these names.
 */
export const PILOT_PATHS = Object.freeze([
  '/kit-check',   // components/KitCheck.jsx — the pilot's Kit Check
  '/pilot',       // components/HomeDoors.jsx — the pilot's front door
  '/pilot/live',  // components/LiveDemo.jsx — the pilot's show screen
]);

/** Is this path part of the retired journey? Exact match, with or without a trailing slash. */
export function isPilotPath(pathname) {
  if (typeof pathname !== 'string' || !pathname) return false;
  const clean = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  return PILOT_PATHS.includes(clean);
}

/**
 * Where a pilot show link should land now.
 *
 * `/live?show=<id>` was the pilot's own share link, so people have it in
 * messages and posts. It used to be rewritten into `/pilot/live`. It now
 * goes to the current show screen, because the honest answer to an old
 * link is this show in the product that exists, not a preserved copy of
 * the old one.
 */
export const showPathFor = (showId) => `/show/${showId}`;

/**
 * Should a pilot route render at all?
 *
 * `allowed` is the environment's own dev-harness decision, passed in
 * rather than read here, so this module stays free of both Next.js and
 * the payment provider.
 */
export const pilotReachable = (allowed) => Boolean(allowed);
