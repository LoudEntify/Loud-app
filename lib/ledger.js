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

// ── Double-entry (supabase/migrations/20261001160200_ledger_double_entry.sql) ──
//
// Not yet used by any call site in app/api/wallet/* — those still write
// the single legacy leg via appendLedger/ledgerRow above, unchanged. This
// is the capability new call sites should use going forward; rewiring an
// existing route from single-leg to a pair is a real behaviour change
// against code that moves real money, and belongs in its own reviewed
// change per route, not bundled into this foundations round.
//
// Both legs are written in ONE upsert call, which Postgres executes as a
// single INSERT statement — the deferred zero-sum trigger sees both rows
// together regardless. The two legs' idempotency keys MUST be derived
// deterministically from the same source event id (e.g. `${eventId}:debit`
// / `${eventId}:credit`) — a retry of the same event then either matches
// both existing rows (both skipped, group stays balanced) or neither
// (both inserted, group stays balanced). Deriving them any other way can
// let one leg of a retry collide while the other doesn't, leaving a group
// that never balances.

/**
 * A matching debit/credit pair sharing one entry_group_id. `debit` is
 * negative, `credit` is positive, and the caller is responsible for them
 * actually being equal and opposite — the database enforces the sum at
 * commit, this just shapes the two rows.
 */
export function ledgerPair({ entryGroupId, debit, credit }) {
  const groupId = entryGroupId || globalThis.crypto?.randomUUID?.();
  const shape = (leg) => ({
    ...ledgerRow(leg),
    entry_group_id: groupId,
    is_legacy_single_leg: false,
    system_account: leg.systemAccount || null,
    user_id: leg.systemAccount ? null : leg.userId,
  });
  return [shape(debit), shape(credit)];
}

/** Append a balanced pair. Thin wrapper over appendLedger for symmetry with ledgerPair. */
export async function appendLedgerPair(admin, pairRows) {
  return appendLedger(admin, pairRows);
}

/**
 * Lazily creates the one ledger_accounts row an artist's payable balance
 * needs, the first time anything tries to credit them. Not pre-seeded per
 * artist in a migration — see 20261001160200_ledger_double_entry.sql.
 */
export async function ensureArtistPayableAccount(admin, artistUserId) {
  const id = `artist_payable:${artistUserId}`;
  const { error } = await admin
    .from('ledger_accounts')
    .upsert({ id, kind: 'artist_payable', owner_user_id: artistUserId }, { onConflict: 'id', ignoreDuplicates: true });
  return { id, error };
}
