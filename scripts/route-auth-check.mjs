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
  'requireSession',     // lib/viewerAuth.js: bearer -> getUser, 401 without; closed accounts refused
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
  // ── Phase 5 website routes (2 Oct 2026) ──────────────────────
  'site/contact/route.js': {
    status: 'settled',
    reason:
      'The public contact form: nobody has an account before they write in. Rate-limited per ' +
      'client (5 per 10 minutes), fields validated (lib/site/contact.js), a honeypot field, and ' +
      'the row written with the service role into site_messages, which has RLS on and zero ' +
      'policies so nothing can be read back through the Data API. A bearer token, if present, ' +
      'only attaches the sender\'s user id for follow-up.',
  },
  // ── Phase 3 artist routes (2 Oct 2026) ───────────────────────
  'artist/youtube/callback/route.js': {
    status: 'settled',
    reason:
      'Google redirects the artist here after consent; there is no session header on a cross-site ' +
      'redirect. The caller is identified by the signed OAuth `state` (user id + HMAC with the token ' +
      'key, lib/youtube/oauth.js signState), which only /api/artist/youtube/connect (artist-auth) ' +
      'issues. The code is exchanged server-side; nothing token-shaped reaches the browser; the ' +
      'only outcome is a redirect back to onboarding.',
  },
  // ── Phase 2 viewer routes (2 Oct 2026) ───────────────────────
  'viewer/show/[id]/route.js': {
    status: 'settled',
    reason:
      'Public show page data: what any guest can see on the show screen (show, artist public ' +
      'profile, viewer count, the open prompt). Rate-limited. A bearer token, if present, only ' +
      'ADDS the caller\'s own vote/follow/reminder flags; it never widens what is returned about ' +
      'anyone else. Server-side shaping (lib/showPayload.js) is the control, not the screen.',
  },
  'viewer/feed/route.js': {
    status: 'settled',
    reason:
      'Discover for guests (PRD 90: watch first, sign up to stay). Public shows and public ' +
      'recordings only, via the public_profiles view; a token only personalises the order.',
  },
  'viewer/live/route.js': {
    status: 'settled',
    reason: 'The Live tab for guests: public shows only, rate-limited; a token only adds own follow/reminder flags.',
  },
  'viewer/search/route.js': {
    status: 'settled',
    reason: 'Search for guests (PRD 97): public_profiles and public shows only, rate-limited, capped result sizes, no history stored server-side.',
  },
  'viewer/metering/route.js': {
    status: 'settled',
    reason:
      'Viewer-hour metering from player events (PRD 144) must count guests. Pseudonymous device id ' +
      'only, rate-limited, write-only (RLS on, zero policies; no product surface reads it back).',
  },
  'events/route.js': {
    status: 'settled',
    reason:
      'Journey events (PRD 165) for guests and signed-in alike: pseudonymous, rate-limited, ' +
      'write-only, personal keys stripped on both sides.',
  },
  'viewer/signup/route.js': {
    status: 'settled',
    reason:
      'Nobody has a session before they sign up. Rate-limited per client (10 per 10 minutes). ' +
      'It creates exactly one account for the credentials given, refuses under-18s before any ' +
      'row exists, and writes consent and audit in the same request.',
  },
  'build-info/route.js': {
    status: 'settled',
    reason:
      'Public, read-only, and returns exactly one class of fact: which git commit this ' +
      'deployment was built from (sha, branch, commit message, VERCEL_ENV, deployment host). ' +
      'All of it is already visible to anyone who can see the Vercel deployment, it is the ' +
      "team's own repository, and there is no write path and no user data. It exists because a " +
      'device test against a branch alias is not a test of a known commit — the alias follows the ' +
      'newest build of the branch, so rebuilding an older commit silently moves it backwards. ' +
      'Requiring a session here would put the check behind the thing being checked.',
  },
  'show-comments/route.js': {
    status: 'settled',
    reason:
      'Deliberately open and rate-limited, the same posture as reactions/route.js which it is ' +
      'modelled on, and for the same reason: the audience has no account, so requiring one would ' +
      'make the stored chat log contain only signed-in users — a worse record and a misleading ' +
      'one. There is no GET, so a caller can add their own comments and never read anybody ' +
      "else's; show_comments has RLS on with zero policies and the live chat everyone reads comes " +
      'over the LiveKit data channel, never through this table. Honest cost: a determined caller ' +
      'can write comments nobody in the room saw — bounded by rate limit, batch cap and length ' +
      'cap, but not prevented — so the stored log is a record of what was said, not evidence that ' +
      'only those things were said.',
  },
  'show-prompts/list/route.js': {
    status: 'settled',
    reason:
      'Deliberately open and rate-limited, pairing with prompt-responses. A late joiner was not ' +
      'in the room when a prompt was broadcast, so the data channel can never reach them with ' +
      'it; this is the only way they can answer what they missed, and one that required signing ' +
      'in would simply not be used. ⚠️ It is a SEPARATE route from the sibling GET on purpose: ' +
      'that one returns RESULTS and is artist-only, because a visible tally changes the answers ' +
      'and prompt_responses is per-person opinion. This returns the QUESTION ONLY (id, kind, ' +
      'body, options, pushed_at) and does not touch prompt_responses at all. Adding a viewer ' +
      'mode to the artist route would have left those two behaviours one boolean apart in one ' +
      'function. Scoped by room name resolved server-side, not by a show id from the caller, ' +
      'and capped at 50 so it cannot become a bulk export.',
  },
  'prompt-responses/route.js': {
    status: 'settled',
    reason:
      'Deliberately open and rate-limited, same posture as viewer-session and health-events. ' +
      'The audience has no account, and requiring one would make the questionnaire measure ' +
      'signed-in users rather than the room. Note the ASYMMETRY with show-prompts, which is the ' +
      'design: ASKING a question puts text on every screen in a live broadcast and READING the ' +
      'results exposes what people said — both are artist-only. ANSWERING is anonymous and open. ' +
      'There is no GET here, so a caller can add their own answer and can never read anyone ' +
      "else's. Everything descriptive on the stored row (prompt_body, choice_label) is read from " +
      'the prompt in the database, never taken from the request, so a client cannot rewrite what ' +
      'question it answered. Honest cost: a scripted caller can stuff a vote; the unique index ' +
      'stops one person tapping four times, not a determined one, and the number should not be ' +
      'quoted as adversarial.',
  },
  'viewer-session/route.js': {
    status: 'settled',
    reason:
      'Deliberately open and rate-limited, same posture and same reasoning as ' +
      'health-events beside it. Counting the audience IS the point, and most of the pilot ' +
      'audience is not signed in — which is exactly why viewer_id carries the work; requiring a ' +
      'session would discard the majority of the measurement and leave a number that looks real ' +
      'and describes only signed-in users. There is no GET, so a caller can add a row or close ' +
      'one they can already name but cannot enumerate anything. viewer_sessions has RLS on with ' +
      'zero policies and no product surface reads it. The honest cost: the unique-viewer count ' +
      'is what clients reported, not an adversarial measurement, and should not be quoted as one.',
  },
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
