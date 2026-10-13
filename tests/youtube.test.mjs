import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encryptForTenant, decryptForTenant, redact } from '../lib/youtube/crypto.js';
import { MockYouTubeApi, YouTubeApiError, YOUTUBE_SCOPE, GoogleYouTubeApi } from '../lib/youtube/api.js';
import { authUrl } from '../lib/youtube/oauth.js';

const master = 'test-master-secret-that-is-long-enough-0123456789';

test('tokens encrypt per tenant: another tenant cannot decrypt, tampering is detected', () => {
  const blob = encryptForTenant('user-a', 'ya29.secret-token', { master });
  assert.ok(blob.startsWith('v1.')); assert.equal(blob.includes('secret'), false);
  assert.equal(decryptForTenant('user-a', blob, { master }), 'ya29.secret-token');
  assert.throws(() => decryptForTenant('user-b', blob, { master }));
  const tampered = blob.slice(0, -2) + (blob.endsWith('A') ? 'B' : 'A') + blob.slice(-1);
  assert.throws(() => decryptForTenant('user-a', tampered, { master }));
  assert.equal(redact('abc'), '<3 chars>');
  assert.throws(() => encryptForTenant('u', 'x'), /YOUTUBE_TOKEN_KEY/, 'no master key: refuse, never fall back');
});

test('mock API: broadcast lifecycle and the three named failures', async () => {
  const api = new MockYouTubeApi();
  const b = await api.createBroadcast({ title: 'Show', scheduledStartTime: new Date().toISOString() });
  const s = await api.createStream({ title: 'Show' });
  assert.ok(b.broadcastId && b.videoId && s.streamKey);
  await api.bindStream({ broadcastId: b.broadcastId, streamId: s.streamId });
  assert.equal((await api.transition({ broadcastId: b.broadcastId, status: 'live' })).status, 'live');
  assert.equal((await api.endBroadcast({ broadcastId: b.broadcastId })).status, 'complete');
  api.fail('channel_not_live_enabled');
  assert.equal((await api.channelInfo()).liveEnabled, false);
  api.fail('channel_not_live_enabled', false).fail('reject_stream_key');
  const b2 = await api.createBroadcast({ title: 'x', scheduledStartTime: 'now' });
  await assert.rejects(api.transition({ broadcastId: b2.broadcastId, status: 'live' }), (e) => e instanceof YouTubeApiError && e.code === 'invalidTransition');
  api.fail('reject_stream_key', false).fail('ingest_drop');
  assert.equal((await api.ingestHealth({ streamId: s.streamId })).status, 'noData');
  assert.equal(YOUTUBE_SCOPE, 'https://www.googleapis.com/auth/youtube.force-ssl');
});

test('google API shapes requests with the bearer token and never leaks it in errors', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url: String(url), init }); return { ok: false, status: 403, json: async () => ({ error: { message: 'Forbidden', errors: [{ reason: 'liveStreamingNotEnabled' }] } }) }; };
  const api = new GoogleYouTubeApi({ accessToken: 'tok-secret', fetchImpl });
  await assert.rejects(api.channelInfo(), (e) => e.code === 'liveStreamingNotEnabled' && !String(e.message).includes('tok-secret'));
  assert.ok(calls[0].url.includes('/youtube/v3/channels'));
  assert.equal(calls[0].init.headers.authorization, 'Bearer tok-secret');
  assert.equal(authUrl({ redirectUri: 'x', state: 'y' }), null, 'no client id: mock mode, no Google URL');
});

// ── Settings: disconnect everywhere, revoke, the return-aware state ──
import { revokeToken, signState, readState, RETURN_TO } from '../lib/youtube/oauth.js';
import { disconnectEverywhere } from '../lib/youtube/disconnect.js';

test('revokeToken posts the token to Google and never throws or leaks it', async () => {
  const calls = [];
  const okFetch = async (url, init) => { calls.push({ url: String(url), body: String(init.body) }); return { ok: true, status: 200, json: async () => ({}) }; };
  assert.deepEqual(await revokeToken({ token: 'rt-secret', fetchImpl: okFetch }), { ok: true, status: 200, error: null });
  assert.equal(calls[0].url, 'https://oauth2.googleapis.com/revoke'); assert.equal(calls[0].body, 'token=rt-secret');
  const gone = async () => ({ ok: false, status: 400, json: async () => ({ error: 'invalid_token' }) });
  const r = await revokeToken({ token: 'rt-secret', fetchImpl: gone });
  assert.equal(r.ok, false); assert.equal(r.error, 'invalid_token'); assert.equal(JSON.stringify(r).includes('rt-secret'), false);
  const down = async () => { throw new Error('network down'); };
  assert.equal((await revokeToken({ token: 'x', fetchImpl: down })).error, 'network down');
  assert.equal((await revokeToken({ token: null })).error, 'no token to revoke');
});

test('OAuth state carries where to return to, signed; a tampered marker falls back to onboarding', () => {
  const plain = signState('user-1');
  assert.deepEqual(readState(plain), { userId: 'user-1', returnTo: 'onboarding', returnPath: '/artist/onboarding' });
  const fromSettings = signState('user-1', 'settings');
  assert.ok(fromSettings.startsWith(plain) && fromSettings.endsWith('.settings'));
  assert.deepEqual(readState(fromSettings), { userId: 'user-1', returnTo: 'settings', returnPath: '/settings' });
  assert.equal(readState(`${plain}.evil`).returnPath, RETURN_TO.onboarding, 'an unknown marker cannot redirect anywhere else');
  assert.equal(readState('user-2.' + plain.split('.')[1]), null, 'another user with this signature is refused');
  assert.equal(readState(''), null);
  assert.equal(signState('user-1', 'onboarding'), plain, 'the default marker is left off');
});

function fakeStore({ provider = 'google', connected = true, broadcasts = ['b1', 'b2'], keysPer = { b1: 1, b2: 0 } } = {}) {
  const log = { rotated: [], audits: [], deleted: 0 };
  const store = {
    async readSecret() { return connected ? { provider, refresh_token: provider === 'google' ? 'rt-secret' : null, access_token: provider === 'google' ? 'at-secret' : null } : null; },
    async deleteTokens() { log.deleted += 1; return connected; },
    async listBroadcastIds() { return broadcasts; },
    async rotateStreamKey(id) { log.rotated.push(id); return keysPer[id] || 0; },
    async audit(e) { log.audits.push(e); },
  };
  return { store, log };
}

test('disconnect everywhere: revoke with Google, delete tokens, wipe every stream key, one audit entry', async () => {
  const { store, log } = fakeStore();
  const posted = [];
  const fetchImpl = async (url, init) => { posted.push(String(init.body)); return { ok: true, status: 200, json: async () => ({}) }; };
  const r = await disconnectEverywhere(store, 'user-1', { correlationId: 'cid-1', fetchImpl });
  assert.deepEqual(r, { ok: true, revoked: true, revokeError: null, streamKeysWiped: 1 });
  assert.deepEqual(posted, ['token=rt-secret'], 'the refresh token is what gets revoked (it takes the access tokens with it)');
  assert.deepEqual(log.rotated, ['b1', 'b2']); assert.equal(log.deleted, 1);
  assert.equal(log.audits.length, 1);
  const a = log.audits[0];
  assert.equal(a.action, 'youtube.disconnected'); assert.equal(a.actorType, 'artist'); assert.equal(a.actorId, 'user-1'); assert.equal(a.correlationId, 'cid-1');
  assert.deepEqual(a.metadata, { reason: 'artist', provider: 'google', google_revoked: true, google_revoke_error: null, stream_keys_wiped: 1, broadcasts_checked: 2 });
  assert.equal(JSON.stringify(a).includes('secret'), false, 'no token in the audit entry');
});

test('disconnect everywhere: Google refusing the revoke still deletes our copy and says so; nothing connected is a no-op', async () => {
  const { store, log } = fakeStore();
  const refuse = async () => ({ ok: false, status: 400, json: async () => ({ error: 'invalid_token' }) });
  const r = await disconnectEverywhere(store, 'user-1', { fetchImpl: refuse });
  assert.equal(r.ok, true); assert.equal(r.revoked, false); assert.equal(r.revokeError, 'invalid_token');
  assert.equal(log.audits[0].metadata.google_revoked, false); assert.equal(log.audits[0].metadata.google_revoke_error, 'invalid_token');
  // a mock connection has nothing to revoke
  const mock = fakeStore({ provider: 'mock' });
  const m = await disconnectEverywhere(mock.store, 'user-1', { fetchImpl: refuse });
  assert.equal(m.ok, true); assert.equal(m.revoked, null); assert.equal(mock.log.audits[0].metadata.provider, 'mock');
  // nothing connected: no revoke call, no sweep, no audit
  const none = fakeStore({ connected: false });
  const n = await disconnectEverywhere(none.store, 'user-1', { fetchImpl: async () => { throw new Error('must not be called'); } });
  assert.deepEqual(n, { ok: false, revoked: null, revokeError: null, streamKeysWiped: 0 });
  assert.deepEqual(none.log.rotated, []); assert.equal(none.log.audits.length, 0);
});
