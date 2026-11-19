import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin';
import { decryptYouTubeRefreshToken, encryptYouTubeRefreshToken, exchangeYouTubeCode, fetchYouTubeChannel, getYouTubeConfig, hashOAuthState, youtubeLiveEnabled, youtubeLog } from '../../../../lib/youtubeServer';

function settingsRedirect(config, result) {
  const url = new URL('/settings', config.redirectUri);
  url.searchParams.set('youtube', result);
  return NextResponse.redirect(url);
}

// AUTH MODEL: one-time OAuth state created by the authenticated connect
// route. Google cannot send the artist's Supabase bearer token back, so
// consumeYouTubeOAuthState is the authentication boundary here.
async function consumeYouTubeOAuthState(admin, state) {
  if (!state) return null;
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from('youtube_oauth_states')
    .update({ used_at: now })
    .eq('state_hash', hashOAuthState(state))
    .is('used_at', null)
    .gt('expires_at', now)
    .select('artist_id,pkce_verifier_ciphertext')
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

export async function GET(request) {
  if (!youtubeLiveEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  let config;
  try { config = getYouTubeConfig(); } catch { return NextResponse.json({ error: 'YouTube connection setup is incomplete.' }, { status: 503 }); }

  const url = new URL(request.url);
  const state = url.searchParams.get('state');
  const code = url.searchParams.get('code');
  const providerError = url.searchParams.get('error');
  const admin = getSupabaseAdmin();

  let oauthState;
  try {
    oauthState = await consumeYouTubeOAuthState(admin, state);
  } catch (error) {
    youtubeLog('oauth_state_consume_failed', { code: error.code || null });
    return settingsRedirect(config, 'error');
  }
  if (!oauthState?.artist_id || !oauthState.pkce_verifier_ciphertext) return settingsRedirect(config, 'invalid_state');
  const artistId = oauthState.artist_id;
  if (providerError || !code) {
    youtubeLog('oauth_denied', { artistId, reason: providerError || 'missing_code' });
    return settingsRedirect(config, 'cancelled');
  }

  try {
    const codeVerifier = decryptYouTubeRefreshToken(oauthState.pkce_verifier_ciphertext, config);
    const tokens = await exchangeYouTubeCode(code, codeVerifier, config);
    if (!tokens.access_token || !tokens.refresh_token) throw new Error('Google did not return the required offline token');
    const channel = await fetchYouTubeChannel(tokens.access_token);
    const { error } = await admin.from('youtube_connections').upsert({
      artist_id: artistId,
      channel_id: channel.id,
      channel_title: channel.title,
      refresh_token_ciphertext: encryptYouTubeRefreshToken(tokens.refresh_token, config),
      scopes: String(tokens.scope || '').split(' ').filter(Boolean),
      connected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      last_verified_at: new Date().toISOString(),
      revoked_at: null,
    }, { onConflict: 'artist_id' });
    if (error) throw error;
    youtubeLog('oauth_connected', { artistId, channelId: channel.id });
    return settingsRedirect(config, 'connected');
  } catch (error) {
    youtubeLog('oauth_callback_failed', { artistId, status: error.status || null, reason: error.reason || error.message });
    return settingsRedirect(config, 'error');
  }
}
