#!/usr/bin/env node
/* eslint-disable no-console */

// scripts/freeze-csv.mjs
// ─────────────────────────────────────────────────────────────
// TASK 5 — pull the freeze telemetry down as a CSV file.
//
//   node scripts/freeze-csv.mjs <room_name> [--since <iso>] [--out <file>] [--base <url>]
//
// Signs in through the app's own login form (same as the smoke check),
// so it uses a real session against the owner-only export route rather
// than any privileged key.
//
// ── WHY THE DIAGNOSTICS IN HERE ARE WORTH THE LINES ───────────
// This script cost real time twice, both times for the same reason: it
// collapsed several distinct failures into one message. "Sign-in failed"
// was printed whether the password was wrong, the account was signed in
// perfectly but did not OWN the show, or the deployment was sitting
// behind Vercel SSO with no bypass token. Those need three different
// actions, and guessing which one applied is what burned the time.
//
// So every exit below names what happened AND what to do about it. The
// route already distinguishes these cleanly (401 / 403 / 404 / 400);
// the script simply was not reading them.
// ─────────────────────────────────────────────────────────────

import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const room = args.find((a) => !a.startsWith('--'));
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? null : args[i + 1];
};

// ── THE DEFAULT ───────────────────────────────────────────────
// Production, because it is the one URL that always exists and never
// changes identity. Preview deployments come and go and their hash URLs
// are not worth memorising; when you want one, pass --base with the
// branch alias (never a hash URL — it will be stale within the hour).
//
// Whatever it resolves to is PRINTED before anything else happens. Half
// of this script's cost was pulling real data from the wrong deployment
// and having no way to tell from the output.
const DEFAULT_BASE = 'https://loud-app-umber.vercel.app';
const BASE = (flag('base') || process.env.SMOKE_URL || DEFAULT_BASE).replace(/\/+$/, '');
const BASE_SOURCE = flag('base') ? '--base' : process.env.SMOKE_URL ? 'SMOKE_URL' : 'default';

const BYPASS = process.env.VERCEL_AUTOMATION_BYPASS || '';
const EMAIL = process.env.SMOKE_EMAIL || '';
const PASSWORD = process.env.SMOKE_PASSWORD || '';

function die(code, headline, ...lines) {
  console.error(`\n✖ ${headline}`);
  for (const l of lines) console.error(`  ${l}`);
  console.error('');
  process.exit(code);
}

if (!room) {
  die(2, 'No room name given.',
    'Usage: node scripts/freeze-csv.mjs <room_name> [--since <iso>] [--out <file>] [--base <url>]',
    '',
    "The room name is the show's `room_name` (e.g. show-a1b2c3d4), which is what",
    'health_events.show_id holds — NOT the show id (a uuid). If you have the uuid,',
    'the room name is on the shows row as room_name.');
}
if (!EMAIL || !PASSWORD) {
  die(2, 'No credentials in the environment.',
    'Needs SMOKE_EMAIL and SMOKE_PASSWORD. Typically:',
    '  set -a; . ./smoke.env; set +a',
    'To pull YOUR OWN show, use your own account for this run — the export route is',
    'owner-only, so the smoke account will be refused on a show it does not own:',
    '  SMOKE_EMAIL=you@example.com SMOKE_PASSWORD=... node scripts/freeze-csv.mjs <room>');
}

const out = flag('out') || `freeze-${room}.csv`;
const since = flag('since');

console.log(`  base   ${BASE}   (from ${BASE_SOURCE})`);
console.log(`  room   ${room}`);
console.log(`  as     ${EMAIL}`);
if (!BYPASS && !BASE.includes('loud-app-umber')) {
  console.log('  note   VERCEL_AUTOMATION_BYPASS is not set and this is not production —');
  console.log('         if the deployment is SSO-protected the login form will never appear.');
}
console.log('');

const browser = await chromium.launch();
const context = await browser.newContext({
  extraHTTPHeaders: BYPASS ? { 'x-vercel-protection-bypass': BYPASS } : {},
});
const page = await context.newPage();

await page.goto(`${BASE}/auth`, { waitUntil: 'domcontentloaded' });

// ── FAILURE 1: the login form never appears ───────────────────
// Almost always Vercel SSO on a preview with no bypass token, which
// renders an entirely different page. Reported as itself rather than as
// a sign-in failure, because the credentials are irrelevant here.
try {
  await page.waitForSelector('input[type="email"]', { timeout: 20000 });
} catch {
  const title = await page.title().catch(() => '');
  const url = page.url();
  await browser.close();
  // Match on the TITLE only. An earlier version tested the url too, and
  // since every one of these hosts is *.vercel.app it matched /vercel/
  // every single time and blamed Deployment Protection for everything —
  // the same over-broad diagnosis this script exists to stop making.
  let why;
  if (/404|not.?found/i.test(title)) {
    why = ['No deployment answers at that URL — the alias does not exist yet.',
           'A branch alias only appears once the branch has been pushed AND built.'];
  } else if (/authenticat|login required|sso|deployment protection/i.test(title)) {
    why = ['That is Vercel Deployment Protection. Set VERCEL_AUTOMATION_BYPASS and retry.'];
  } else {
    why = ['The page loaded but has no email field.',
           'Check --base points at the app itself and not at a redirect.'];
  }
  die(3, 'The login form never rendered — this is not a credentials problem.',
    `landed on: ${url}`,
    `page title: ${title || '(none)'}`,
    '',
    ...why);
}

await page.fill('input[type="email"]', EMAIL);
await page.fill('input[type="password"]', PASSWORD);
await Promise.all([
  page.waitForURL((u) => !u.pathname.startsWith('/auth'), { timeout: 30000 }).catch(() => {}),
  page.getByRole('button', { name: /LOG IN/i }).last().click(),
]);
await page.waitForTimeout(2500);

// ── FAILURE 2: AUTHENTICATION ─────────────────────────────────
// Tested by whether a session token actually exists, NOT by the URL.
// The old check was `page.url().includes('/auth')`, which also reports
// failure for an account that signed in perfectly well and was then
// redirected somewhere it lacks access to — a DIFFERENT problem with a
// different fix, and precisely the conflation this rewrite removes.
const auth = await page.evaluate(() => {
  for (let i = 0; i < localStorage.length; i += 1) {
    const k = localStorage.key(i);
    if (!k || !k.includes('auth-token')) continue;
    try {
      const v = JSON.parse(localStorage.getItem(k));
      const token = v?.access_token || v?.currentSession?.access_token || null;
      const email = v?.user?.email || v?.currentSession?.user?.email || null;
      if (token) return { token, email };
    } catch { /* not the key we want */ }
  }
  return { token: null, email: null };
});

if (!auth.token) {
  const onScreen = await page.locator('text=/invalid|incorrect|wrong|not found/i').first().textContent().catch(() => null);
  const url = page.url();
  await browser.close();
  die(4, 'AUTHENTICATION failed — no session was established.',
    `still at: ${url}`,
    onScreen ? `the page says: ${onScreen.trim()}` : 'no error message was shown on the page',
    '',
    'The credentials in SMOKE_EMAIL / SMOKE_PASSWORD were not accepted.',
    'This is about WHO YOU ARE, not what you can reach.');
}

const qs = new URLSearchParams({ room });
if (since) qs.set('since', since);

const result = await page.evaluate(async ({ url, token }) => {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  return {
    status: res.status,
    contentType: res.headers.get('Content-Type') || '',
    rows: res.headers.get('X-Row-Count'),
    truncated: res.headers.get('X-Truncated'),
    body: await res.text(),
  };
}, { url: `/api/health-events/export?${qs.toString()}`, token: auth.token });

await browser.close();

function routeSaid(body) {
  try { return JSON.parse(body)?.error || null; } catch { return null; }
}

if (result.status !== 200) {
  const said = routeSaid(result.body);
  const isJson = result.contentType.includes('application/json');

  // ── FAILURE 3: AUTHORIZATION ────────────────────────────────
  // Signed in fine; this show belongs to someone else. Naming the
  // signed-in account is the whole fix — the answer is almost always
  // "you are the smoke account, not yourself."
  if (result.status === 403) {
    die(5, 'AUTHORIZATION failed — you are signed in, but this is not your show.',
      `signed in as: ${auth.email || EMAIL}`,
      said ? `route said: ${said}` : '',
      '',
      'The export route is owner-only. Re-run with the account that owns this show:',
      `  SMOKE_EMAIL=owner@example.com SMOKE_PASSWORD=... node scripts/freeze-csv.mjs ${room}`);
  }

  if (result.status === 401) {
    die(4, 'AUTHENTICATION rejected by the route — the session was not accepted.',
      said ? `route said: ${said}` : '',
      'A token existed in the browser but the server refused it (expired, or a different project).');
  }

  // ── FAILURE 4: 404, and WHICH 404 ───────────────────────────
  // Two completely different things wear this code. The route answering
  // in JSON means the route is deployed and the ROOM is unknown. An HTML
  // body means Next served its own 404 and the ROUTE is not on this
  // deployment at all — which is what you get pointing an up-to-date
  // script at an older build.
  if (result.status === 404) {
    if (isJson || said) {
      die(6, 'Route reached, but NO SHOW matches that room name.',
        said ? `route said: ${said}` : '',
        `room asked for: ${room}`,
        '',
        'health_events.show_id holds the room_name (show-a1b2c3d4), not the show uuid.',
        'Check the value on the shows row, or the artist console network tab.');
    }
    die(7, 'The EXPORT ROUTE does not exist on this deployment.',
      `base: ${BASE}`,
      'Next served its own HTML 404, so /api/health-events/export was never reached.',
      '',
      'That route shipped with MVP round 1. Point --base at a deployment that has it,',
      'or check the branch alias has finished building.');
  }

  if (result.status === 400) {
    die(2, 'The route refused the request as malformed.', said ? `route said: ${said}` : '');
  }

  die(1, `Export failed — HTTP ${result.status}.`,
    said ? `route said: ${said}` : result.body.slice(0, 300));
}

writeFileSync(out, result.body);
console.log(`✔ ${result.rows} rows → ${out}`);
if (result.truncated === 'true') {
  console.warn('⚠ TRUNCATED at the route cap — narrow the window with --since and pull again.');
}
console.log('\nColumns worth sorting by first:');
console.log('  uplinkBps vs availableOutgoingBitrate   → uplink starvation');
console.log('  framesNotSent                           → encoded but not sent');
console.log('  qualityLimitationReason, avgQp          → encoder pressure');
console.log('  activeLayers (event pub_simulcast_switch) → layer thrash');
console.log('\nFor the round-2 countdown diagnosis, sort by `event` and look for:');
console.log('  audiocontext_statechange  → did the context go suspended/closed, and when');
console.log('  audio_host_released       → and with what `reason` (replaced | leave | show_ended)');
console.log('  audio_host_adopted / deck_track_adopted → what the live page did on arrival');
