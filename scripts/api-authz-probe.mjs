#!/usr/bin/env node
/* eslint-disable no-console */

// scripts/api-authz-probe.mjs
// ─────────────────────────────────────────────────────────────
// The probe that needs a REAL session.
//
//   set -a; . ./smoke.env; set +a
//   node scripts/api-authz-probe.mjs
//
// ── WHY THIS EXISTS SEPARATELY FROM api-auth-probe.mjs ────────
// That one asks "will you serve a stranger". This one asks the harder
// question: "will you serve a LOGGED-IN user something that belongs to
// somebody else".
//
// The distinction is not academic — it is exactly the gap that let the
// cue-sheets IDOR live. That route called verifyArtistAuth, so it
// refused every anonymous probe and passed check:routes. It then read
// `artist_email` from the query string and queried by it, so any artist
// account could read, and via the upsert conflict target OVERWRITE, any
// other artist's cue sheet.
//
// Authentication was never the problem. Authorization was. A checker
// that only ever probes signed-out cannot see the difference, and I
// wrote that limitation into docs/SECURITY_AUDIT_2026-08-28.md as a
// known blind spot. This closes it.
//
// ── HOW IT GETS A SESSION ─────────────────────────────────────
// Through the app's own login form, in a real browser, reusing the smoke
// account. No service-role key, no minted token, no auth side door — the
// same principle as scripts/smoke.mjs, and for the same reason: a
// credential path that only the tests can use is a credential path
// nobody has tested.
//
// Requests are issued FROM THE PAGE, so they carry exactly what the real
// client carries.
//
// ── WHAT IT DELIBERATELY DOES NOT DO ──────────────────────────
// It never probes a real user's data. Every "other person" here is a
// fabricated address that cannot belong to anyone
// (probe-not-a-real-user@loudentify.invalid — .invalid is reserved by
// RFC 2606 precisely so it can never be registered). A correct server
// refuses on the MISMATCH, without ever needing to look the address up,
// so a fake one tests the rule exactly as well as a real one would and
// touches nobody.
// ─────────────────────────────────────────────────────────────

import { chromium } from 'playwright';

const BASE = (process.env.SMOKE_URL || '').replace(/\/+$/, '');
const BYPASS = process.env.VERCEL_AUTOMATION_BYPASS || '';
const EMAIL = process.env.SMOKE_EMAIL || '';
const PASSWORD = process.env.SMOKE_PASSWORD || '';

if (!BASE || !EMAIL || !PASSWORD) {
  console.error('Needs SMOKE_URL, SMOKE_EMAIL and SMOKE_PASSWORD. See docs/SMOKE_TEST.md.');
  process.exit(2);
}

// RFC 2606 reserved TLD: guaranteed never to resolve to a real account.
const NOT_ME = 'probe-not-a-real-user@loudentify.invalid';
const FAKE_HASH = 'a'.repeat(64);

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? '✔' : '✖'} ${name}`);
  if (detail) console.log(`    ${detail}`);
}

const browser = await chromium.launch();
const context = await browser.newContext({
  extraHTTPHeaders: BYPASS ? { 'x-vercel-protection-bypass': BYPASS } : {},
});
const page = await context.newPage();

await page.goto(`${BASE}/auth`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('input[type="email"]', { timeout: 20000 });
await page.fill('input[type="email"]', EMAIL);
await page.fill('input[type="password"]', PASSWORD);
await Promise.all([
  page.waitForURL((u) => !u.pathname.startsWith('/auth'), { timeout: 30000 }).catch(() => {}),
  page.getByRole('button', { name: /LOG IN/i }).last().click(),
]);
await page.waitForTimeout(2500);

if (page.url().includes('/auth')) {
  console.error('✖ SIGN-IN FAILED — cannot probe authorization without a session.');
  await browser.close();
  process.exit(2);
}
console.log(`signed in as ${EMAIL}\n`);

/** Issue a request from the page, carrying the real session bearer. */
async function callAs(method, path, body) {
  return page.evaluate(async ({ method, path, body }) => {
    let token = null;
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (!k || !k.includes('auth-token')) continue;
      try {
        const v = JSON.parse(localStorage.getItem(k));
        token = v?.access_token || v?.currentSession?.access_token || null;
        if (token) break;
      } catch { /* not the key we want */ }
    }
    const res = await fetch(path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(method === 'GET' ? {} : { body: JSON.stringify(body || {}) }),
    });
    let json = null;
    try { json = await res.json(); } catch { /* no body */ }
    return { status: res.status, json };
  }, { method, path, body });
}

console.log('── Finding 4: cue sheets must be scoped to the session, not a parameter ──\n');

{
  const r = await callAs('GET', `/api/cue-sheets?track_hash=${FAKE_HASH}&artist_email=${encodeURIComponent(NOT_ME)}`);
  record(
    'GET /api/cue-sheets with someone else\'s artist_email — refused',
    r.status === 403,
    `HTTP ${r.status} ${r.json?.error || ''}`
  );
}

{
  const r = await callAs('POST', '/api/cue-sheets', {
    track_hash: FAKE_HASH,
    artist_email: NOT_ME,
    name: 'probe-should-never-be-written',
    fallback_behaviour: 'hold',
    cues: [],
  });
  // The write half. This one could OVERWRITE a stranger's sheet, because
  // the upsert conflicts on (track_hash, artist_email, name).
  record(
    'POST /api/cue-sheets writing to someone else\'s artist_email — refused',
    r.status === 403,
    `HTTP ${r.status} ${r.json?.error || ''}`
  );
}

{
  // The control. Same request with the caller's OWN email must still be
  // accepted — a fix that refuses everything is not a fix, and without
  // this the two assertions above would pass on a route that simply 403s
  // unconditionally.
  const r = await callAs('GET', `/api/cue-sheets?track_hash=${FAKE_HASH}&artist_email=${encodeURIComponent(EMAIL)}`);
  record(
    'CONTROL — GET /api/cue-sheets with my OWN email still works',
    r.status === 200,
    `HTTP ${r.status}`
  );
}

{
  // And with the parameter omitted entirely, which is where callers
  // should end up.
  const r = await callAs('GET', `/api/cue-sheets?track_hash=${FAKE_HASH}`);
  record(
    'CONTROL — GET /api/cue-sheets with no artist_email at all still works',
    r.status === 200,
    `HTTP ${r.status}`
  );
}

console.log('\n── Findings 2 + 3: egress is scoped to the show\'s owner ──\n');

for (const action of ['start', 'stop']) {
  const r = await callAs('POST', `/api/egress/${action}`, { room: 'probe-room-not-my-show' });
  // A signed-in artist who does not own this room must be refused. The
  // room does not exist, so 404 ("no show is running in this room") is
  // the correct answer and 403 would be too; what must NOT happen is the
  // request reaching LiveKit.
  record(
    `POST /api/egress/${action} for a room I don't own — refused`,
    r.status === 404 || r.status === 403,
    `HTTP ${r.status} ${r.json?.error || ''}`
  );
}

console.log('\n── Finding 6: participants is scoped to the session ──\n');
{
  const r = await callAs('POST', '/api/participants', {
    show_id: '00000000-0000-0000-0000-000000000000',
    email: NOT_ME,
  });
  record(
    'POST /api/participants against a nonexistent show — refused, not a 500',
    r.status === 404,
    `HTTP ${r.status} ${r.json?.error || ''}`
  );
}

await browser.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed.`);
if (failed.length) {
  console.error(`\n✖ ${failed.length} FAILED — a signed-in user is reaching something that is not theirs:\n`);
  for (const f of failed) console.error(`  ${f.name}\n    ${f.detail}`);
  process.exit(1);
}
console.log('✔ Every cross-account request was refused, and every own-account control still works.');
