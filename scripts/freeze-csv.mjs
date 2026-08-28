#!/usr/bin/env node
/* eslint-disable no-console */

// scripts/freeze-csv.mjs
// ─────────────────────────────────────────────────────────────
// TASK 5 — pull the freeze telemetry down as a CSV file.
//
//   set -a; . ./smoke.env; set +a
//   node scripts/freeze-csv.mjs <room_name> [--since 2026-08-28T20:00:00Z] [--out file.csv]
//
// Signs in through the app's own login form (same as the smoke check),
// so it uses a real session against the owner-only export route rather
// than any privileged key.
//
// ⚠️ The account in smoke.env must OWN the show — the route checks. To
// pull your own show's telemetry, put your own credentials in the
// environment for this run:
//
//   SMOKE_EMAIL=you@example.com SMOKE_PASSWORD=... node scripts/freeze-csv.mjs show-abc123
// ─────────────────────────────────────────────────────────────

import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const room = args.find((a) => !a.startsWith('--'));
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? null : args[i + 1];
};

const BASE = (process.env.SMOKE_URL || '').replace(/\/+$/, '');
const BYPASS = process.env.VERCEL_AUTOMATION_BYPASS || '';
const EMAIL = process.env.SMOKE_EMAIL || '';
const PASSWORD = process.env.SMOKE_PASSWORD || '';

if (!room || !BASE || !EMAIL || !PASSWORD) {
  console.error('Usage: node scripts/freeze-csv.mjs <room_name> [--since <iso>] [--out <file>]');
  console.error('Needs SMOKE_URL, SMOKE_EMAIL, SMOKE_PASSWORD in the environment.');
  console.error('\nThe room name is the show\'s `room_name` (e.g. show-a1b2c3d4), which is what');
  console.error('health_events.show_id holds. You can read it off the artist console\'s network tab.');
  process.exit(2);
}

const out = flag('out') || `freeze-${room}.csv`;
const since = flag('since');

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
  console.error('✖ Sign-in failed.');
  await browser.close();
  process.exit(2);
}

const qs = new URLSearchParams({ room });
if (since) qs.set('since', since);

const result = await page.evaluate(async (url) => {
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
  const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  return { status: res.status, rows: res.headers.get('X-Row-Count'), truncated: res.headers.get('X-Truncated'), body: await res.text() };
}, `/api/health-events/export?${qs.toString()}`);

await browser.close();

if (result.status !== 200) {
  console.error(`✖ HTTP ${result.status}`);
  console.error(result.body.slice(0, 400));
  process.exit(1);
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
