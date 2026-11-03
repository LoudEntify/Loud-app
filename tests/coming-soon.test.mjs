import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isExempt, gateIsUp, shouldGate, GATE_EXEMPT } from '../lib/siteGate.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// The production domain is closed to the public while the pilot is
// built, but not everything on it is a person browsing: the native
// app's backend, YouTube's OAuth callback, the compositor's template
// and a scanned pairing code all live here too.

test('the gate is off unless production says otherwise', () => {
  assert.equal(gateIsUp({}), false);
  assert.equal(gateIsUp({ SITE_MODE: '' }), false);
  assert.equal(gateIsUp({ SITE_MODE: 'open' }), false);
  assert.equal(gateIsUp({ SITE_MODE: 'coming_soon' }), true);
});

test('every way into the product is behind the gate', () => {
  for (const p of ['/', '/login', '/signup', '/discover', '/dashboard', '/artist/schedule', '/show/abc', '/u/koreybaba', '/wallet', '/settings', '/pricing', '/get-app', '/kit-check']) {
    assert.equal(isExempt(p), false, `${p} must be gated`);
  }
});

test('what is not a person browsing keeps working', () => {
  // The native app's production profile points at this domain, and so
  // does YouTube's OAuth callback: gating these locks every artist out
  // of their own account.
  assert.equal(isExempt('/api/artist/youtube/callback'), true);
  assert.equal(isExempt('/api/camfeed/pair'), true);
  // LiveKit's compositor renders the broadcast from this page. Gate it
  // and shows go out blank.
  assert.equal(isExempt('/egress'), true);
  // What a scanned pairing QR opens on a second phone.
  assert.equal(isExempt('/cam/pair'), true);
  assert.equal(isExempt('/cam'), true);
  // Google's consent screen links to the policy and app stores require
  // it to resolve. A policy that 404s while an app is live is a
  // compliance problem, not a closed shop.
  assert.equal(isExempt('/privacy'), true);
  assert.equal(isExempt('/legal/terms'), true);
  // And the page itself, or the rewrite would loop.
  assert.equal(isExempt('/coming-soon'), true);
});

test('an exemption cannot be reached by a lookalike path', () => {
  // /apifoo is not /api/…, and a gate a prefix can be talked out of is
  // not a gate.
  assert.equal(isExempt('/apifoo'), false);
  assert.equal(isExempt('/privacy-policy-leak'), false);
  assert.equal(isExempt('/camera-roll'), false);
  assert.equal(isExempt('/egressive'), false);
});

test('the page offers the mark, three words, and no way in', () => {
  const src = readFileSync(resolve(ROOT, 'app/coming-soon/page.js'), 'utf8');
  assert.match(src, /Coming soon/);
  assert.match(src, /<Logo/, 'the real mark, not the name in type');
  for (const way of ['href=', '<a ', 'Link', 'onClick', 'signup', 'login']) {
    assert.ok(!src.includes(way), `a page that says "coming soon" and then offers ${way} has not said it`);
  }
  assert.ok(!src.includes("'use client'"), 'nothing here needs a client bundle');
});

test('a gated path and an exempt one answer the one question the middleware asks', () => {
  assert.equal(shouldGate('/login', { SITE_MODE: 'coming_soon' }), true);
  assert.equal(shouldGate('/api/artist/youtube/callback', { SITE_MODE: 'coming_soon' }), false);
  assert.equal(shouldGate('/login', {}), false, 'with the gate down nothing is rewritten');
});

test('the gate is a rewrite, so shared links survive it', () => {
  const src = readFileSync(resolve(ROOT, 'middleware.js'), 'utf8');
  assert.match(src, /NextResponse\.rewrite/, 'a rewrite keeps the address bar');
  assert.ok(!/redirect\(/.test(src), 'a redirect would teach every shared link to point at /coming-soon');
  assert.match(src, /shouldGate/, 'and the decision comes from the module that can be tested on its own');
  assert.ok(GATE_EXEMPT.includes('/api'));
  const gate = readFileSync(resolve(ROOT, 'lib/siteGate.js'), 'utf8');
  assert.match(gate, /SITE_MODE/, 'an environment variable, so taking the gate down needs no deploy');
  assert.ok(!/^import .*next\//m.test(gate), 'and no Next import, so it runs in a plain script');
});
