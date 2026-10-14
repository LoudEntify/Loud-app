// lib/youtube/disconnect.js — everything "Disconnect YouTube" has to do,
// in order, as one testable flow (connections.js wires it to Supabase):
//
//   1. revoke the grant with Google (best effort: Google may already have
//      forgotten it, and our copy goes either way);
//   2. delete our stored tokens (identity.youtube_connections: the
//      disconnect door overwrites the access token and nulls the refresh
//      token, docs/ARCHITECTURE.md "closing also disconnects the YouTube
//      channel and deletes the tokens");
//   3. wipe every stream key this artist's broadcasts still hold
//      (identity.stream_keys, the same rotate door the show end uses);
//   4. one audit entry with what happened at each step.
//
// The privacy policy promises "you can disconnect YouTube in Loudentify
// Settings at any time and we delete the tokens"; this is that promise.
// Takes a small `store` so tests drive it without a database; nothing in
// here imports server-only modules.
import { revokeToken } from './oauth.js';

/**
 * store: {
 *   readSecret(userId)            → { provider, refresh_token, access_token } (DECRYPTED, or null)
 *   deleteTokens(userId)          → boolean (there was a live connection)
 *   listBroadcastIds(userId)      → string[]
 *   rotateStreamKey(broadcastId)  → number of keys wiped
 *   audit(event)                  → Promise
 * }
 */
export async function disconnectEverywhere(store, userId, { correlationId = null, reason = 'artist', fetchImpl } = {}) {
  const secret = await store.readSecret(userId);
  let revoke = { attempted: false, ok: null, error: null };
  if (secret && secret.provider === 'google') {
    const token = secret.refresh_token || secret.access_token || null;
    const r = await revokeToken({ token, fetchImpl });
    revoke = { attempted: true, ok: r.ok, error: r.ok ? null : r.error };
  } else if (secret) {
    revoke = { attempted: false, ok: null, error: `provider ${secret.provider}: nothing to revoke` };
  }
  const deleted = await store.deleteTokens(userId);
  let keysWiped = 0;
  const broadcastIds = deleted ? await store.listBroadcastIds(userId) : [];
  for (const id of broadcastIds) keysWiped += Number((await store.rotateStreamKey(id)) || 0);
  if (deleted) {
    await store.audit({
      actorType: reason === 'artist' ? 'artist' : 'system', actorId: userId, action: 'youtube.disconnected', subjectType: 'youtube_connection', subjectId: userId, correlationId,
      metadata: { reason, provider: secret?.provider || null, google_revoked: revoke.ok, google_revoke_error: revoke.error, stream_keys_wiped: keysWiped, broadcasts_checked: broadcastIds.length },
    });
  }
  return { ok: deleted, revoked: revoke.ok, revokeError: revoke.error, streamKeysWiped: keysWiped };
}
