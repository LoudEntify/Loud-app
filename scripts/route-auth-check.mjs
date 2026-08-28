#!/usr/bin/env node
/* eslint-disable no-console */

// scripts/route-auth-check.mjs
// ─────────────────────────────────────────────────────────────
// Every route under app/api/ must either use a recognised auth
// mechanism, or be listed below with a written reason.
//
// WHY THIS EXISTS
// ───────────────
// The 2026-08-28 security round found `/api/token?camfeed=a` minting
// CAMERA-publish tokens into any room for any caller, with no
// authentication of any kind — reachable from a show's own public link.
// It had been there since the pilot.
//
// Nothing in the repo was ever going to notice. It is not a crash, not a
// type error, not a failing test; the route works perfectly, for
// everyone, which is precisely the problem. `npm run check` was four
// checks deep and every one of them was about whether the code RUNS.
//
// So this asks the one question none of them ask: does this route say
// who is allowed to call it?
//
// WHAT IT IS NOT
// ──────────────
// It is a FILE-level grep, not a proof. It cannot tell you the check is
// in the right place, that it covers every exported method, or that the
// route scopes its query to the caller once verified — the cue-sheets
// IDOR found in the same round passes this check, because the route does
// call verifyArtistAuth; it just then trusts an artist_email from the
// query string.
//
// What it does catch is the whole class of "a new route shipped with no
// auth model and nobody noticed", and it makes the allowlist below the
// place where that decision is visible and has to be argued in writing.
//
//   node scripts/route-auth-check.mjs
// ─────────────────────────────────────────────────────────────

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const API_DIR = join(ROOT, 'app', 'api');

// Anything here counts as "this route states its auth model".
const AUTH_MARKERS = [
  'verifyArtistAuth',   // bearer -> service-role getUser -> profiles.role==='artist'
  'verifySession',      // bearer -> service-role getUser (no role requirement)
  'WebhookReceiver',    // LiveKit signature verification
  'verifySignature',    // payment provider signature verification
  'hashDeviceSecret',   // paired-device secret, compared against a stored hash
  'session_token',      // show_slots rotating claim token
  'devHarnessAllowed',  // preview-only dev harness gate
];

// Routes that have no caller auth. Each needs a reason, and the reason is
// read by a human at review time — an empty string fails.
//
// TWO KINDS, and the difference is the point:
//
//   settled — genuinely fine unauthenticated, argued in the reason.
//   pending — a KNOWN, OPEN finding that has not been fixed yet.
//
// A `pending` entry prints as a loud warning on every run and never goes
// quiet, but does not fail the build. That is deliberate. The alternative
// designs are both worse: failing the build turns a known issue into a
// blocked QA sitting, and a plain allowlist entry lets a real hole go
// green and get forgotten inside a file nobody reopens. An open finding
// should be noisy and non-blocking, not silent or fatal.
//
// Clearing a `pending` means fixing the route and DELETING the entry —
// not editing it into a `settled`.
const ALLOWLIST = {
  'token/route.js': {
    status: 'settled',
    reason:
      'Deliberately public: this route now mints exactly one grant, and it is subscribe-only ' +
      '(canPublish:false). Viewers watch without an account, which is a product decision. ' +
      'Both publish branches that used to live here are closed — `?contestant=` (Accounts & Identity Day 1) ' +
      'and `?camfeed=` (2026-08-28 security round). If a future edit reintroduces canPublish:true here, ' +
      'scripts/api-auth-probe.mjs fails on it.',
  },
  'health-events/route.js': {
    status: 'settled',
    reason:
      'Deliberately open, and rate-limited instead (RATE_LIMIT in that route, lib/rateLimit.js). ' +
      'Two specific reasons, both in the route header: the devices that need it most have no account — ' +
      'a paired camfeed phone authenticates as a DEVICE and has no Supabase session — and the obvious ' +
      'alternative guard is worse than none, because health_events.show_id holds the ROOM NAME, and ' +
      'rehearsal rooms have no shows row at all, so "require show_id to resolve" would silently discard ' +
      'every Kit Check diagnostic. RLS on with zero policies; nothing surfaces this table to any user.',
  },
};

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry === 'route.js') out.push(full);
  }
  return out;
}

function wrap(text, indent = '      ') {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    if ((line + ' ' + w).trim().length > 84) { lines.push(line.trim()); line = w; }
    else line += ' ' + w;
  }
  if (line.trim()) lines.push(line.trim());
  return lines.map((l) => indent + l).join('\n');
}

const routes = walk(API_DIR).sort();
const failures = [];
const settled = [];
const pending = [];

for (const file of routes) {
  const key = relative(API_DIR, file);
  const src = readFileSync(file, 'utf8');

  if (AUTH_MARKERS.some((m) => src.includes(m))) continue;

  const entry = ALLOWLIST[key];
  if (entry) {
    if (!String(entry.reason || '').trim()) {
      failures.push({ key, why: 'on the allowlist with an empty reason' });
    } else if (entry.status === 'pending') {
      pending.push({ key, reason: entry.reason });
    } else if (entry.status === 'settled') {
      settled.push({ key, reason: entry.reason });
    } else {
      failures.push({ key, why: `allowlist status must be 'settled' or 'pending', got ${JSON.stringify(entry.status)}` });
    }
    continue;
  }

  const methods = [...src.matchAll(/export async function (GET|POST|PATCH|PUT|DELETE)/g)].map((m) => m[1]);
  failures.push({
    key,
    why: `no auth mechanism and not on the allowlist (exports ${methods.join(', ') || 'nothing'})`,
  });
}

console.log(`Scanned ${routes.length} API routes — ${routes.length - settled.length - pending.length - failures.length} carry an auth check.\n`);

for (const s of settled) {
  console.log(`  ○ ${s.key}  — public by design`);
  console.log(wrap(s.reason) + '\n');
}

if (pending.length) {
  console.log(`⚠  ${pending.length} OPEN SECURITY FINDING(S) — unauthenticated, known, not yet fixed:\n`);
  for (const p of pending) {
    console.log(`  ⚠ ${p.key}`);
    console.log(wrap(p.reason) + '\n');
  }
  console.log('   These do not fail the build. They are meant to stay noisy until fixed.');
  console.log('   Fixing one means DELETING its ALLOWLIST entry, not rewording it.\n');
}

if (failures.length) {
  console.error(`✖ ${failures.length} route(s) with no stated auth model:\n`);
  for (const f of failures) console.error(`  ${f.key}\n${wrap(f.why)}\n`);
  console.error('Add a check, or add an ALLOWLIST entry WITH A REASON and a status.');
  process.exit(1);
}

console.log(pending.length ? '✔ No UNDECLARED routes. See the warnings above.' : '✔ Every API route states an auth model.');
