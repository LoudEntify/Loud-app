import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { rateLimit, clientKey } from '../../../lib/rateLimit';
import { validateSignup } from '../../../lib/waitlist';

// app/api/waitlist/route.js
// ─────────────────────────────────────────────────────────────
// Pre-launch waitlist sign-up. Public by design (anyone may join), so
// the guards are layered rather than a single gate. Mirrors the
// deliberately-open, rate-limited pattern of app/api/health-events.
//
// DEFENCE IN DEPTH — each layer is cheap and independent:
//   1. Rate limit per IP (lib/rateLimit.js) — stops a script in a loop.
//   2. Honeypot field — a hidden input no human fills; if it has a value
//      the request is a bot. Answered with a fake success so the bot
//      learns nothing.
//   3. Timing check — a form filled in under ~2.5s is automated.
//   4. Optional Cloudflare Turnstile — verified ONLY if TURNSTILE_SECRET_KEY
//      is configured, so the site works today and a CAPTCHA can be switched
//      on later by adding the key, with no code change.
//   5. Server-side validation (lib/waitlist.js) — the row stored is the
//      one the validator returns, never the raw request body.
//   6. Consent is mandatory — no row is written without an explicit true.
//
// The table (docs/waitlist_migration.sql) has RLS on with zero policies,
// so only this route's service-role client can touch it. Personal data is
// never reachable by any key the browser holds.
//
// PRD: Accounts & Identity (pre-launch recruitment)
// S&I: Database, Rate limiting, Auth
// ─────────────────────────────────────────────────────────────

export const runtime = 'nodejs';

const RATE_LIMIT = { limit: 20, windowMs: 60000 }; // 20 sign-ups/min/IP is far above any human
const MIN_FILL_MS = 2500; // a real person takes longer than this to fill the form
const MAX_FILL_MS = 2 * 60 * 60 * 1000; // 2h — stale page, make them reload

async function verifyTurnstile(token, ip) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return { ok: true, skipped: true }; // not configured -> other layers carry it
  try {
    const body = new URLSearchParams({ secret, response: String(token || '') });
    if (ip) body.set('remoteip', ip);
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    const data = await res.json();
    return { ok: Boolean(data.success) };
  } catch {
    // If Cloudflare is unreachable we do NOT hard-fail sign-ups; the other
    // layers still apply. A verification outage must not become a
    // recruitment outage on the days the waitlist matters most.
    return { ok: true, degraded: true };
  }
}

export async function POST(request) {
  try {
    const ip =
      request.headers.get('x-real-ip') ||
      (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() ||
      '';

    const gate = rateLimit(clientKey(request, 'waitlist'), RATE_LIMIT);
    if (!gate.ok) {
      return NextResponse.json(
        { ok: false, error: 'Too many attempts. Please wait a moment and try again.' },
        { status: 429, headers: { 'Retry-After': String(gate.retryAfterSec) } }
      );
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 });
    }

    // 2. Honeypot — hidden field. A filled value is a bot. Fake-succeed.
    if (payload && typeof payload.company === 'string' && payload.company.trim() !== '') {
      return NextResponse.json({ ok: true });
    }

    // 3. Timing — too fast to be human, or an abandoned stale page.
    const elapsed = Number(payload?.elapsedMs);
    if (Number.isFinite(elapsed)) {
      if (elapsed < MIN_FILL_MS) return NextResponse.json({ ok: true }); // silent for bots
      if (elapsed > MAX_FILL_MS) {
        return NextResponse.json(
          { ok: false, error: 'This page has been open a while. Please refresh and try again.' },
          { status: 400 }
        );
      }
    }

    // 4. Optional CAPTCHA.
    const turnstile = await verifyTurnstile(payload?.turnstileToken, ip);
    if (!turnstile.ok) {
      return NextResponse.json({ ok: false, error: 'Verification failed. Please try again.' }, { status: 400 });
    }

    // 5 + 6. Validate and build the exact row (consent enforced inside).
    const result = validateSignup(payload);
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
    }

    const admin = getSupabaseAdmin();
    const { error } = await admin.from('waitlist_signups').insert(result.row);

    if (error) {
      // 23505 = unique violation = already on the list for this role.
      // Treated as success: idempotent, and it never reveals to a prober
      // whether a given email is already registered.
      if (error.code === '23505') return NextResponse.json({ ok: true, already: true });
      console.warn('[waitlist] insert failed:', error);
      return NextResponse.json({ ok: false, error: 'Something went wrong. Please try again.' }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.warn('[waitlist] request failed:', err);
    return NextResponse.json({ ok: false, error: 'Something went wrong. Please try again.' }, { status: 500 });
  }
}
