import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const TOKEN_VERSION = 'v1';

export function parseEncryptionKey(value) {
  const source = String(value || '').trim();
  const key = /^[a-f0-9]{64}$/i.test(source)
    ? Buffer.from(source, 'hex')
    : Buffer.from(source, 'base64');
  if (key.length !== 32) throw new Error('YOUTUBE_TOKEN_ENCRYPTION_KEY must decode to 32 bytes');
  return key;
}

export function sealSecret(plaintext, keyValue) {
  if (!plaintext) throw new Error('Cannot encrypt an empty secret');
  const key = Buffer.isBuffer(keyValue) ? keyValue : parseEncryptionKey(keyValue);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [TOKEN_VERSION, iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.');
}

export function openSecret(payload, keyValue) {
  const [version, ivValue, tagValue, ciphertextValue] = String(payload || '').split('.');
  if (version !== TOKEN_VERSION || !ivValue || !tagValue || !ciphertextValue) throw new Error('Unsupported encrypted secret');
  const key = Buffer.isBuffer(keyValue) ? keyValue : parseEncryptionKey(keyValue);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivValue, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

export function hashOAuthState(state) {
  return createHash('sha256').update(String(state || '')).digest('hex');
}

export function createPkcePair() {
  const verifier = randomBytes(64).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function assertYouTubeConnectionOwner(connection, artistId) {
  if (!connection || !artistId || connection.artist_id !== artistId) {
    const error = new Error('YouTube connection does not belong to this artist');
    error.status = 403;
    throw error;
  }
  return connection;
}

export function buildYouTubeAuthorizationUrl({ clientId, redirectUri, state, codeChallenge }) {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    // YouTube exposes no live-broadcast-only scope. force-ssl is the
    // narrower of the two scopes accepted by liveBroadcasts/liveStreams
    // management and avoids the blanket "manage your account" scope.
    scope: 'https://www.googleapis.com/auth/youtube.force-ssl',
    access_type: 'offline',
    include_granted_scopes: 'true',
    prompt: 'consent',
    state,
    ...(codeChallenge ? { code_challenge: codeChallenge, code_challenge_method: 'S256' } : {}),
  }).toString();
  return url.toString();
}
