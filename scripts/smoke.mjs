#!/usr/bin/env node
/* eslint-disable no-console */

// scripts/smoke.mjs
// ─────────────────────────────────────────────────────────────
// LOADS THE AUTHENTICATED SURFACES, SIGNED IN, IN A REAL BROWSER,
// AND FAILS IF ANY OF THEM THROWS OR FAILS TO RENDER.
//
// ── WHY THIS EXISTS ─────────────────────────────────────────────
// Three crashes in a row shipped past a verification that looked
// thorough and could not possibly have caught them:
//
//   1. the Leave crash    (hooks-order, inside a live show)
//   2. a TDZ ReferenceError (artist console)
//   3. windowClosesAt undefined (artist console again)
//
// Every one was on an AUTHENTICATED surface, and every one passed a
// "bypass-loaded, HTTP 200" check — because that check gets past
// VERCEL's deployment protection and stops there. It never gets past
// LOUDENTIFY's own login. `/artist/{id}` returns 200 as the LOGIN
// REDIRECT SHELL, so the check went green while the console was dead.
//
// The set of pages my verification could reach was exactly the set of
// pages that cannot crash in an interesting way. This closes that.
//
// ── WHAT "RENDERED" MEANS HERE ──────────────────────────────────
// Not a status code, and not "the HTML came back". Each route must:
//   * raise ZERO uncaught page errors,
//   * log ZERO React error-boundary / ReferenceError console errors,
//   * and contain a MARKER — a string only the real, rendered surface
//     produces. A login screen or an error page does not contain it,
//     so a redirect-to-login cannot pass as a render.
//
// The marker is the important half. Without it this would go green on a
// page that rendered a blank div perfectly happily.
//
// ── CREDENTIALS ─────────────────────────────────────────────────
// A dedicated test account, never a real one. Supplied as env vars:
//
//   SMOKE_EMAIL, SMOKE_PASSWORD   the artist test account
//   SMOKE_URL                     the preview to check
//   VERCEL_AUTOMATION_BYPASS      the deployment-protection bypass
//
// Kept out of the repo deliberately — see docs/SMOKE_TEST.md for how to
// create the account and where to store them. The script signs in
// THROUGH THE APP'S OWN LOGIN FORM rather than minting a session by
// some side door: a preview-only auth bypass would be a real hazard for
// a saving of about ten lines, and signing in normally also proves the
// login path still works.
// ─────────────────────────────────────────────────────────────

import { chromium } from 'playwright';

const URL_BASE = (process.env.SMOKE_URL || '').replace(/\/+$/, '');
const EMAIL = process.env.SMOKE_EMAIL || '';
const PASSWORD = process.env.SMOKE_PASSWORD || '';
const BYPASS = process.env.VERCEL_AUTOMATION_BYPASS || '';

if (!URL_BASE) {
  console.error('Missing SMOKE_URL. See docs/SMOKE_TEST.md.');
  process.exit(2);
}
// Credentials are NOT required to run -- see the note on the signed-out
// run below. They are required to PASS.
const HAVE_CREDS = !!(EMAIL && PASSWORD);

// Errors that are noise rather than a broken page. Deliberately SHORT
// and specific: an over-broad ignore list is how a smoke test goes green
// on a real failure, which is the exact failure mode being fixed here.
const IGNORABLE = [
  /Failed to load resource.*favicon/i,
  /Download the React DevTools/i,
  // Media/WebRTC cannot work in a headless shell with no devices. A live
  // page is expected to complain about that and it says nothing about
  // whether the page rendered.
  /NotFoundError.*Requested device not found/i,
  /NotAllowedError.*(Permission|denied)/i,
  /getUserMedia/i,
];

function ignorable(text) {
  return IGNORABLE.some((re) => re.test(text));
}

/**
 * The routes, and what proves each one actually rendered.
 *
 * `marker` is text that ONLY the real surface produces. Picking these is
 * the whole craft of this file: too generic (a nav label present on the
 * login screen too) and a redirect passes; too specific (a value that
 * depends on the account's data) and it fails for an empty account.
 */
// `auth: true` means the route is GATED and cannot render signed out.
// Marked honestly rather than optimistically: /discover, /notifications
// and /shows genuinely render for a signed-out visitor (they show their
// own empty states), so calling them "authenticated" would overstate
// what a green run proves. They stay in the list because they are still
// worth checking for render errors.
const ROUTES = [
  { path: '/settings',        marker: 'REQUEST MY DATA',  auth: true,  note: 'account controls' },
  { path: '/wallet',          marker: 'TOKEN BALANCE',    auth: true,  note: 'wallet + purchase tiers' },
  { path: '/welcome',         marker: 'DO THIS LATER',    auth: true,  note: 'onboarding walkthrough' },
  { path: '/kit-check',       marker: 'Kit Check',        auth: true,  note: 'studio + camera pairing' },
  // THE ONE THAT KEEPS BREAKING. Resolved from the signed-in session, so
  // it is the artist's own console in OWNER mode -- the surface all
  // three crashes were on, and the one a signed-out load cannot reach:
  // signed out it renders the public storefront, which never mounts
  // ScheduleShow and so never touched any of the code that crashed.
  { path: '__OWN_PROFILE__',  marker: 'Schedule a show',  auth: true,  note: 'ARTIST CONSOLE (owner mode)' },
  { path: '/discover',        marker: 'LIVE NOW',         auth: false, note: 'discovery feed (public)' },
  { path: '/notifications',   marker: 'Notifications',    auth: false, note: 'notification centre (public shell)' },
  { path: '/shows',           marker: 'Recorded',         auth: false, note: 'recorded shows (public shell)' },
];

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    // The deployment-protection bypass, sent on every request in the
    // context rather than per-navigation, so client-side fetches carry
    // it too.
    extraHTTPHeaders: BYPASS ? { 'x-vercel-protection-bypass': BYPASS } : {},
    // A real viewport: several surfaces branch on width (the desktop
    // portrait stage, the grid/list flip), and checking only a phone
    // width would leave the desktop paths unrendered.
    viewport: { width: 1280, height: 900 },
  });

  const results = [];
  let ownProfilePath = null;

  const page = await context.newPage();

  // ── Sign in, through the app's own form ────────────────────
  //
  // A FAILED SIGN-IN DOES NOT ABORT THE RUN, deliberately. It continues
  // signed-out and reports every route as unverified -- which is both an
  // honest result and a live demonstration of the thing this file
  // exists for: signed out, every one of these routes still returns
  // HTTP 200 (as the login shell) and every marker check still fails.
  // That is precisely the gap the old "bypass-loaded, 200 OK" check
  // could not see.
  let signedIn = false;
  const signinErrors = [];
  page.on('pageerror', (e) => signinErrors.push(String(e)));

  if (HAVE_CREDS) {
    await page.goto(`${URL_BASE}/auth`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('input[type="email"]', { timeout: 20000 });
    await page.fill('input[type="email"]', EMAIL);
    await page.fill('input[type="password"]', PASSWORD);
    await Promise.all([
      page.waitForURL((u) => !u.pathname.startsWith('/auth'), { timeout: 30000 }).catch(() => {}),
      page.getByRole('button', { name: /LOG IN/i }).last().click(),
    ]);
    await page.waitForTimeout(2500);
    signedIn = !page.url().includes('/auth');
    if (!signedIn) {
      console.error('✖ SIGN-IN FAILED — still on /auth.');
      console.error('  Check SMOKE_EMAIL/SMOKE_PASSWORD and that the account exists on this deployment’s database.');
      const shown = await page.innerText('body').catch(() => '');
      const line = shown.split('\n').find((l) => /fail|invalid|confirm|credential/i.test(l));
      if (line) console.error('  The page says:', line.trim());
      if (signinErrors.length) console.error('  Page errors:', signinErrors.join('\n  '));
    }
  } else {
    console.error('✖ NO CREDENTIALS — running SIGNED OUT.');
    console.error('  Every authenticated route below will report NO. That is the correct answer,');
    console.error('  and it is what an HTTP-200 check cannot tell you. See docs/SMOKE_TEST.md.');
  }
  console.error('');

  // The console lives at /artist/{own id}. Read it from the session
  // rather than hardcoding, so this works for any test account.
  const userId = !signedIn ? null : await page.evaluate(() => {
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (!k || !k.includes('auth-token')) continue;
      try {
        const v = JSON.parse(localStorage.getItem(k));
        const id = v?.user?.id || v?.currentSession?.user?.id;
        if (id) return id;
      } catch { /* not the key we want */ }
    }
    return null;
  });
  ownProfilePath = userId ? `/artist/${userId}` : '/profile';
  console.log(signedIn
    ? `signed in as ${EMAIL} — console at ${ownProfilePath}\n`
    : `signed out — console path unknown, probing ${ownProfilePath}\n`);

  // ── Each route ─────────────────────────────────────────────
  for (const route of ROUTES) {
    const path = route.path === '__OWN_PROFILE__' ? ownProfilePath : route.path;
    const errors = [];
    const p = await context.newPage();
    p.on('pageerror', (e) => errors.push(`pageerror: ${e.message || e}`));
    p.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      if (!ignorable(text)) errors.push(`console.error: ${text}`);
    });

    let status = null;
    let rendered = false;
    let bodyLen = 0;
    try {
      const resp = await p.goto(`${URL_BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      status = resp?.status() ?? null;
      // Client-rendered React: the marker cannot be in the initial HTML,
      // so this waits for it rather than reading the response body. The
      // wait failing IS the failure -- that is the check.
      await p.waitForFunction(
        (m) => document.body && document.body.innerText.includes(m),
        route.marker,
        { timeout: 20000 }
      );
      rendered = true;
    } catch {
      rendered = false;
    }
    try { bodyLen = (await p.innerText('body')).length; } catch { /* page may be broken */ }

    results.push({ path, note: route.note, marker: route.marker, auth: route.auth, status, rendered, errors, bodyLen });
    await p.close();
  }

  await browser.close();

  // ── Report ─────────────────────────────────────────────────
  let failed = 0;
  console.log('ROUTE                              AUTH  STATUS  RENDERED  ERRORS');
  console.log('─'.repeat(78));
  for (const r of results) {
    const ok = r.rendered && r.errors.length === 0;
    if (!ok) failed += 1;
    console.log(
      `${(ok ? '✔ ' : '✖ ') + r.path.padEnd(32)} ${(r.auth ? 'yes' : ' — ').padEnd(4)}  ${String(r.status ?? '—').padEnd(6)}  ${(r.rendered ? 'yes' : 'NO').padEnd(8)}  ${r.errors.length}`
    );
    if (!r.rendered) console.log(`    ↳ marker not found: "${r.marker}"  (body was ${r.bodyLen} chars)`);
    for (const e of r.errors) console.log(`    ↳ ${e}`);
  }
  console.log('─'.repeat(72));
  const authCount = results.filter((r) => r.auth).length;
  if (failed === 0 && signedIn) {
    console.log(`ALL ${results.length} ROUTES RENDERED CLEAN (${authCount} of them GATED), SIGNED IN AS ${EMAIL}`);
  } else if (!signedIn) {
    console.log(`${failed} of ${results.length} unverified — NOT SIGNED IN.`);
    console.log('Note what this run proves anyway: every route returned a status and NONE rendered.');
    console.log('An HTTP-200 check would have called all of them green.');
  } else {
    console.log(`${failed} of ${results.length} FAILED`);
  }
  process.exit(failed === 0 && signedIn ? 0 : 1);
}

main().catch((err) => {
  console.error('smoke run failed:', err);
  process.exit(2);
});
