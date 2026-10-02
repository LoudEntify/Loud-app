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
