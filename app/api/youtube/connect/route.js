import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin';
import { verifyArtistAuth } from '../../../../lib/verifyArtistAuth';
import { buildYouTubeAuthorizationUrl, createPkcePair, encryptYouTubeRefreshToken, getYouTubeConfig, hashOAuthState, youtubeLiveEnabled, youtubeLog } from '../../../../lib/youtubeServer';

// AUTH MODEL: verified artist. This route creates only a short-lived,
// one-time OAuth state and returns Google's consent URL; no Google token
// or YouTube ingestion credential is returned to the browser.
export async function POST(request) {
  const auth = await verifyArtistAuth(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!youtubeLiveEnabled()) return NextResponse.json({ error: 'YouTube Live is not enabled.' }, { status: 404 });

  let config;
  try {
    config = getYouTubeConfig();
  } catch {
    return NextResponse.json({ error: 'YouTube connection setup is incomplete.' }, { status: 503 });
  }

  const state = randomBytes(32).toString('base64url');
  const pkce = createPkcePair();
  const admin = getSupabaseAdmin();
  const { error } = await admin.from('youtube_oauth_states').insert({
    state_hash: hashOAuthState(state),
    artist_id: auth.user.id,
    pkce_verifier_ciphertext: encryptYouTubeRefreshToken(pkce.verifier, config),
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  });
  if (error) {
    youtubeLog('oauth_state_create_failed', { artistId: auth.user.id, code: error.code || null });
    return NextResponse.json({ error: 'Could not begin YouTube connection.' }, { status: 503 });
  }

  youtubeLog('oauth_started', { artistId: auth.user.id });
  return NextResponse.json({ authorizationUrl: buildYouTubeAuthorizationUrl({
    clientId: config.clientId,
    redirectUri: config.redirectUri,
    state,
    codeChallenge: pkce.challenge,
  }) });
}
