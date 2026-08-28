import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin';
import { verifyArtistAuth } from '../../../../lib/verifyArtistAuth';
import { appendLedger, ledgerRow, readBalance } from '../../../../lib/ledger';
import { CURRENCY, MIN_CASHOUT_TOKENS, payoutMinorFor } from '../../../../lib/tokens';

// CASH OUT — the only door out of the economy, and it is a REQUEST.
//
// THE HARD RULES, all enforced here and none of them client-side:
//
//   1. ARTISTS ONLY. `verifyArtistAuth`, not `verifySession`. Fans buy
//      and spend; they never cash out. This is what makes the economy
//      one-way, and it is the difference between a token and a currency.
//
//   2. KYC-VERIFIED ARTISTS ONLY. `profiles.kyc_status` must be
//      'verified', read HERE through the service-role client. It is never
//      taken from the request, and never trusted from the browser — which
//      matters more than usual because `profiles_update_own` currently
//      lets an account write any column on its own row, kyc_status
//      included (see docs/overnight2_02_profiles.sql). The client-side
//      value is untrusted by construction; this read is what makes the
//      gate real.
//
//   3. NOTHING MOVES MONEY. This records that an artist asked. There is
//      no payout rail wired up, and an "approve" is a human action taken
//      against the row.
//
//   4. INTEGER MINOR UNITS for the estimate, at the rate in force now.
//      Named an estimate because the real figure is whatever the rail
//      settles at after fees, on the day.
//
// ── THE TOKENS ARE HELD AT REQUEST TIME ──
// A 'cashout_request' debit is written immediately, so the same tokens
// cannot be requested twice or spent while a request is open. If the
// request is later rejected, the release is a 'cashout_reversed' CREDIT —
// a new row, never an edit, because the ledger is append-only and the
// history of a rejection is worth keeping.
//
// ── THE KYC INTEGRATION ITSELF IS STUBBED ──
// There is no identity provider connected. What exists is the gate, the
// request flow, the ledger hold and the state machine a real provider
// will drive. GET /api/wallet/cashout reports the artist's current status
// so the UI can explain rather than just refuse. Documented in
// docs/MORNING_BRIEF.md rather than left to be discovered.

function notMigrated(error) {
  return /does not exist|schema cache/i.test(error?.message || '');
}

/** What the wallet page needs to render this section honestly. */
export async function GET(request) {
  const auth = await verifyArtistAuth(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const admin = getSupabaseAdmin();
  const { balance, complete } = await readBalance(admin, auth.user.id);

  const { data: open, error: openErr } = await admin
    .from('cashout_requests')
    .select('id, amount_tokens, amount_minor_estimate, currency, status, created_at')
    .eq('artist_id', auth.user.id)
    .order('created_at', { ascending: false })
    .limit(10);

  return NextResponse.json({
    kycStatus: auth.profile?.kyc_status || 'none',
    balance,
    balanceComplete: complete,
    minimumTokens: MIN_CASHOUT_TOKENS,
    currency: CURRENCY,
    estimateMinor: payoutMinorFor(balance),
    requests: openErr ? [] : (open || []),
    available: !openErr,
    reason: openErr ? (notMigrated(openErr) ? 'not_yet_migrated' : 'read_failed') : null,
  });
}

export async function POST(request) {
  try {
    // RULE 1: artists only.
    const auth = await verifyArtistAuth(request);
    if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
    if (auth.profile?.deactivated_at) {
      return NextResponse.json({ error: 'This account is closed.' }, { status: 403 });
    }

    // RULE 2: the gate. Server-read, never client-supplied.
    const kycStatus = auth.profile?.kyc_status || 'none';
    if (kycStatus !== 'verified') {
      return NextResponse.json(
        {
          error:
            kycStatus === 'pending'
              ? 'Your identity check is still being reviewed. You can request a cash-out once it is complete.'
              : kycStatus === 'rejected'
                ? 'Your identity check was not accepted. Contact support before requesting a cash-out.'
                : 'Cash-outs need an identity check first. Start one from your wallet.',
          kycStatus,
        },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const requested = Math.trunc(Number(body.tokens));
    if (!Number.isFinite(requested) || requested <= 0) {
      return NextResponse.json({ error: 'Enter how many tokens to cash out.' }, { status: 400 });
    }
    if (requested < MIN_CASHOUT_TOKENS) {
      return NextResponse.json(
        { error: `The minimum cash-out is ${MIN_CASHOUT_TOKENS.toLocaleString()} tokens.` },
        { status: 400 }
      );
    }

    const admin = getSupabaseAdmin();

    const { balance, complete, error: balErr } = await readBalance(admin, auth.user.id);
    if (balErr) {
      return NextResponse.json(
        { error: notMigrated(balErr) ? 'Cash-outs need a pending database update.' : 'Could not read your balance.' },
        { status: notMigrated(balErr) ? 503 : 500 }
      );
    }
    if (!complete) {
      return NextResponse.json({ error: 'Could not confirm your balance. Nothing has been requested.' }, { status: 503 });
    }
    if (requested > balance) {
      return NextResponse.json({ error: 'That is more than your balance.', balance }, { status: 400 });
    }

    // One open request at a time. Not a technical limit — a person with
    // three overlapping requests against one balance is a reconciliation
    // problem for whoever approves them.
    const { data: existing } = await admin
      .from('cashout_requests')
      .select('id')
      .eq('artist_id', auth.user.id)
      .in('status', ['requested', 'approved'])
      .limit(1);
    if ((existing || []).length > 0) {
      return NextResponse.json({ error: 'You already have a cash-out request open.' }, { status: 409 });
    }

    const estimateMinor = payoutMinorFor(requested);

    const { data: created, error: reqErr } = await admin
      .from('cashout_requests')
      .insert({
        artist_id: auth.user.id,
        amount_tokens: requested,
        amount_minor_estimate: estimateMinor,
        currency: CURRENCY,
        status: 'requested',
        // The compliance fact, frozen at the moment of the decision.
        // profiles.kyc_status is current state and will change; this is
        // what the decision was made on.
        kyc_status_at_request: kycStatus,
        note: body.note ? String(body.note).slice(0, 1000) : null,
      })
      .select()
      .single();

    if (reqErr) {
      console.error('[wallet/cashout] insert failed:', reqErr);
      return NextResponse.json(
        { error: notMigrated(reqErr) ? 'Cash-outs need a pending database update.' : 'Could not record your request.' },
        { status: notMigrated(reqErr) ? 503 : 500 }
      );
    }

    // Hold the tokens. Written AFTER the request row so the debit always
    // has a request to point at — a hold with no request behind it is an
    // unexplained deduction, which is the worst kind.
    const { error: ledgerErr } = await appendLedger(admin, [
      ledgerRow({
        userId: auth.user.id,
        amountTokens: -requested,
        kind: 'cashout_request',
        description: `Cash-out requested (${requested.toLocaleString()} tokens)`,
        ref: created.id,
        idempotencyKey: `cashout:${created.id}`,
        amountMinor: estimateMinor,
        currency: CURRENCY,
        metadata: { cashout_request_id: created.id, kyc_status_at_request: kycStatus },
      }),
    ]);

    if (ledgerErr) {
      // The hold failed, so the request must not stand — otherwise the
      // same tokens could be requested again or spent while this one is
      // open. Cancelled rather than deleted: the attempt happened, and
      // the record of it is worth more than a tidy table.
      await admin
        .from('cashout_requests')
        .update({ status: 'cancelled', note: 'Automatically cancelled — the token hold could not be written.', decided_at: new Date().toISOString() })
        .eq('id', created.id);
      console.error('[wallet/cashout] hold failed:', ledgerErr);
      return NextResponse.json({ error: 'Could not hold those tokens. Nothing has been requested.' }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      request: {
        id: created.id,
        amountTokens: requested,
        estimateMinor,
        currency: CURRENCY,
        status: 'requested',
      },
      balance: balance - requested,
    });
  } catch (err) {
    console.error('[wallet/cashout] failed:', err);
    return NextResponse.json({ error: 'Could not record your request.' }, { status: 500 });
  }
}
