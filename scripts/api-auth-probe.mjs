#!/usr/bin/env node
/* eslint-disable no-console */

// scripts/api-auth-probe.mjs
// ─────────────────────────────────────────────────────────────
// Asks the deployed API, with no credentials, for things it must refuse.
//
//   set -a; . ./smoke.env; set +a
//   node scripts/api-auth-probe.mjs
//
// WHY A SEPARATE CHECK FROM route-auth-check.mjs
// ──────────────────────────────────────────────
// That one greps source and asks "does this route mention an auth
// mechanism". This one asks the RUNNING deployment "will you give a
// stranger a capability", and takes its answer.
//
// The distinction is not academic. The 2026-08-28 CRITICAL was a route
// that returned HTTP 200 with a perfectly well-formed body — the hole was
// three fields deep INSIDE that body:
//
//     { "video": { "canPublish": true, "canPublishSources": ["camera"] } }
//
// A status-code probe calls that green. So the central assertion here is
// not a status code: it DECODES the minted LiveKit token and inspects the
// grant. A token route may hand a stranger a subscribe; it may never hand
// one a publish.
//
// WHAT IT DELIBERATELY DOES NOT DO
// ────────────────────────────────
// No writes, no real room names, no probing another user's resources. It
// asks for capabilities against obviously-fake identifiers, so a run
// leaves nothing behind and touches nobody's data. That limits it — it
// cannot detect an authorization bug that only shows up against a real
// row, like the cue-sheets IDOR from the same round — and that limit is
// stated in docs/SECURITY_AUDIT_2026-08-28.md rather than left to be
// discovered later by someone trusting a green run.
// ─────────────────────────────────────────────────────────────

const BASE = (process.env.SMOKE_URL || '').replace(/\/+$/, '');
const BYPASS = process.env.VERCEL_AUTOMATION_BYPASS || '';

if (!BASE) {
  console.error('SMOKE_URL is not set. See docs/SMOKE_TEST.md — the probe needs a deployment to ask.');
  process.exit(2);
}

const headers = BYPASS ? { 'x-vercel-protection-bypass': BYPASS } : {};
const results = [];

function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? '✔' : '✖'} ${name}`);
  if (detail) console.log(`    ${detail}`);
}

/** The grant inside a LiveKit access token, or null if there isn't one. */
function grantOf(token) {
  try {
    return JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString()).video || null;
  } catch {
    return null;
  }
}

async function get(path) {
  const res = await fetch(`${BASE}${path}`, { headers });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text };
}

async function post(path, body, extraHeaders = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { ...headers, ...extraHeaders, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text };
}

console.log(`Probing ${BASE} with no credentials.\n`);
console.log('── The token route may never hand a stranger a publish ──\n');

// The CRITICAL, and every shape of it that has ever existed here.
const TOKEN_PROBES = [
  ['plain viewer',        '/api/token?room=probe-room&identity=probe'],
  ['camfeed=a',           '/api/token?room=probe-room&identity=probe&camfeed=a'],
  ['camfeed=b',           '/api/token?room=probe-room&identity=probe&camfeed=b'],
  ['contestant=a',        '/api/token?room=probe-room&identity=probe&contestant=a'],
  ['contestant=b',        '/api/token?room=probe-room&identity=probe&contestant=b'],
];

for (const [label, path] of TOKEN_PROBES) {
  const { status, json } = await get(path);
  if (status !== 200 || !json?.token) {
    record(`token: ${label} — refused outright`, true, `HTTP ${status}`);
    continue;
  }
  const grant = grantOf(json.token);
  if (!grant) {
    record(`token: ${label}`, false, 'a token came back but its grant could not be decoded — inspect by hand');
    continue;
  }
  const publishes = grant.canPublish === true || (grant.canPublishSources || []).length > 0;
  record(
    `token: ${label} — subscribe only`,
    !publishes,
    publishes
      ? `PUBLISH GRANTED TO AN UNAUTHENTICATED CALLER: ${JSON.stringify(grant)}`
      : `canPublish:${grant.canPublish === true} sources:${JSON.stringify(grant.canPublishSources || [])}`
  );
}

console.log('\n── Owner-only routes must refuse no bearer, and refuse a forged one ──\n');

const FAKE_BEARER = { authorization: 'Bearer not.a.real.token' };
const FAKE_UUID = '00000000-0000-0000-0000-000000000000';

// Probes against ids that cannot exist. A correct route answers 401 (no
// session) long before it ever looks an id up — so a 404 here would
// itself be a finding: it would mean the route queried the database for
// an unauthenticated stranger before deciding whether to talk to them.
const OWNER_ONLY = [
  { method: 'GET',  path: `/api/broll/url?id=${FAKE_UUID}` },
  { method: 'GET',  path: '/api/cue-sheets?all=1' },
  { method: 'GET',  path: `/api/cue-sheets?track_hash=${'a'.repeat(64)}&artist_email=probe@example.com` },
  { method: 'GET',  path: '/api/wallet/cashout' },
  { method: 'POST', path: '/api/account/export',   body: {} },
  { method: 'POST', path: '/api/account/close',    body: {} },
  { method: 'POST', path: '/api/wallet/spend',     body: { tokens: 1 } },
  { method: 'POST', path: '/api/wallet/checkout',  body: { tokens: 1 } },
  { method: 'POST', path: '/api/wallet/cashout',   body: { tokens: 1 } },
  { method: 'POST', path: '/api/broll/register',   body: {} },
  { method: 'POST', path: '/api/broll/upload-url', body: {} },
  { method: 'POST', path: '/api/egress/verify',    body: { showId: FAKE_UUID } },
  { method: 'POST', path: '/api/recordings/sync',  body: {} },
  // Closed in the HIGH round. egress/stop is the one with teeth: a
  // stopped recording is a performance that cannot be re-recorded, and
  // this used to execute the LiveKit call for anyone who knew a room
  // name — which every viewer of a public show link does.
  { method: 'POST', path: '/api/egress/start',     body: { room: 'probe-room-xyz' } },
  { method: 'POST', path: '/api/egress/stop',      body: { room: 'probe-room-xyz' } },
  { method: 'POST', path: '/api/participants',     body: { show_id: FAKE_UUID, email: 'probe@example.com' } },
];

function shortLabel({ method, path }) {
  return `${method.padEnd(4)} ${path.split('?')[0]}${path.includes('?') ? '?…' : ''}`;
}

async function callAs({ method, path, body }, auth) {
  const h = { ...headers, ...auth };
  if (method === 'GET') return (await fetch(`${BASE}${path}`, { headers: h })).status;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...h, 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  return res.status;
}

for (const probe of OWNER_ONLY) {
  const status = await callAs(probe, {});
  record(`${shortLabel(probe)} — no bearer`, status === 401, `HTTP ${status}`);
}

console.log('');
for (const probe of OWNER_ONLY) {
  const status = await callAs(probe, FAKE_BEARER);
  record(`${shortLabel(probe)} — forged bearer`, status === 401, `HTTP ${status}`);
}

console.log('\n── The webhook must not accept an unsigned payload ──\n');
{
  const { status } = await post('/api/wallet/webhook', { type: 'probe.unsigned', id: 'probe' });
  record('POST /api/wallet/webhook — unsigned rejected', status !== 200, `HTTP ${status}`);
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed.`);
if (failed.length) {
  console.error(`\n✖ ${failed.length} FAILED — an unauthenticated caller is being given something:\n`);
  for (const f of failed) console.error(`  ${f.name}\n    ${f.detail}`);
  process.exit(1);
}
console.log('✔ No capability handed to an unauthenticated caller.');
