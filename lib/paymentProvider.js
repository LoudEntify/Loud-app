// lib/paymentProvider.js
// ─────────────────────────────────────────────────────────────
// ONE INTERFACE, TWO IMPLEMENTATIONS.
//
// No Stripe keys were available when this was built, so the provider is
// behind an interface rather than called directly from the routes. That
// is not a hedge — it is the shape this should have anyway. Every route
// in app/api/wallet/* talks to `getPaymentProvider()` and knows nothing
// about Stripe, which means swapping providers, or running two during a
// migration, is a change to this file and nowhere else.
//
// The interface, in full:
//
//   key                     'stripe' | 'dev'
//   live                    true when real money can move
//   createCheckout(...)     → { providerRef, checkoutUrl, status }
//   verifySignature(...)    → { ok, reason }
//   parseEvent(rawBody)     → { eventId, eventType, intentId, amountMinor, currency }
//
// WHICH ONE YOU GET: Stripe if STRIPE_SECRET_KEY is set, otherwise the
// dev provider. There is no third state and no "half configured" — a
// deployment with a secret key but no webhook secret is refused loudly at
// the point of use rather than silently accepting payments it cannot
// confirm.
//
// ── NO CARD DATA, EVER ──
// Both implementations use a HOSTED checkout: the person leaves for the
// provider's own domain, enters their card there, and comes back. No
// route in this codebase accepts, forwards, logs or stores a card number,
// and there is no column anywhere that could hold one. That is the single
// most important property of this design and it is not negotiable for
// convenience.
//
// ── THE STRIPE IMPLEMENTATION USES NO SDK ──
// Deliberate. It is two REST calls and one HMAC, all of which are stable,
// documented and short — against a dependency that would have to be added
// tonight, audited, and kept current. If Stripe's API were complicated
// here this would be the wrong call; it is not.
// ─────────────────────────────────────────────────────────────

import 'server-only';
import { createHash, createHmac, timingSafeEqual } from 'crypto';

const STRIPE_API = 'https://api.stripe.com/v1';

// A signature older than this is refused even if it verifies. Without a
// timestamp check, a signed request captured once is valid forever —
// which is the entire replay attack. Five minutes is Stripe's own
// recommended tolerance.
const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

function safeEqualHex(a, b) {
  try {
    const bufA = Buffer.from(String(a), 'hex');
    const bufB = Buffer.from(String(b), 'hex');
    // Length must be compared first and NOT with timingSafeEqual, which
    // throws on a length mismatch. Leaking the length of a signature is
    // not a meaningful disclosure; throwing out of a verification path is
    // a bug.
    if (bufA.length !== bufB.length || bufA.length === 0) return false;
    return timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────
// STRIPE
// ─────────────────────────────────────────────────────────────
function stripeProvider({ secretKey, webhookSecret }) {
  return {
    key: 'stripe',
    live: true,
    // Named so the wallet UI can say "test mode" honestly rather than
    // letting someone believe a test purchase was real.
    testMode: secretKey.startsWith('sk_test_'),

    async createCheckout({ intentId, pack, user, origin }) {
      // Form-encoded, because that is what the Stripe API takes. The
      // bracket syntax is Stripe's own nesting convention.
      const form = new URLSearchParams();
      form.set('mode', 'payment');
      form.set('success_url', `${origin}/wallet?purchase=complete&intent=${intentId}`);
      form.set('cancel_url', `${origin}/wallet?purchase=cancelled`);
      // BOTH of these carry our intent id, on purpose. client_reference_id
      // is the documented field for exactly this and survives into the
      // completed-session event; the metadata copy is belt-and-braces for
      // event shapes that carry metadata but not the reference.
      form.set('client_reference_id', intentId);
      form.set('metadata[intent_id]', intentId);
      if (user?.email) form.set('customer_email', user.email);
      form.set('line_items[0][quantity]', '1');
      form.set('line_items[0][price_data][currency]', String(pack.currency).toLowerCase());
      form.set('line_items[0][price_data][unit_amount]', String(pack.amountMinor));
      form.set('line_items[0][price_data][product_data][name]', `${pack.tokens.toLocaleString()} Loudentify tokens`);

      const res = await fetch(`${STRIPE_API}/checkout/sessions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${secretKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          // Stripe's own idempotency, on top of ours. A retried create
          // returns the SAME session rather than a second one, so a
          // double-clicked buy button cannot produce two checkouts.
          'Idempotency-Key': `intent_${intentId}`,
        },
        body: form.toString(),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        return { error: body?.error?.message || 'The payment provider refused the request.' };
      }
      return { providerRef: body.id, checkoutUrl: body.url, status: 'pending' };
    },

    verifySignature({ rawBody, headers }) {
      if (!webhookSecret) {
        // Refused, not skipped. A deployment that can take payments but
        // cannot verify their confirmations is a deployment that will
        // credit anyone who can POST to it.
        return { ok: false, reason: 'STRIPE_WEBHOOK_SECRET is not configured' };
      }
      const header = headers.get('stripe-signature') || '';
      const parts = Object.fromEntries(
        header.split(',').map((kv) => {
          const i = kv.indexOf('=');
          return i === -1 ? [kv, ''] : [kv.slice(0, i).trim(), kv.slice(i + 1).trim()];
        })
      );
      const timestamp = parts.t;
      const signature = parts.v1;
      if (!timestamp || !signature) return { ok: false, reason: 'malformed signature header' };

      const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
      if (!Number.isFinite(age) || age > SIGNATURE_TOLERANCE_SECONDS) {
        return { ok: false, reason: 'signature timestamp outside tolerance' };
      }

      // The signed payload is `${timestamp}.${rawBody}` — which is why the
      // route must read the body as TEXT and hash the exact bytes. Parsing
      // to JSON and re-serialising changes whitespace and key order, and
      // the signature will never match again.
      const expected = createHmac('sha256', webhookSecret)
        .update(`${timestamp}.${rawBody}`, 'utf8')
        .digest('hex');

      return safeEqualHex(expected, signature)
        ? { ok: true }
        : { ok: false, reason: 'signature mismatch' };
    },

    parseEvent(rawBody) {
      const event = JSON.parse(rawBody);
      const object = event?.data?.object || {};
      return {
        eventId: event.id,
        eventType: event.type,
        intentId: object.client_reference_id || object.metadata?.intent_id || null,
        providerRef: object.id || null,
        amountMinor: typeof object.amount_total === 'number' ? object.amount_total : null,
        currency: object.currency ? String(object.currency).toUpperCase() : null,
        raw: event,
      };
    },
  };
}

// ─────────────────────────────────────────────────────────────
// DEV — a real provider shape with no money in it
// ─────────────────────────────────────────────────────────────
//
// This is NOT a mock that returns success. It mints a reference, sends
// the person to a checkout page, and emits a genuinely HMAC-SIGNED event
// that goes through the identical verification, idempotency and ledger
// path the real one does. The only thing it does not do is take money.
//
// That distinction is the whole value: on the morning Stripe keys arrive,
// what gets swapped is which signature is checked — not whether events
// are verified, not whether replays are caught, not whether the ledger
// write is idempotent. All of that has already been exercised.
function devProvider({ webhookSecret }) {
  return {
    key: 'dev',
    live: false,
    testMode: true,

    async createCheckout({ intentId, pack, origin }) {
      // Deterministic from the intent id: retrying a create cannot
      // produce a second reference, which is the same property Stripe's
      // Idempotency-Key buys above.
      const providerRef = `dev_${createHash('sha256').update(String(intentId)).digest('hex').slice(0, 24)}`;
      return {
        providerRef,
        checkoutUrl: `${origin}/wallet/checkout?intent=${encodeURIComponent(intentId)}&ref=${encodeURIComponent(providerRef)}&pack=${encodeURIComponent(pack.key)}`,
        status: 'pending',
      };
    },

    verifySignature({ rawBody, headers }) {
      const header = headers.get('x-loudentify-signature') || '';
      const parts = Object.fromEntries(
        header.split(',').map((kv) => {
          const i = kv.indexOf('=');
          return i === -1 ? [kv, ''] : [kv.slice(0, i).trim(), kv.slice(i + 1).trim()];
        })
      );
      const timestamp = parts.t;
      const signature = parts.v1;
      if (!timestamp || !signature) return { ok: false, reason: 'malformed signature header' };

      const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
      if (!Number.isFinite(age) || age > SIGNATURE_TOLERANCE_SECONDS) {
        return { ok: false, reason: 'signature timestamp outside tolerance' };
      }

      const expected = createHmac('sha256', webhookSecret)
        .update(`${timestamp}.${rawBody}`, 'utf8')
        .digest('hex');
      return safeEqualHex(expected, signature)
        ? { ok: true }
        : { ok: false, reason: 'signature mismatch' };
    },

    /** Used only by the dev harness, to produce an event this will accept. */
    sign(rawBody) {
      const t = Math.floor(Date.now() / 1000);
      const v1 = createHmac('sha256', webhookSecret).update(`${t}.${rawBody}`, 'utf8').digest('hex');
      return `t=${t},v1=${v1}`;
    },

    parseEvent(rawBody) {
      const event = JSON.parse(rawBody);
      const object = event?.data?.object || {};
      return {
        eventId: event.id,
        eventType: event.type,
        intentId: object.client_reference_id || object.metadata?.intent_id || null,
        providerRef: object.id || null,
        amountMinor: typeof object.amount_total === 'number' ? object.amount_total : null,
        currency: object.currency ? String(object.currency).toUpperCase() : null,
        raw: event,
      };
    },
  };
}

/**
 * The dev provider's signing secret.
 *
 * Uses PAYMENTS_WEBHOOK_SECRET when set. When it is not — which is the
 * normal case, since this is meant to work with zero new configuration —
 * it DERIVES one from the service-role key via HMAC under a fixed label.
 *
 * That derivation is a deliberate, standard construction (the same shape
 * as HKDF's expand step), not secret reuse: the output cannot be reversed
 * to the input, so the derived value is a per-deployment secret that
 * leaks nothing about the key it came from. It is used for the DEV
 * PROVIDER ONLY. The Stripe path never derives anything — it demands a
 * real STRIPE_WEBHOOK_SECRET and refuses to verify without one.
 */
function devSecret() {
  const explicit = process.env.PAYMENTS_WEBHOOK_SECRET;
  if (explicit) return explicit;
  const root = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!root) return null;
  return createHmac('sha256', root).update('loudentify:dev-payments-webhook:v1').digest('hex');
}

let cached = null;

export function getPaymentProvider() {
  if (cached) return cached;
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (secretKey) {
    cached = stripeProvider({ secretKey, webhookSecret: process.env.STRIPE_WEBHOOK_SECRET });
  } else {
    const secret = devSecret();
    cached = secret ? devProvider({ webhookSecret: secret }) : null;
  }
  return cached;
}

/**
 * Is the dev harness allowed to run here?
 *
 * Production is excluded by the platform's own environment marker, not by
 * a flag we set — a flag can be forgotten in the wrong direction. A
 * harness that can mint signed payment events must not exist in
 * production even for a minute.
 */
export function devHarnessAllowed() {
  const provider = getPaymentProvider();
  return !!provider && provider.key === 'dev' && process.env.VERCEL_ENV !== 'production';
}
