import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendSupport, splitTokens, supportLegs, PLATFORM_DAILY_CAP_TOKENS } from '../lib/support.js';

function memoryStore({ balance = 500, show = { id: 's1', artist_id: 'artist', cancelled_at: null, actual_ended_at: null }, selfLimit = null, failAudit = false } = {}) {
  const ledger = []; const supports = []; const audits = [];
  let n = 0;
  return {
    ledger, supports, audits,
    now: () => new Date('2026-10-02T20:00:00Z'),
    uuid: () => `uuid-${++n}`,
    async findSupportByKey(k) { return supports.find((s) => s.idempotency_key === k) || null; },
    async loadShow(id) { return show && show.id === id ? show : null; },
    async readBalance() { return { balance: balance + ledger.filter((l) => l.user_id === 'viewer').reduce((s, l) => s + l.amount_tokens, 0), complete: true }; },
    async spentSince(userId, since) { return supports.filter((s) => s.from_user_id === userId && s.created_at >= since).reduce((s, r) => s + r.amount_tokens, 0); },
    async profileLimit() { return selfLimit; },
    async appendLedger(rows) {
      const written = [];
      for (const r of rows) { if (ledger.some((l) => l.idempotency_key === r.idempotency_key)) continue; ledger.push(r); written.push(r); }
      return { written, error: null };
    },
    async insertSupport(row) {
      if (supports.some((s) => s.idempotency_key === row.idempotency_key)) return { duplicate: true, error: { code: '23505' } };
      const saved = { ...row, created_at: this.now().toISOString() }; supports.push(saved); return { row: saved, error: null };
    },
    async audit(e) { audits.push(e); return failAudit ? { error: new Error('audit down') } : { id: audits.length, error: null }; },
  };
}
const input = (over = {}) => ({ userId: 'viewer', showId: 's1', amountTokens: 25, message: 'love this', idempotencyKey: 'key-00000001', playbackPositionMs: 12345, correlationId: 'c1', env: 'development', ...over });

test('72.5% to the artist, recorded at write time; legs sum to zero', () => {
  assert.deepEqual(splitTokens(25), { artist: 18, platform: 7 });
  assert.deepEqual(splitTokens(100), { artist: 72, platform: 28 });
  for (const amount of [10, 25, 50, 100, 7, 1]) {
    const legs = supportLegs({ viewerId: 'v', artistId: 'a', amount, idempotencyKey: 'k', entryGroupId: 'g', showId: 's' });
    assert.equal(legs.reduce((s, l) => s + l.amount_tokens, 0), 0, `amount ${amount}`);
    assert.equal(legs[2].system_account, 'platform_revenue'); assert.equal(legs[2].user_id, null);
    assert.ok(legs.every((l) => l.entry_group_id === 'g'));
  }
});

test('a double tap pays once (same idempotency key)', async () => {
  const store = memoryStore();
  const a = await sendSupport(store, input());
  const b = await sendSupport(store, input());
  assert.equal(a.status, 200); assert.equal(a.body.duplicate, false);
  assert.equal(b.status, 200); assert.equal(b.body.duplicate, true);
  assert.equal(store.supports.length, 1);
  assert.equal(store.ledger.length, 3);
  assert.equal(store.ledger.reduce((s, l) => s + l.amount_tokens, 0), 0, 'no money created');
  assert.equal(store.supports[0].artist_tokens, 18); assert.equal(store.supports[0].artist_share_bp, 7250);
  assert.equal(store.supports[0].playback_position_ms, 12345);
  assert.equal(store.audits.length, 1); assert.equal(store.audits[0].action, 'support.sent');
});

test('a retry after a crashed first attempt (ledger written, record missing) still ends with one of each', async () => {
  const store = memoryStore();
  const orig = store.insertSupport.bind(store);
  let crashed = false;
  store.insertSupport = async (row) => { if (!crashed) { crashed = true; return { error: new Error('boom') }; } return orig(row); };
  const first = await sendSupport(store, input());
  assert.equal(first.status, 500);
  const second = await sendSupport(store, input());
  assert.equal(second.status, 200);
  assert.equal(store.ledger.length, 3, 'ledger legs were not written twice');
  assert.equal(store.supports.length, 1);
});

test('limits and balance fail closed; no leg is written', async () => {
  let store = memoryStore({ balance: 10 });
  assert.equal((await sendSupport(store, input())).status, 402); assert.equal(store.ledger.length, 0);
  store = memoryStore({ selfLimit: 20 });
  assert.equal((await sendSupport(store, input())).status, 429); assert.equal(store.ledger.length, 0);
  store = memoryStore({ balance: 100000 });
  let k = 0;
  while ((await sendSupport(store, input({ amountTokens: 100, idempotencyKey: `cap-${String(++k).padStart(8, '0')}` }))).status === 200) { /* spend up to the cap */ }
  assert.equal(store.supports.reduce((s, r) => s + r.amount_tokens, 0), PLATFORM_DAILY_CAP_TOKENS);
  assert.equal((await sendSupport(store, input({ amountTokens: 7 }))).status, 400);
  assert.equal((await sendSupport(store, input({ idempotencyKey: 'x' }))).status, 400);
  assert.equal((await sendSupport(memoryStore({ show: null }), input())).status, 404);
  assert.equal((await sendSupport(memoryStore({ show: { id: 's1', artist_id: 'viewer' } }), input())).status, 409);
  assert.equal((await sendSupport(memoryStore({ show: { id: 's1', artist_id: 'a', actual_ended_at: 'x' } }), input())).status, 409);
});

test('an unauditable support is reported, not hidden', async () => {
  const store = memoryStore({ failAudit: true });
  const r = await sendSupport(store, input());
  assert.equal(r.status, 500); assert.equal(r.body.correlationId, 'c1');
});
