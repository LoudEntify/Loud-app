import 'server-only';
import { assertYouTubeConnectionOwner, buildYouTubeAuthorizationUrl, createPkcePair, hashOAuthState, openSecret, parseEncryptionKey, sealSecret } from './youtubeCore.mjs';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const YOUTUBE_API = 'https://www.googleapis.com/youtube/v3';

export function youtubeLiveEnabled() {
  return process.env.YOUTUBE_LIVE_ENABLED === 'true';
}

export function getYouTubeConfig() {
  const config = {
    clientId: process.env.GOOGLE_OAUTH_CLIENT_ID,
    clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    redirectUri: process.env.YOUTUBE_OAUTH_REDIRECT_URI,
    encryptionKey: process.env.YOUTUBE_TOKEN_ENCRYPTION_KEY,
  };
  if (!config.clientId || !config.clientSecret || !config.redirectUri || !config.encryptionKey) {
    throw new Error('YouTube server configuration is incomplete');
  }
  parseEncryptionKey(config.encryptionKey);
  return config;
}

export function youtubeLog(event, fields = {}) {
  console.info(JSON.stringify({ service: 'youtube-live', event, ...fields }));
}

async function jsonRequest(url, options, operation) {
  let response;
  try {
    response = await fetch(url, options);
  } catch (error) {
    throw new Error(`${operation} network failure`, { cause: error });
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const youtubeReason = body?.error?.errors?.[0]?.reason || null;
    const reason = youtubeReason || body?.error?.message || body?.error_description || body?.error || `HTTP ${response.status}`;
    const error = new Error(`${operation} failed: ${reason}`);
    error.status = response.status;
    error.reason = String(reason);
    error.youtubeReason = youtubeReason;
    throw error;
  }
  return body;
}

export async function exchangeYouTubeCode(code, codeVerifier, config = getYouTubeConfig()) {
  return jsonRequest(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: 'authorization_code',
      code_verifier: codeVerifier,
    }),
  }, 'youtube_oauth_exchange');
}

export async function refreshYouTubeAccessToken(refreshToken, config = getYouTubeConfig()) {
  return jsonRequest(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  }, 'youtube_oauth_refresh');
}

export async function fetchYouTubeChannel(accessToken) {
  const params = new URLSearchParams({ part: 'id,snippet,status', mine: 'true' });
  const body = await jsonRequest(`${YOUTUBE_API}/channels?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  }, 'youtube_channel_lookup');
  const channel = body.items?.[0];
  if (!channel?.id) throw new Error('The selected Google account has no YouTube channel');
  return {
    id: channel.id,
    title: channel.snippet?.title || 'YouTube channel',
    isLinked: channel.status?.isLinked ?? null,
    longUploadsStatus: channel.status?.longUploadsStatus ?? null,
  };
}

export async function checkYouTubeLiveEligibility(accessToken) {
  const params = new URLSearchParams({ part: 'id,status', mine: 'true', maxResults: '1' });
  const body = await jsonRequest(`${YOUTUBE_API}/liveStreams?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  }, 'youtube_live_eligibility');
  return { accessible: true, existingStreams: Number(body.pageInfo?.totalResults || body.items?.length || 0) };
}

export async function revokeYouTubeToken(token) {
  let response;
  try {
    response = await fetch('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }),
    });
  } catch (error) {
    throw new Error('youtube_revoke network failure', { cause: error });
  }
  // Google returns 400 when a token is already invalid. That is already
  // the desired disconnected state and is safe to treat as idempotent.
  if (!response.ok && response.status !== 400) throw new Error(`youtube_revoke failed: HTTP ${response.status}`);
}

export function encryptYouTubeRefreshToken(token, config = getYouTubeConfig()) {
  return sealSecret(token, config.encryptionKey);
}

export function decryptYouTubeRefreshToken(payload, config = getYouTubeConfig()) {
  return openSecret(payload, config.encryptionKey);
}

export { assertYouTubeConnectionOwner, buildYouTubeAuthorizationUrl, createPkcePair, hashOAuthState };
