import assert from 'node:assert/strict';
import { assertYouTubeConnectionOwner, buildYouTubeAuthorizationUrl, createPkcePair, hashOAuthState, openSecret, parseEncryptionKey, sealSecret } from '../lib/youtubeCore.mjs';
import { classifyYouTubeReadinessError, readinessCacheTtlMs, YOUTUBE_READINESS } from '../lib/youtubeReadiness.mjs';
import { assertBroadcastOwner, classifyBroadcastError, showMarker, validateBroadcastInput } from '../lib/youtubeBroadcastCore.mjs';
import { createYouTubeBroadcastManager } from '../lib/youtubeBroadcastManager.mjs';
import { youtubePlayerExperience } from '../lib/youtubePlayer.mjs';

const key = Buffer.alloc(32, 7).toString('base64');
assert.equal(parseEncryptionKey(key).length, 32);
assert.throws(() => parseEncryptionKey('too-short'));

const sealed = sealSecret('refresh-token-value', key);
assert.notEqual(sealed.includes('refresh-token-value'), true);
assert.equal(openSecret(sealed, key), 'refresh-token-value');
const sealedParts = sealed.split('.');
sealedParts[3] = `${sealedParts[3].startsWith('a') ? 'b' : 'a'}${sealedParts[3].slice(1)}`;
const tampered = sealedParts.join('.');
assert.throws(() => openSecret(tampered, key));

assert.equal(hashOAuthState('state-a'), hashOAuthState('state-a'));
assert.notEqual(hashOAuthState('state-a'), hashOAuthState('state-b'));

const pkce = createPkcePair();
assert.ok(pkce.verifier.length >= 43 && pkce.verifier.length <= 128);
assert.match(pkce.verifier, /^[A-Za-z0-9_-]+$/);
assert.match(pkce.challenge, /^[A-Za-z0-9_-]+$/);

const owned = { artist_id: 'artist-a', channel_id: 'channel-a', refresh_token_ciphertext: sealed };
assert.equal(assertYouTubeConnectionOwner(owned, 'artist-a'), owned);
assert.throws(() => assertYouTubeConnectionOwner(owned, 'artist-b'), error => error.status === 403);
assert.throws(() => assertYouTubeConnectionOwner(null, 'artist-a'), error => error.status === 403);

const auth = new URL(buildYouTubeAuthorizationUrl({ clientId: 'client-id', redirectUri: 'https://example.com/api/youtube/callback', state: 'opaque-state', codeChallenge: pkce.challenge }));
assert.equal(auth.origin, 'https://accounts.google.com');
assert.equal(auth.searchParams.get('access_type'), 'offline');
assert.equal(auth.searchParams.get('state'), 'opaque-state');
assert.equal(auth.searchParams.get('scope'), 'https://www.googleapis.com/auth/youtube.force-ssl');
assert.equal(auth.searchParams.get('redirect_uri'), 'https://example.com/api/youtube/callback');
assert.equal(auth.searchParams.get('code_challenge'), pkce.challenge);
assert.equal(auth.searchParams.get('code_challenge_method'), 'S256');

assert.deepEqual(classifyYouTubeReadinessError({ status: 400, reason: 'invalid_grant' }), { status: YOUTUBE_READINESS.AUTH_REQUIRED, code: 'AUTHORIZATION_INVALID' });
assert.deepEqual(classifyYouTubeReadinessError({ status: 403, youtubeReason: 'liveStreamingNotEnabled' }), { status: YOUTUBE_READINESS.ACTION_REQUIRED, code: 'LIVE_STREAMING_NOT_ENABLED' });
assert.deepEqual(classifyYouTubeReadinessError({ status: 403, reason: 'livePermissionBlocked' }), { status: YOUTUBE_READINESS.ACTION_REQUIRED, code: 'LIVE_STREAMING_NOT_ENABLED' });
assert.deepEqual(classifyYouTubeReadinessError({ status: 403, reason: 'insufficientLivePermissions' }), { status: YOUTUBE_READINESS.AUTH_REQUIRED, code: 'INSUFFICIENT_AUTHORIZATION' });
assert.deepEqual(classifyYouTubeReadinessError({ status: 403, reason: 'quotaExceeded' }), { status: YOUTUBE_READINESS.UNKNOWN, code: 'YOUTUBE_QUOTA_LIMIT' });
assert.deepEqual(classifyYouTubeReadinessError({ status: 429, reason: 'too many requests' }), { status: YOUTUBE_READINESS.UNKNOWN, code: 'YOUTUBE_QUOTA_LIMIT' });
assert.deepEqual(classifyYouTubeReadinessError({ status: 503, reason: 'backend error' }), { status: YOUTUBE_READINESS.ERROR, code: 'YOUTUBE_UNAVAILABLE' });
assert.ok(readinessCacheTtlMs(YOUTUBE_READINESS.READY) > readinessCacheTtlMs(YOUTUBE_READINESS.UNKNOWN));

assert.equal(validateBroadcastInput({ title: ' Show ', privacy: 'unlisted', scheduledAt: '2030-01-01T12:00:00Z' }).title, 'Show');
assert.throws(() => validateBroadcastInput({ title: 'Show', privacy: 'friends', scheduledAt: '2030-01-01T12:00:00Z' }));
assert.throws(() => assertBroadcastOwner({ artist_id: 'artist-b' }, 'artist-a'), error => error.status === 403);
assert.equal(showMarker('show-a'), '[Loudentify show:show-a]');
assert.deepEqual(classifyBroadcastError({ status: 403, youtubeReason: 'quotaExceeded' }), { code: 'YOUTUBE_QUOTA_LIMIT', retryable: true });

const rows = new Map();
const show = { id: 'show-a', artist_id: 'artist-a', title: 'Mock Show', slated_at: '2030-01-01T12:00:00Z', state: 'scheduled' };
const repository = {
  async loadShow(id) { return id === show.id ? show : null; },
  async get(id, artistId) { const row = rows.get(id); return row?.artist_id === artistId ? { ...row } : null; },
  async claim(id, artistId) {
    if (!rows.has(id)) rows.set(id, { show_id: id, artist_id: artistId, state: 'pending', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' });
    return { ...rows.get(id) };
  },
  async patch(id, artistId, values) {
    const row = rows.get(id);
    assert.equal(row.artist_id, artistId);
    Object.assign(row, values, { updated_at: '2026-01-01T00:01:00Z' });
    return { ...row };
  },
};
const calls = [];
let active = false;
const provider = {
  async findBroadcast(marker) { calls.push(['findBroadcast', marker]); return null; },
  async createBroadcast(input) { calls.push(['createBroadcast', input]); return { id: 'broadcast-a' }; },
  async findCompatibleStream(marker) { calls.push(['findStream', marker]); return null; },
  async createStream(input) { calls.push(['createStream', input]); return { id: 'stream-a', cdn: { ingestionInfo: { rtmpsIngestionAddress: 'rtmps://upload.example/live2', streamName: 'secret-key' } } }; },
  async bind(broadcastId, streamId) { calls.push(['bind', broadcastId, streamId]); return { id: broadcastId }; },
  async getStatus() { return { broadcast: { snippet: { title: 'Mock Show', description: showMarker(show.id), scheduledStartTime: show.slated_at }, status: { lifeCycleStatus: 'ready', privacyStatus: 'unlisted' } }, stream: { status: { streamStatus: active ? 'active' : 'inactive', healthStatus: { status: 'good' } } } }; },
  async updateBroadcast(resource) { calls.push(['update', resource]); return resource; },
  async transition(id, to) { calls.push(['transition', id, to]); return { status: { lifeCycleStatus: to } }; },
};
const sealedCredentials = [];
const manager = createYouTubeBroadcastManager({ repository, provider, sealCredentials(value) { sealedCredentials.push(value); return 'encrypted-ingestion'; }, now: () => new Date('2026-01-01T00:02:00Z') });
const prepared = await manager.prepare({ showId: show.id, artistId: 'artist-a', privacy: 'unlisted' });
assert.equal(prepared.broadcastId, 'broadcast-a');
assert.equal(prepared.streamId, 'stream-a');
assert.equal(prepared.state, 'prepared');
assert.equal(JSON.parse(sealedCredentials[0]).streamName, 'secret-key');
assert.equal(JSON.stringify(prepared).includes('secret-key'), false);
await manager.prepare({ showId: show.id, artistId: 'artist-a', privacy: 'unlisted' });
assert.equal(calls.filter(([name]) => name === 'createBroadcast').length, 1, 'prepare retries must not duplicate broadcasts');
await assert.rejects(() => manager.prepare({ showId: show.id, artistId: 'artist-b' }), error => error.status === 403);
await assert.rejects(() => manager.transition({ showId: show.id, artistId: 'artist-a', to: 'live' }), error => error.status === 409);
active = true;
const live = await manager.transition({ showId: show.id, artistId: 'artist-a', to: 'live' });
assert.equal(live.record.state, 'live');
const transitionCalls = calls.filter(([name]) => name === 'transition').length;
const liveRetry = await manager.transition({ showId: show.id, artistId: 'artist-a', to: 'live' });
assert.equal(liveRetry.idempotent, true);
assert.equal(calls.filter(([name]) => name === 'transition').length, transitionCalls);
const completed = await manager.transition({ showId: show.id, artistId: 'artist-a', to: 'complete' });
assert.equal(completed.record.state, 'complete');
const completeCalls = calls.filter(([name]) => name === 'transition').length;
assert.equal((await manager.transition({ showId: show.id, artistId: 'artist-a', to: 'complete' })).idempotent, true);
assert.equal(calls.filter(([name]) => name === 'transition').length, completeCalls);
const remoteStatus = await manager.status({ showId: show.id, artistId: 'artist-a' });
assert.equal(remoteStatus.youtube.streamStatus, 'active');
const updated = await manager.update({ showId: show.id, artistId: 'artist-a', title: 'Updated', privacy: 'private' });
assert.equal(updated.privacyStatus, 'private');
const workingStatus = provider.getStatus;
provider.getStatus = async () => { throw Object.assign(new Error('quota'), { status: 403, youtubeReason: 'quotaExceeded' }); };
await assert.rejects(() => manager.status({ showId: show.id, artistId: 'artist-a' }), error => error.broadcastFailure?.code === 'YOUTUBE_QUOTA_LIMIT');
assert.equal(rows.get(show.id).last_error, 'YOUTUBE_QUOTA_LIMIT');
provider.getStatus = workingStatus;

const playerShow = { state: 'soundcheck', title: 'Player show', room_name: 'room-a' };
assert.deepEqual(youtubePlayerExperience(playerShow, null), { status: 'NOT_CONFIGURED' });
assert.equal(youtubePlayerExperience(playerShow, { youtube_broadcast_id: 'abcdefghijk', privacy_status: 'private', state: 'live' }).status, 'PRIVATE');
assert.equal(youtubePlayerExperience(playerShow, { youtube_broadcast_id: 'abcdefghijk', privacy_status: 'unlisted', state: 'live' }).status, 'LIVE');
assert.equal(youtubePlayerExperience({ ...playerShow, state: 'ended' }, { youtube_broadcast_id: 'abcdefghijk', privacy_status: 'public', state: 'complete' }).status, 'ENDED');
assert.equal(youtubePlayerExperience(playerShow, { youtube_broadcast_id: 'not-valid', privacy_status: 'public', state: 'live' }).status, 'UNAVAILABLE');

console.log('youtube core: OAuth, ownership, readiness and mocked broadcast management passed');
