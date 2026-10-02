// GET /api/artist/youtube/callback — Google sends the artist back here with
// a code. The state carries the user id, signed. Tokens are exchanged
// server-side and stored encrypted; nothing token-shaped goes to the browser.
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../../lib/supabaseAdmin';
import { correlationFrom } from '../../../../../lib/correlation';
import { exchangeCode, signState } from '../../../../../lib/youtube/oauth';
import { GoogleYouTubeApi } from '../../../../../lib/youtube/api';
import { storeConnection, checkReadiness } from '../../../../../lib/youtube/connections';

export async function GET(request) {
  const cid = correlationFrom(request);
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state') || '';
  const userId = state.split('.')[0];
  const back = (q) => NextResponse.redirect(new URL(`/artist/onboarding?${q}`, url.origin));
  if (!code || !userId || signState(userId) !== state) return back('youtube=error&reason=state');
  try {
    const tokens = await exchangeCode({ code, redirectUri: `${url.origin}/api/artist/youtube/callback` });
    const api = new GoogleYouTubeApi({ accessToken: tokens.accessToken });
    const info = await api.channelInfo();
    const admin = getSupabaseAdmin();
    await storeConnection(admin, { userId, channelId: info.id, channelTitle: info.title, accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, expiresAt: tokens.expiresAt, scopes: tokens.scopes, provider: 'google', correlationId: cid });
    await checkReadiness(admin, userId, { correlationId: cid });
    return back('youtube=connected');
  } catch (e) {
    return back(`youtube=error&reason=${encodeURIComponent(String(e.message).slice(0, 80))}`);
  }
}
