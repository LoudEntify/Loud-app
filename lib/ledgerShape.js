// lib/ledgerShape.js
// ─────────────────────────────────────────────────────────────
// The pure part of lib/ledger.js: how a ledger row and a balanced pair are
// shaped. No database, no 'server-only', so lib/support.js and the node
// tests can use it. lib/ledger.js re-exports both so existing callers are
// unchanged.
// ─────────────────────────────────────────────────────────────
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

