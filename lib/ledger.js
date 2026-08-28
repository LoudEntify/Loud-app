// lib/ledger.js
// ─────────────────────────────────────────────────────────────
// Every write to wallet_transactions goes through here.
//
// Not because the insert is complicated — it is one line — but because
// the RULES are, and a rule enforced in four places is a rule enforced in
// three places by next month:
//
//   * APPEND ONLY. Nothing here updates or deletes. The database refuses
//     to anyway (docs/overnight2_06_wallet_transactions.sql installs a
//     trigger that blocks it even for the service role), and this module
//     never tries — a correction is a compensating row.
//   * IDEMPOTENT BY KEY. Every write carries an idempotency key derived
//     from whatever caused it, and a repeat is a no-op rather than a
//     second credit.
//   * INTEGER TOKENS, SIGNED. Positive credits, negative debits. One
//     signed column, never a separate debit/credit flag that can
//     contradict the sign.
//   * SERVICE ROLE ONLY. wallet_transactions has no insert policy at all,
//     so there is no path to it from a browser. This module is
//     server-only and every caller is an API route.
// ─────────────────────────────────────────────────────────────

import 'server-only';

// How many rows a balance read will look at. Summing in the client is a
// compromise: PostgREST cannot SUM without a database function, and
// adding one is a migration for a number that is currently in the low
// hundreds per account.
//
// The consequence is named rather than hidden: past this many rows the
// balance would silently start to be wrong, which is the worst possible
// failure for a balance. So readBalance REPORTS when it hits the ceiling,
// and callers refuse the operation rather than acting on a number they
// cannot trust. Replacing this with a SQL aggregate is the first thing to
// do when any account approaches it.
const BALANCE_ROW_CEILING = 5000;

/**
 * The balance, summed from rows.
 *
 * Returns { balance, complete }. `complete: false` means the ceiling was
 * hit and the number is a lower bound, not a balance — treat it as
 * unusable rather than as approximately right.
 */
export async function readBalance(admin, userId) {
  const { data, error } = await admin
    .from('wallet_transactions')
    .select('amount_tokens')
    .eq('user_id', userId)
    .limit(BALANCE_ROW_CEILING);
  if (error) return { balance: 0, complete: false, error };
  const rows = data || [];
  return {
    balance: rows.reduce((sum, r) => sum + (Number(r.amount_tokens) || 0), 0),
    complete: rows.length < BALANCE_ROW_CEILING,
  };
}

/**
 * Append rows.
 *
 * `on conflict (idempotency_key) do nothing` — the conflict target is a
 * PLAIN unique index, deliberately, because a partial one cannot be
 * inferred by PostgREST and would 400 every call. See the long note in
 * docs/overnight2_06_wallet_transactions.sql.
 *
 * Returns the rows actually written. An empty array from a non-empty
 * input is not a failure: it means every row was a duplicate, which is
 * exactly what "idempotent" is supposed to look like when a payment
 * provider redelivers an event.
 */
export async function appendLedger(admin, rows) {
  if (!rows || rows.length === 0) return { written: [], error: null };
  const { data, error } = await admin
    .from('wallet_transactions')
    .upsert(rows, { onConflict: 'idempotency_key', ignoreDuplicates: true })
    .select();
  if (error) return { written: [], error };
  return { written: data || [], error: null };
}

/**
 * A ledger row, with the shape enforced in one place.
 *
 * amountTokens is TRUNCATED to an integer rather than rounded, and a
 * non-finite value becomes zero. A fractional token cannot exist, and a
 * NaN reaching a bigint column is a 400 at best and a corrupted balance
 * at worst.
 */
export function ledgerRow({ userId, amountTokens, kind, description, ref, idempotencyKey, amountMinor, currency, metadata }) {
  const tokens = Number(amountTokens);
  return {
    user_id: userId,
    amount_tokens: Number.isFinite(tokens) ? Math.trunc(tokens) : 0,
    kind,
    description: description || null,
    ref: ref || null,
    idempotency_key: idempotencyKey || null,
    amount_minor: Number.isFinite(Number(amountMinor)) ? Math.trunc(Number(amountMinor)) : null,
    currency: currency || null,
    metadata: metadata || {},
  };
}
