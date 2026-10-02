// lib/support.js
// ─────────────────────────────────────────────────────────────
// Support: a viewer sends tokens they already hold to an artist, during a
// show. PRD row 107. docs/ARCHITECTURE.md Money.
//
// The logic is written against a small store interface so the same code
// runs on the real database (supabaseSupportStore, below) and against an
// in-memory store in tests/support.test.mjs, where the properties that
// matter are proven: a double tap pays once; no path creates money (the
// three legs always sum to zero); the artist share is 72.5% recorded at
// write time; limits are enforced; money and audit fail closed.
//
// Legs of one Support of N tokens:
//   viewer wallet        −N            (tip_sent)
//   artist wallet        +floor(N×0.725) (tip_received)
//   platform_revenue     +N − artist   (tip_received, metadata.fee = true)
// They share one entry_group_id; the database refuses the commit if they
// do not sum to zero (20261001160200_ledger_double_entry.sql).
// ─────────────────────────────────────────────────────────────
import { ledgerRow } from './ledgerShape.js';

export const SUPPORT_AMOUNTS = [10, 25, 50, 100];
export const SUPPORT_MESSAGE_MAX = 140;
export const ARTIST_SHARE_BP = 7250; // 72.5%, docs/CLAUDE.md §4
export const PLATFORM_DAILY_CAP_TOKENS = 1000;
export const PLATFORM_MONTHLY_CAP_TOKENS = 5000;

export function splitTokens(amount) {
  const artist = Math.floor((amount * ARTIST_SHARE_BP) / 10000);
  return { artist, platform: amount - artist };
}

export function supportLegs({ viewerId, artistId, amount, idempotencyKey, entryGroupId, showId, correlationId }) {
  const { artist, platform } = splitTokens(amount);
  const base = { ref: showId, metadata: { show_id: showId, kind: 'support' } };
  const shape = (row) => ({ ...row, entry_group_id: entryGroupId, is_legacy_single_leg: false, correlation_id: correlationId || null });
  return [
    shape({ ...ledgerRow({ ...base, userId: viewerId, amountTokens: -amount, kind: 'tip_sent', description: 'Support sent', idempotencyKey: `${idempotencyKey}:viewer` }), system_account: null }),
    shape({ ...ledgerRow({ ...base, userId: artistId, amountTokens: artist, kind: 'tip_received', description: 'Support received', idempotencyKey: `${idempotencyKey}:artist` }), system_account: null }),
    shape({ ...ledgerRow({ ...base, userId: null, amountTokens: platform, kind: 'tip_received', description: 'Platform share of support', idempotencyKey: `${idempotencyKey}:platform`, metadata: { ...base.metadata, fee: true } }), user_id: null, system_account: 'platform_revenue' }),
  ];
}

/**
 * @param store  { findSupportByKey, loadShow, readBalance, spentSince, profileLimit, appendLedger, insertSupport, audit, uuid, now }
 * @returns {{ status:number, body:object }}
 */
export async function sendSupport(store, input) {
  const { userId, showId, amountTokens, message, idempotencyKey, playbackPositionMs, correlationId, env } = input;
  const amount = Number(amountTokens);
  if (!SUPPORT_AMOUNTS.includes(amount)) return { status: 400, body: { error: `Amount must be one of ${SUPPORT_AMOUNTS.join(', ')} tokens.` } };
  if (typeof idempotencyKey !== 'string' || idempotencyKey.length < 8 || idempotencyKey.length > 128) return { status: 400, body: { error: 'idempotencyKey is required.' } };
  const msg = message == null ? null : String(message).trim().slice(0, SUPPORT_MESSAGE_MAX) || null;
  const pos = Number.isFinite(Number(playbackPositionMs)) ? Math.max(0, Math.trunc(Number(playbackPositionMs))) : null;

  // 1. Idempotency first: the same key is the same support, paid once.
  const existing = await store.findSupportByKey(idempotencyKey);
  if (existing) return { status: 200, body: { ok: true, duplicate: true, support: existing } };

  // 2. The show, and who gets the tokens.
  const show = await store.loadShow(showId);
  if (!show) return { status: 404, body: { error: 'That show does not exist.' } };
  if (!show.artist_id) return { status: 409, body: { error: 'This show has no artist to support yet.' } };
  if (show.cancelled_at || show.actual_ended_at) return { status: 409, body: { error: 'This show has ended.' } };
  if (show.artist_id === userId) return { status: 409, body: { error: 'You cannot support your own show.' } };

  // 3. Limits fail closed (docs/ARCHITECTURE.md Financial crime controls).
  const now = store.now();
  const dayStart = new Date(now); dayStart.setUTCHours(0, 0, 0, 0);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [spentToday, spentMonth, selfLimit] = await Promise.all([
    store.spentSince(userId, dayStart.toISOString()),
    store.spentSince(userId, monthStart.toISOString()),
    store.profileLimit(userId),
  ]);
  const dailyCap = Math.min(PLATFORM_DAILY_CAP_TOKENS, selfLimit || Infinity);
  if (spentToday + amount > dailyCap) return { status: 429, body: { error: `That would pass your daily limit of ${dailyCap} tokens.`, limit: 'daily' } };
  if (spentMonth + amount > PLATFORM_MONTHLY_CAP_TOKENS) return { status: 429, body: { error: `That would pass the monthly limit of ${PLATFORM_MONTHLY_CAP_TOKENS} tokens.`, limit: 'monthly' } };

  // 4. Balance.
  const bal = await store.readBalance(userId);
  if (!bal.complete) return { status: 503, body: { error: 'Could not read your balance. Try again.' } };
  if (bal.balance < amount) return { status: 402, body: { error: 'Not enough tokens.', balance: bal.balance } };

  // 5. Money, as one balanced group.
  const entryGroupId = store.uuid();
  const legs = supportLegs({ viewerId: userId, artistId: show.artist_id, amount, idempotencyKey, entryGroupId, showId, correlationId });
  const ledger = await store.appendLedger(legs);
  if (ledger.error) return { status: 500, body: { error: 'Could not record the tokens. Nothing was taken.' } };

  // 6. The product record. A unique-key conflict here means a concurrent
  //    duplicate won the race: that is success, not failure.
  const { artist } = splitTokens(amount);
  const row = {
    show_id: showId, from_user_id: userId, to_artist_id: show.artist_id, amount_tokens: amount,
    artist_share_bp: ARTIST_SHARE_BP, artist_tokens: artist, message: msg, playback_position_ms: pos,
    idempotency_key: idempotencyKey, entry_group_id: entryGroupId, correlation_id: correlationId || null, env: env || 'development',
  };
  const inserted = await store.insertSupport(row);
  if (inserted.error && !inserted.duplicate) {
    return { status: 500, body: { error: 'The tokens moved but the record failed. Quote this id to support.', correlationId } };
  }

  // 7. Audit, fail closed on money: an unauditable support is reported as such.
  const audit = await store.audit({
    actorType: 'viewer', actorId: userId, action: 'support.sent', subjectType: 'show', subjectId: showId, correlationId,
    after: { amount_tokens: amount, artist_tokens: artist, to_artist_id: show.artist_id, entry_group_id: entryGroupId },
  });
  if (audit.error) return { status: 500, body: { error: 'Support was recorded but could not be audited. Quote this id to support.', correlationId } };

  return { status: 200, body: { ok: true, duplicate: false, support: inserted.row || row, balance: bal.balance - amount } };
}

/** The real store. `admin` is the service-role client; `audit` is lib/audit.recordAuditEvent bound to it. */
export function supabaseSupportStore(admin, { recordAuditEvent, readBalance, appendLedger }) {
  return {
    now: () => new Date(),
    uuid: () => globalThis.crypto.randomUUID(),
    async findSupportByKey(key) {
      const { data } = await admin.from('support_events').select('*').eq('idempotency_key', key).maybeSingle();
      return data || null;
    },
    async loadShow(id) {
      const { data } = await admin.from('shows').select('id, artist_id, artist_b_id, cancelled_at, actual_ended_at, state').eq('id', id).maybeSingle();
      return data || null;
    },
    readBalance: (userId) => readBalance(admin, userId),
    async spentSince(userId, sinceIso) {
      const { data } = await admin.from('support_events').select('amount_tokens').eq('from_user_id', userId).gte('created_at', sinceIso).limit(5000);
      return (data || []).reduce((s, r) => s + Number(r.amount_tokens || 0), 0);
    },
    async profileLimit(userId) {
      const { data } = await admin.from('profiles').select('spending_limit_daily_tokens').eq('id', userId).maybeSingle();
      return data?.spending_limit_daily_tokens || null;
    },
    appendLedger: (rows) => appendLedger(admin, rows),
    async insertSupport(row) {
      const { data, error } = await admin.from('support_events').insert(row).select().single();
      if (error && error.code === '23505') return { duplicate: true, error };
      return { row: data, error };
    },
    audit: (e) => recordAuditEvent(admin, e),
  };
}
