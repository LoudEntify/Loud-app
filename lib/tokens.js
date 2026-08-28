// lib/tokens.js
// ─────────────────────────────────────────────────────────────
// The token economy's numbers, in one place, shared by the server routes
// that enforce them and the UI that displays them.
//
// NOT a client module and NOT a server module — plain constants and pure
// functions with no imports, so both sides can read the SAME values.
// Every number that a browser could otherwise send us is defined here and
// looked up server-side by key: a checkout request names a PACK, never a
// price, and a spend names an ACTION, never a cost. The client is never
// the source of an amount.
//
// ── EVERY AMOUNT IS AN INTEGER IN MINOR UNITS ──
// Pence, cents, kobo. Never a float, never a decimal string. `0.1 + 0.2`
// is a curiosity everywhere except in money, where it is a discrepancy
// that a human being has to reconcile. The only place a decimal point
// appears in this file is inside a formatting function whose output is
// for eyes, never for arithmetic.
// ─────────────────────────────────────────────────────────────

export const CURRENCY = 'GBP';
export const CURRENCY_SYMBOL = '£';

// ── What tokens cost to buy ───────────────────────────────────
// Bonus tokens are a SEPARATE ledger row (kind 'purchase_bonus'), not
// folded into the purchase amount. A person should be able to see that
// they were given something, and an accountant should be able to
// separate revenue from promotion without unpicking a sum.
export const TOKEN_PACKS = [
  { key: 'starter', tokens: 100,  bonus: 0,   amountMinor: 199,  label: 'Starter' },
  { key: 'regular', tokens: 500,  bonus: 25,  amountMinor: 899,  label: 'Regular' },
  { key: 'big',     tokens: 2000, bonus: 200, amountMinor: 2999, label: 'Big night' },
];

export function packByKey(key) {
  return TOKEN_PACKS.find((p) => p.key === key) || null;
}

// ── What tokens are worth on the way out ──────────────────────
// One penny per token, against roughly two pence per token on the way in.
// The spread is the platform's margin and the cost of the payment rails,
// and it is stated here rather than hidden in a calculation so that when
// somebody asks "why is my payout half what my fans paid", the answer is
// findable in one file.
export const PAYOUT_MINOR_PER_TOKEN = 1;

// A floor on cash-outs, because a payout rail charges a fixed fee per
// transfer and a £2 payout can genuinely cost more to send than it is
// worth. 5,000 tokens is £50.
export const MIN_CASHOUT_TOKENS = 5000;

// ── What tokens are spent on ──────────────────────────────────
// Keyed actions, so a client asks to perform an ACTION and the server
// looks up what it costs. A client that could send an amount could send
// a negative one.
//
// Reactions are one token on purpose: cheap enough to be reflexive during
// a song, real enough that a wall of them means something. Votes are ten
// because a competition result should cost more than a heart.
export const SPEND_ACTIONS = {
  reaction: { key: 'reaction', tokens: 1,  kind: 'reaction_spend', label: 'Reaction' },
  vote:     { key: 'vote',     tokens: 10, kind: 'vote_spend',     label: 'Competition vote' },
};

export function spendActionByKey(key) {
  return SPEND_ACTIONS[key] || null;
}

// ── Formatting, for eyes only ─────────────────────────────────
/**
 * Minor units → a string a person reads. Integer division and remainder,
 * never a float divide: `2999 / 100` is fine today and is the habit that
 * eventually produces `29.989999999999998`.
 */
export function formatMinor(amountMinor, currency = CURRENCY) {
  const n = Number(amountMinor) || 0;
  const negative = n < 0;
  const abs = Math.abs(n);
  const major = Math.trunc(abs / 100);
  const minor = abs % 100;
  const symbol = currency === CURRENCY ? CURRENCY_SYMBOL : '';
  return `${negative ? '-' : ''}${symbol}${major}.${String(minor).padStart(2, '0')}`;
}

export function payoutMinorFor(tokens) {
  return Math.trunc(Number(tokens) || 0) * PAYOUT_MINOR_PER_TOKEN;
}

/**
 * The balance, from rows. Summed rather than stored — see
 * docs/wallet_migration.sql. A stored balance and a ledger can disagree,
 * and when they do the person is looking at a number nobody can
 * reconstruct.
 */
export function balanceFrom(transactions) {
  return (transactions || []).reduce((sum, t) => sum + (Number(t.amount_tokens) || 0), 0);
}
