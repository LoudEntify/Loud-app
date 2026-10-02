// lib/youtube/oauth.js — Google OAuth for the artist's YouTube connection.
// Real mode builds the Google consent URL and exchanges the code; mock mode
// (no YOUTUBE_CLIENT_ID) connects a mock channel straight away so every
// flow can be exercised without Google verification (docs/NEEDS_KOREY.md).
import { YOUTUBE_SCOPE, youtubeMode } from './api.js';

export function authUrl({ redirectUri, state }) {
  if (youtubeMode() !== 'google') return null;
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.searchParams.set('client_id', process.env.YOUTUBE_CLIENT_ID);
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', YOUTUBE_SCOPE);
  u.searchParams.set('access_type', 'offline');
  u.searchParams.set('prompt', 'consent');
  u.searchParams.set('include_granted_scopes', 'false');
  u.searchParams.set('state', state);
  return u.toString();
}

export async function exchangeCode({ code, redirectUri, fetchImpl = globalThis.fetch }) {
  const res = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: process.env.YOUTUBE_CLIENT_ID, client_secret: process.env.YOUTUBE_CLIENT_SECRET, redirect_uri: redirectUri, grant_type: 'authorization_code' }),
  });
  const d = await res.json();
  if (!res.ok) throw new Error(`Google token exchange failed: ${d.error || res.status}`);
  return { accessToken: d.access_token, refreshToken: d.refresh_token || null, expiresAt: new Date(Date.now() + (d.expires_in || 3600) * 1000).toISOString(), scopes: String(d.scope || '').split(' ').filter(Boolean) };
}

export async function refreshAccessToken({ refreshToken, fetchImpl = globalThis.fetch }) {
  const res = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ refresh_token: refreshToken, client_id: process.env.YOUTUBE_CLIENT_ID, client_secret: process.env.YOUTUBE_CLIENT_SECRET, grant_type: 'refresh_token' }),
  });
  const d = await res.json();
  if (!res.ok) throw new Error(`Google token refresh failed: ${d.error || res.status}`);
  return { accessToken: d.access_token, expiresAt: new Date(Date.now() + (d.expires_in || 3600) * 1000).toISOString() };
}

import { createHmac } from 'node:crypto';
/** The OAuth state: the user id plus a signature, so the callback can trust it. */
export function signState(userId) {
  return `${userId}.${createHmac('sha256', process.env.YOUTUBE_TOKEN_KEY || 'local-state-key').update(String(userId)).digest('base64url').slice(0, 24)}`;
}
