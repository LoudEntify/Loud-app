import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin';
import { verifySession } from '../../../../lib/verifyArtistAuth';
import { appendLedger, ledgerRow, readBalance } from '../../../../lib/ledger';
import { spendActionByKey } from '../../../../lib/tokens';

// SPENDING — the debit side, wired now for features that land later.
//
// Reactions ship tonight (Phase 4b) and votes do not. Both are wired
// here anyway, and deliberately: the ledger, the balance check and the
// idempotency shape are the same for every spend, and building them once
// against two callers is how the second one arrives without a second
// implementation of "can this person afford it".
//
// AUTH MODEL: any signed-in account. The route reads no amount from the
// caller — the body names an ACTION ('reaction', 'vote') and the cost is
// looked up server-side from lib/tokens.js. A client that could send an
// amount could send a negative one, which in a signed-integer ledger is a
// credit.
//
// ── SPENDING IS ALLOWED TO FAIL SOFT AT THE CALL SITE ──
// A viewer tapping a reaction during a song must not have their tap
// swallowed by a wallet round trip, and must not see an error card over
// the performance because they ran out of tokens. So this route answers
// honestly — 402 for insufficient funds — and the UI decides what that
// means in context. Tonight, reactions animate regardless and the token
// simply is not charged; see components/ReactionLayer.jsx.
//
// ── THE BALANCE CHECK IS A CHECK, NOT A LOCK ──
// Two concurrent spends could each read a balance of 1 and each write a
// debit, leaving -1. Stated rather than hidden because it is a real
// property of this design:
//   * the exposure is bounded by the cost of one action (1 token, 10 for
//     a vote) per concurrent request, not by the balance;
//   * the ledger is append-only, so the overdraft is VISIBLE and
//     correctable with a compensating row rather than silently absorbed;
//   * the fix is a SQL function that checks and inserts in one statement,
//     which is a migration and a round of testing this build does not
//     have time to do properly.
// Named in docs/MORNING_BRIEF.md as known debt with a known fix, rather
// than left for someone to find in a reconciliation.

export async function POST(request) {
  try {
    const auth = await verifySession(request);
    if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
    if (auth.profile?.deactivated_at) {
      return NextResponse.json({ error: 'This account is closed.' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const action = spendActionByKey(body.action);
    if (!action) return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });

    // The caller supplies an idempotency key so a retried tap — a flaky
    // network, a double-fire — cannot double-charge. Namespaced by user
    // and action server-side so one caller's key can never collide with
    // another's.
    const clientKey = String(body.idempotencyKey || '').slice(0, 80);
    if (!clientKey) return NextResponse.json({ error: 'idempotencyKey is required.' }, { status: 400 });
    const idempotencyKey = `spend:${action.key}:${auth.user.id}:${clientKey}`;

    const admin = getSupabaseAdmin();

    const { balance, complete, error: balErr } = await readBalance(admin, auth.user.id);
    if (balErr) {
      const notMigrated = /does not exist|schema cache/i.test(balErr.message || '');
      return NextResponse.json(
        { error: notMigrated ? 'Token spending needs a pending database update.' : 'Could not read your balance.' },
        { status: notMigrated ? 503 : 500 }
      );
    }
    if (!complete) {
      // A balance we cannot compute is not a balance. Refusing is the only
      // safe answer — acting on a lower bound would let someone spend
      // money they do not have and would look like a bug in the ledger
      // rather than in this read.
      console.error('[wallet/spend] balance row ceiling hit for', auth.user.id);
      return NextResponse.json({ error: 'Could not confirm your balance. Nothing has been spent.' }, { status: 503 });
    }

    if (balance < action.tokens) {
      return NextResponse.json(
        { error: 'Not enough tokens.', balance, required: action.tokens },
        { status: 402 }
      );
    }

    const { written, error: ledgerErr } = await appendLedger(admin, [
      ledgerRow({
        userId: auth.user.id,
        // NEGATIVE. One signed column, never a separate debit flag that
        // can contradict the sign.
        amountTokens: -action.tokens,
        kind: action.kind,
        description: action.label,
        ref: body.ref ? String(body.ref).slice(0, 200) : null,
        idempotencyKey,
        metadata: {
          action: action.key,
          show_id: body.showId || null,
          // Kept because reaction and vote events are training data for
          // the auto-director later, and a spend row that knows what it
          // was for is worth more than one that does not.
          target: body.target || null,
        },
      }),
    ]);

    if (ledgerErr) {
      console.error('[wallet/spend] ledger write failed:', ledgerErr);
      return NextResponse.json({ error: 'Could not record that spend.' }, { status: 500 });
    }

    // Zero rows written means the key was already used — the tap already
    // counted. Success, not an error: that is exactly what idempotent
    // means, and reporting a failure would invite the client to retry.
    const charged = written.length > 0;
    return NextResponse.json({
      ok: true,
      charged,
      spent: charged ? action.tokens : 0,
      balance: charged ? balance - action.tokens : balance,
    });
  } catch (err) {
    console.error('[wallet/spend] failed:', err);
    return NextResponse.json({ error: 'Could not record that spend.' }, { status: 500 });
  }
}
