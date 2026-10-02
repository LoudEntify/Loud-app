// lib/youtube/crypto.js
// ─────────────────────────────────────────────────────────────
// Per-tenant encryption for third-party tokens and stream keys.
//
// docs/ARCHITECTURE.md: "third-party tokens encrypted with per-tenant
// keys, never returned to a client, never logged" and "encryption at rest
// with per-tenant keys for the sensitive stores, so a key revocation is a
// real containment action".
//
// One master secret (YOUTUBE_TOKEN_KEY, in the secrets manager, never in
// the repo) and a per-artist key derived from it with HKDF, so a blob for
// one artist cannot decrypt another's. AES-256-GCM: the IV and tag ride
// with the ciphertext. key_version is stored next to the blob so the
// master can be rotated (decrypt with the old version, re-encrypt with
// the new).
//
// Pure Node crypto; tests/youtube.test.mjs drives it with a test secret.
// ─────────────────────────────────────────────────────────────
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

export const KEY_VERSION = 1;

function masterSecret() {
  const s = process.env.YOUTUBE_TOKEN_KEY;
  if (!s || s.length < 32) throw new Error('YOUTUBE_TOKEN_KEY (32+ characters) is required to handle YouTube tokens');
  return s;
}

export function tenantKey(userId, version = KEY_VERSION, master = masterSecret()) {
  return Buffer.from(hkdfSync('sha256', master, `tenant:${userId}`, `loudentify-youtube-v${version}`, 32));
}

export function encryptForTenant(userId, plaintext, { version = KEY_VERSION, master } = {}) {
  const key = tenantKey(userId, version, master);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v${version}.${Buffer.concat([iv, tag, ct]).toString('base64url')}`;
}

export function decryptForTenant(userId, blob, { master } = {}) {
  const m = String(blob || '').match(/^v(\d+)\.(.+)$/);
  if (!m) throw new Error('not an encrypted blob');
  const version = Number(m[1]);
  const raw = Buffer.from(m[2], 'base64url');
  const iv = raw.subarray(0, 12), tag = raw.subarray(12, 28), ct = raw.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', tenantKey(userId, version, master), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

/** For logs: never the value, only that there is one. */
export function redact(value) { return value ? `<${String(value).length} chars>` : null; }
