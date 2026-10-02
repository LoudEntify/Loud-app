// POST /api/artist/youtube/connect — start the YouTube connection.
// Real mode returns the Google consent URL; mock mode (no client id)
// connects a mock channel at once so onboarding can be completed and the
// whole pipeline exercised. Artist only; audited.
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../../lib/supabaseAdmin';
import { verifyArtistAuth } from '../../../../../lib/verifyArtistAuth';
import { correlationFrom, withCorrelation } from '../../../../../lib/correlation';
import { authUrl, signState } from '../../../../../lib/youtube/oauth';
import { youtubeMode, YOUTUBE_SCOPE } from '../../../../../lib/youtube/api';
import { storeConnection, checkReadiness, mockApiFor } from '../../../../../lib/youtube/connections';

export async function POST(request) {
  const cid = correlationFrom(request);
  const auth = await verifyArtistAuth(request);
  if (auth.error) return withCorrelation(NextResponse.json({ error: auth.error }, { status: auth.status }), cid);
  const origin = new URL(request.url).origin;
  if (youtubeMode() === 'google') {
    const url = authUrl({ redirectUri: `${origin}/api/artist/youtube/callback`, state: signState(auth.user.id) });
    return withCorrelation(NextResponse.json({ mode: 'google', url }), cid);
  }
  const admin = getSupabaseAdmin();
  const mock = mockApiFor(auth.user.id);
  const info = await mock.channelInfo();
  const { error } = await storeConnection(admin, { userId: auth.user.id, channelId: info.id, channelTitle: info.title, accessToken: 'mock-access-token', refreshToken: 'mock-refresh-token', expiresAt: new Date(Date.now() + 3600000).toISOString(), scopes: [YOUTUBE_SCOPE], provider: 'mock', correlationId: cid });
  if (error) return withCorrelation(NextResponse.json({ error: 'Could not save the connection.' }, { status: 500 }), cid);
  const readiness = await checkReadiness(admin, auth.user.id, { correlationId: cid });
  return withCorrelation(NextResponse.json({ mode: 'mock', connected: true, channel: { id: info.id, title: info.title }, readiness }), cid);
}
