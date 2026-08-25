import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin';
import { getPaymentProvider } from '../../../../lib/paymentProvider';
import { appendLedger, ledgerRow } from '../../../../lib/ledger';

// THE FINANCE WEBHOOK. Step two of two.
//
// This is the only place in the product where a token balance goes up
// because of money, so it is written to be boring and paranoid in equal
// measure.
//
// AUTH MODEL — there is no session here, and there cannot be. The caller
// is a payment provider's server, which has no account. What replaces
// authentication:
//
//   1. SIGNATURE FIRST, BEFORE ANY WRITE THAT MATTERS. The raw body is
//      HMAC-verified against the provider's webhook secret. An event that
//      fails is recorded (so a rotated secret and an active probe are
//      both visible) and then refused. No ledger row, no intent update,
//      nothing.
//   2. TIMESTAMP TOLERANCE. A signature with no freshness check is valid
//      forever, which is the entire replay attack. Handled inside the
//      provider's verifySignature.
//   3. IDEMPOTENCY, TWICE. `webhook_events (provider, event_id)` stops
//      the same EVENT being processed twice.
//      `wallet_transactions.idempotency_key` stops the same CREDIT being
//      written twice even if something else contrives to call this path
//      again. Not redundant: the failure mode is "we gave someone free
//      money" and it is discovered by an accountant.
//   4. THE EVENT NEVER DECIDES THE AMOUNT. It names an intent; the intent
//      says what was bought. A provider event that claimed 10,000,000
//      tokens would credit exactly what the intent row says and nothing
//      more.
//
// ── THE RAW BODY IS READ AS TEXT AND HASHED AS-IS ──
// Not parsed and re-serialised. `JSON.parse` then `JSON.stringify`
// changes whitespace and key order, and the signature will never match
// again. This is the single most common way a webhook integration is
// broken, so it is stated where the code does it.
//
// Every outcome writes a health_events row (via the same table the live
// show uses), so "did the webhook fire, and what did it decide" is one
// query rather than a log search.

async function logHealth(admin, eventType, detail) {
  try {
    await admin.from('health_events').insert({
      // health_events.show_id is a text column and is the only grouping
      // key it has. 'finance' namespaces these away from show telemetry
      // so neither pollutes the other's queries.
      show_id: 'finance',
      participant_identity: null,
      role: 'webhook',
      event_type: eventType,
      detail: detail || {},
      client_ts: new Date().toISOString(),
    });
  } catch {
    // Diagnostics must never be able to fail a payment.
  }
}

export async function POST(request) {
  const admin = getSupabaseAdmin();
  const provider = getPaymentProvider();

  if (!provider) {
    await logHealth(admin, 'finance_webhook_no_provider', {});
    return NextResponse.json({ error: 'No payment provider configured' }, { status: 503 });
  }

  // TEXT, not json(). See the note above — this is the exact byte string
  // the signature covers.
  let rawBody;
  try {
    rawBody = await request.text();
  } catch {
    return NextResponse.json({ error: 'Unreadable body' }, { status: 400 });
  }

  // ── 1. Verify BEFORE anything else ────────────────────────
  const verdict = provider.verifySignature({ rawBody, headers: request.headers });

  let parsed = null;
  try {
    parsed = provider.parseEvent(rawBody);
  } catch {
    parsed = null;
  }

  if (!verdict.ok) {
    // Recorded, then refused. Keeping rejected events is how you find out
    // you are being probed, and how you diagnose a rotated secret that is
    // silently rejecting real traffic.
    try {
      await admin.from('webhook_events').upsert(
        {
          provider: provider.key,
          event_id: parsed?.eventId || `unverified-${Date.now()}`,
          event_type: parsed?.eventType || null,
          signature_verified: false,
          status: 'rejected',
          error: verdict.reason || 'signature verification failed',
          payload: parsed?.raw || {},
        },
        { onConflict: 'provider,event_id', ignoreDuplicates: true }
      );
    } catch {
      // If we cannot even record it, still refuse.
    }
    await logHealth(admin, 'finance_webhook_rejected', { reason: verdict.reason });
    // 400, not 401: 401 invites a retry with credentials, and there are
    // none to retry with. A provider treats 4xx as "do not redeliver",
    // which is correct for a signature that will never start matching.
    return NextResponse.json({ error: 'Signature verification failed' }, { status: 400 });
  }

  if (!parsed?.eventId) {
    await logHealth(admin, 'finance_webhook_unparseable', {});
    return NextResponse.json({ error: 'Event could not be parsed' }, { status: 400 });
  }

  // ── 2. Idempotency at the EVENT level ─────────────────────
  // The insert IS the lock. Two concurrent redeliveries race to insert
  // the same (provider, event_id); the unique index lets exactly one
  // win, and the loser sees zero rows returned and stops. This is why
  // it is an insert-and-check rather than a select-then-insert, which
  // has a window between the two.
  const { data: inserted, error: insertErr } = await admin
    .from('webhook_events')
    .upsert(
      {
        provider: provider.key,
        event_id: parsed.eventId,
        event_type: parsed.eventType,
        signature_verified: true,
        status: 'received',
        payload: parsed.raw || {},
      },
      { onConflict: 'provider,event_id', ignoreDuplicates: true }
    )
    .select();

  if (insertErr) {
    console.error('[wallet/webhook] event insert failed:', insertErr);
    await logHealth(admin, 'finance_webhook_store_failed', { error: insertErr.message });
    // 500 so the provider redelivers. We could not record this event, so
    // we must not act on it — but we do want to see it again.
    return NextResponse.json({ error: 'Could not record event' }, { status: 500 });
  }

  if ((inserted || []).length === 0) {
    // Already seen. 200, because it IS handled — a non-2xx here would
    // make the provider redeliver forever.
    await logHealth(admin, 'finance_webhook_duplicate', { eventId: parsed.eventId });
    return NextResponse.json({ ok: true, duplicate: true });
  }

  const eventRowId = inserted[0].id;

  async function finish(status, error, health, healthDetail) {
    await admin
      .from('webhook_events')
      .update({ status, error: error || null, processed_at: new Date().toISOString() })
      .eq('id', eventRowId);
    await logHealth(admin, health, healthDetail || {});
  }

  try {
    // ── 3. Only the events we actually handle ───────────────
    const HANDLED = ['checkout.session.completed', 'checkout.completed'];
    if (!HANDLED.includes(parsed.eventType)) {
      await finish('ignored', null, 'finance_webhook_ignored', { eventType: parsed.eventType });
      return NextResponse.json({ ok: true, ignored: true });
    }

    if (!parsed.intentId) {
      await finish('failed', 'no intent id on event', 'finance_webhook_no_intent', { eventId: parsed.eventId });
      return NextResponse.json({ ok: true, ignored: true });
    }

    const { data: intent } = await admin
      .from('payment_intents')
      .select('*')
      .eq('id', parsed.intentId)
      .maybeSingle();

    if (!intent) {
      await finish('failed', 'unknown intent', 'finance_webhook_unknown_intent', { intentId: parsed.intentId });
      // 200: redelivering will not make an unknown intent known, and a
      // provider retrying forever on this is noise, not recovery.
      return NextResponse.json({ ok: true, ignored: true });
    }

    // ── 4. Sanity-check the amount, and refuse a mismatch ────
    // The intent decides what to credit. This comparison exists to catch
    // a genuine mismatch — a price list edited under an in-flight
    // checkout, or a misrouted event — not to derive the credit.
    if (parsed.amountMinor != null && Number(parsed.amountMinor) !== Number(intent.amount_minor)) {
      await finish('failed', `amount mismatch: event ${parsed.amountMinor} vs intent ${intent.amount_minor}`,
        'finance_webhook_amount_mismatch', { intentId: intent.id, event: parsed.amountMinor, expected: intent.amount_minor });
      return NextResponse.json({ ok: false, error: 'Amount mismatch' }, { status: 409 });
    }

    if (intent.status === 'paid') {
      await finish('ignored', 'intent already paid', 'finance_webhook_intent_already_paid', { intentId: intent.id });
      return NextResponse.json({ ok: true, duplicate: true });
    }

    // ── 5. Credit, idempotently ─────────────────────────────
    // Two rows, not one: the purchase and the bonus are separate ledger
    // entries so a person can see they were given something and an
    // accountant can separate revenue from promotion without unpicking a
    // sum. Both keyed off the intent id, so a second attempt writes
    // neither.
    const baseTokens = Number(intent.metadata?.base_tokens ?? intent.tokens) || 0;
    const bonusTokens = Number(intent.metadata?.bonus_tokens ?? 0) || 0;

    const rows = [
      ledgerRow({
        userId: intent.user_id,
        amountTokens: baseTokens,
        kind: 'purchase',
        description: `${baseTokens.toLocaleString()} tokens`,
        ref: intent.id,
        idempotencyKey: `purchase:${intent.id}`,
        amountMinor: intent.amount_minor,
        currency: intent.currency,
        metadata: { provider: provider.key, provider_ref: intent.provider_ref, event_id: parsed.eventId, pack: intent.pack_key },
      }),
    ];
    if (bonusTokens > 0) {
      rows.push(ledgerRow({
        userId: intent.user_id,
        amountTokens: bonusTokens,
        kind: 'purchase_bonus',
        description: `${bonusTokens.toLocaleString()} bonus tokens`,
        ref: intent.id,
        idempotencyKey: `purchase-bonus:${intent.id}`,
        metadata: { provider: provider.key, event_id: parsed.eventId, pack: intent.pack_key },
      }));
    }

    const { written, error: ledgerErr } = await appendLedger(admin, rows);
    if (ledgerErr) {
      await finish('failed', ledgerErr.message, 'finance_webhook_ledger_failed', { intentId: intent.id, error: ledgerErr.message });
      // 500 so the provider redelivers. The event row is already marked
      // failed; a redelivery collides on (provider, event_id) and returns
      // duplicate, so recovery here is manual and visible rather than
      // automatic and silent. That is the right trade for money: a stuck
      // credit is a support ticket, a double credit is a loss.
      return NextResponse.json({ error: 'Ledger write failed' }, { status: 500 });
    }

    await admin
      .from('payment_intents')
      .update({ status: 'paid', paid_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', intent.id);

    await finish('processed', null, 'finance_webhook_processed', {
      intentId: intent.id,
      userId: intent.user_id,
      tokens: baseTokens + bonusTokens,
      amountMinor: intent.amount_minor,
      rowsWritten: written.length,
    });

    return NextResponse.json({ ok: true, credited: baseTokens + bonusTokens });
  } catch (err) {
    console.error('[wallet/webhook] processing failed:', err);
    await finish('failed', String(err?.message || err), 'finance_webhook_exception', { error: String(err?.message || err) });
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 });
  }
}
