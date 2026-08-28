import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin';
import { verifySession } from '../../../../lib/verifyArtistAuth';
import { devHarnessAllowed, getPaymentProvider } from '../../../../lib/paymentProvider';
import { POST as webhookHandler } from '../webhook/route';

// THE DEV HARNESS — signed events, no money.
//
// This exists because a webhook you have never actually received is a
// webhook you have not built. Signature verification, replay rejection,
// idempotency and the ledger write are all code paths that look correct
// and are only ever proved by firing something at them.
//
// So this mints a genuinely HMAC-SIGNED event and sends it through the
// REAL handler — same verification, same idempotency, same ledger write.
// It does not skip a single step. The only thing it does not do is take
// money.
//
// WHAT IT CAN DO, deliberately, because these are the three things worth
// testing and two of them are failures:
//   * fire a valid completed-checkout event      → expect a credit
//   * REPLAY the same event id                   → expect no second credit
//   * fire a TAMPERED signature                  → expect a rejection and
//                                                  no ledger row at all
//
// ── HOW IT IS PREVENTED FROM EXISTING IN PRODUCTION ──
// Three independent gates, because a harness that can mint payment events
// must not be one forgotten flag away from being live:
//   1. `devHarnessAllowed()` requires VERCEL_ENV !== 'production'. That is
//      the platform's own marker, not a flag we set and could forget.
//   2. It requires the DEV provider to be the active one. The moment
//      STRIPE_SECRET_KEY is set, the provider is Stripe, this route has no
//      signing key it could use, and it refuses.
//   3. It requires a signed-in session AND that the intent being settled
//      belongs to that session. Even where it does run, it cannot credit
//      anyone but the caller.
//
// ── WHY IT CALLS THE HANDLER DIRECTLY AND NOT OVER HTTP ──
// A server-to-server fetch from a protected preview deployment to itself
// would be intercepted by deployment protection and never reach the
// route. Importing and invoking the handler is both more reliable and
// more honest: it is unambiguously the same code, not a similar request.

export async function POST(request) {
  if (!devHarnessAllowed()) {
    return NextResponse.json(
      { error: 'The payment test harness is not available on this deployment.' },
      { status: 404 }
    );
  }

  const auth = await verifySession(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const provider = getPaymentProvider();
  if (!provider?.sign) {
    return NextResponse.json({ error: 'The active payment provider cannot sign test events.' }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const admin = getSupabaseAdmin();

  const { data: intent } = await admin
    .from('payment_intents')
    .select('*')
    .eq('id', body.intentId)
    .maybeSingle();

  if (!intent) return NextResponse.json({ error: 'Unknown intent.' }, { status: 404 });
  // Gate 3. Even in a preview, this cannot credit somebody else.
  if (intent.user_id !== auth.user.id) {
    return NextResponse.json({ error: 'That purchase belongs to another account.' }, { status: 403 });
  }

  // A stable event id per intent, so REPLAY means "send the same event
  // again" rather than "send a new one that happens to look similar".
  // The idempotency test is worthless unless the id is genuinely the same.
  const eventId = body.eventId || `evt_dev_${intent.id}`;

  const event = {
    id: eventId,
    type: body.eventType || 'checkout.session.completed',
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: intent.provider_ref || `dev_ref_${intent.id}`,
        client_reference_id: intent.id,
        metadata: { intent_id: intent.id },
        // Taken from the intent so a valid test event is genuinely
        // consistent. `tamperAmount` deliberately breaks that, to prove
        // the handler's amount check refuses a mismatch rather than
        // trusting the event.
        amount_total: body.tamperAmount ? Number(intent.amount_minor) + 100 : Number(intent.amount_minor),
        currency: String(intent.currency || 'GBP').toLowerCase(),
      },
    },
  };

  const rawBody = JSON.stringify(event);
  const signature = body.tamperSignature
    // A syntactically valid header with a wrong v1. Tests the comparison,
    // not the parser — a malformed header would be rejected earlier and
    // would prove less.
    ? provider.sign(rawBody).replace(/v1=[0-9a-f]+/, `v1=${'0'.repeat(64)}`)
    : provider.sign(rawBody);

  const forwarded = new Request(new URL('/api/wallet/webhook', request.url), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-loudentify-signature': signature,
    },
    body: rawBody,
  });

  const res = await webhookHandler(forwarded);
  const result = await res.json().catch(() => ({}));

  return NextResponse.json({
    sent: { eventId, type: event.type, tamperSignature: !!body.tamperSignature, tamperAmount: !!body.tamperAmount },
    webhookStatus: res.status,
    webhookBody: result,
  });
}
