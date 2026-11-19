import assert from 'node:assert/strict';
import { assertYouTubeConnectionOwner, buildYouTubeAuthorizationUrl, createPkcePair, hashOAuthState, openSecret, parseEncryptionKey, sealSecret } from '../lib/youtubeCore.mjs';
import { classifyYouTubeReadinessError, readinessCacheTtlMs, YOUTUBE_READINESS } from '../lib/youtubeReadiness.mjs';

const key = Buffer.alloc(32, 7).toString('base64');
assert.equal(parseEncryptionKey(key).length, 32);
assert.throws(() => parseEncryptionKey('too-short'));

const sealed = sealSecret('refresh-token-value', key);
assert.notEqual(sealed.includes('refresh-token-value'), true);
assert.equal(openSecret(sealed, key), 'refresh-token-value');
const tampered = `${sealed.slice(0, -1)}${sealed.endsWith('a') ? 'b' : 'a'}`;
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

console.log('youtube core: OAuth security, ownership and readiness classification passed');
