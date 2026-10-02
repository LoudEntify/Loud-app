// lib/youtube/connections.js — connect, check readiness, read, disconnect.
// Server-only. Every connect, refresh failure and disconnect is audited
// (docs/ARCHITECTURE.md "Third-party connections").
import 'server-only';
import { encryptForTenant, decryptForTenant, KEY_VERSION } from './crypto.js';
import { MockYouTubeApi, GoogleYouTubeApi, youtubeMode, YOUTUBE_SCOPE } from './api.js';
import { refreshAccessToken } from './oauth.js';
import { recordAuditEvent } from '../audit.js';

const mockApis = new Map(); // per user, so mock state survives within a process

export function mockApiFor(userId) {
  if (!mockApis.has(userId)) mockApis.set(userId, new MockYouTubeApi({ channel: { id: `UC_mock_${userId.slice(0, 8)}`, title: 'Mock channel', liveEnabled: true } }));
  return mockApis.get(userId);
}

/** Store a connection (tokens encrypted here, never before). */
export async function storeConnection(admin, { userId, channelId, channelTitle, accessToken, refreshToken, expiresAt, scopes, provider, correlationId }) {
  const { error } = await admin.rpc('youtube_connection_upsert', {
    p_user_id: userId, p_channel_id: channelId, p_channel_title: channelTitle || null,
    p_access_token_enc: encryptForTenant(userId, accessToken), p_refresh_token_enc: refreshToken ? encryptForTenant(userId, refreshToken) : null,
    p_token_expires_at: expiresAt || null, p_scopes: scopes || [YOUTUBE_SCOPE], p_provider: provider, p_key_version: KEY_VERSION,
  });
  if (error) return { error };
  await recordAuditEvent(admin, { actorType: 'artist', actorId: userId, action: 'youtube.connected', subjectType: 'youtube_connection', subjectId: userId, correlationId, after: { channel_id: channelId, provider, scopes: scopes || [YOUTUBE_SCOPE] } });
  return { error: null };
}

export async function connectionStatus(admin, userId) {
  const { data, error } = await admin.rpc('youtube_connection_status', { p_user_id: userId });
  if (error) return { status: null, error };
  const row = Array.isArray(data) ? data[0] : data;
  return { status: row || null, error: null };
}

/** An API client for this artist, refreshing the token when needed. Never returns the token. */
export async function apiForArtist(admin, userId, { correlationId } = {}) {
  const { data, error } = await admin.rpc('youtube_connection_secret', { p_user_id: userId });
  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row) return { api: null, error: error || new Error('not connected') };
  if (row.provider === 'mock') return { api: mockApiFor(userId), provider: 'mock', channelId: row.channel_id, error: null };
  let accessToken = decryptForTenant(userId, row.access_token_enc);
  if (row.token_expires_at && Date.parse(row.token_expires_at) - Date.now() < 60_000 && row.refresh_token_enc) {
    try {
      const fresh = await refreshAccessToken({ refreshToken: decryptForTenant(userId, row.refresh_token_enc) });
      accessToken = fresh.accessToken;
      await admin.rpc('youtube_connection_upsert', { p_user_id: userId, p_channel_id: row.channel_id, p_channel_title: null, p_access_token_enc: encryptForTenant(userId, accessToken), p_refresh_token_enc: row.refresh_token_enc, p_token_expires_at: fresh.expiresAt, p_scopes: [YOUTUBE_SCOPE], p_provider: 'google', p_key_version: KEY_VERSION });
    } catch (e) {
      await admin.rpc('youtube_connection_refresh_failed', { p_user_id: userId, p_error: String(e.message).slice(0, 200) });
      await recordAuditEvent(admin, { actorType: 'system', actorId: userId, action: 'youtube.refresh_failed', subjectType: 'youtube_connection', subjectId: userId, correlationId, metadata: { message: String(e.message).slice(0, 200) } });
      return { api: null, error: e };
    }
  }
  return { api: new GoogleYouTubeApi({ accessToken }), provider: 'google', channelId: row.channel_id, error: null };
}

/** Channel readiness, checked at onboarding, never at show time. */
export async function checkReadiness(admin, userId, { correlationId } = {}) {
  const { api, error } = await apiForArtist(admin, userId, { correlationId });
  if (!api) return { liveEnabled: false, error: error?.message || 'not connected' };
  try {
    const info = await api.channelInfo();
    await admin.rpc('youtube_connection_readiness', { p_user_id: userId, p_live_enabled: info.liveEnabled, p_error: info.liveEnabled ? null : 'This channel is not enabled for live streaming yet. A new channel can take about a day to enable.' });
    return { liveEnabled: info.liveEnabled, channelTitle: info.title, error: null };
  } catch (e) {
    await admin.rpc('youtube_connection_readiness', { p_user_id: userId, p_live_enabled: false, p_error: String(e.message).slice(0, 200) });
    return { liveEnabled: false, error: e.message };
  }
}

export async function disconnect(admin, userId, { correlationId, reason = 'artist' } = {}) {
  const { data, error } = await admin.rpc('youtube_connection_disconnect', { p_user_id: userId });
  if (error) return { ok: false, error };
  if (data) await recordAuditEvent(admin, { actorType: reason === 'artist' ? 'artist' : 'system', actorId: userId, action: 'youtube.disconnected', subjectType: 'youtube_connection', subjectId: userId, correlationId, metadata: { reason } });
  mockApis.delete(userId);
  return { ok: Boolean(data), error: null };
}

export { youtubeMode };
