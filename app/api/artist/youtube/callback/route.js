// GET /api/artist/youtube/callback — Google sends the artist back here with
// a code. The state carries the user id, signed. Tokens are exchanged
// server-side and stored encrypted; nothing token-shaped goes to the browser.
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../../lib/supabaseAdmin';
import { correlationFrom } from '../../../../../lib/correlation';
import { exchangeCode, readState, RETURN_TO } from '../../../../../lib/youtube/oauth';
import { GoogleYouTubeApi } from '../../../../../lib/youtube/api';
import { storeConnection, checkReadiness } from '../../../../../lib/youtube/connections';

export async function GET(request) {
  const cid = correlationFrom(request);
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const parsed = readState(url.searchParams.get('state'));
  // Back to where the artist started: onboarding, or Settings (the state carries the choice, signed).
  const back = (q) => NextResponse.redirect(new URL(`${parsed?.returnPath || RETURN_TO.onboarding}?${q}`, url.origin));
  if (!code || !parsed) return back('youtube=error&reason=state');
  const userId = parsed.userId;
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
