import 'server-only';
import { createYouTubeBroadcastManager } from './youtubeBroadcastManager.mjs';
import { YouTubeBroadcastProvider } from './youtubeBroadcastProvider';
import { decryptYouTubeRefreshToken, encryptYouTubeRefreshToken, getYouTubeConfig, refreshYouTubeAccessToken } from './youtubeServer';

function repository(admin) {
  return {
    async loadShow(showId) {
      const { data, error } = await admin.from('shows').select('id,artist_id,title,slated_at,state').eq('id', showId).maybeSingle();
      if (error) throw new Error('Could not load the show');
      return data;
    },
    async get(showId, artistId) {
      const { data, error } = await admin.from('youtube_broadcasts').select('*').eq('show_id', showId).eq('artist_id', artistId).maybeSingle();
      if (error) throw new Error('Could not load the YouTube broadcast');
      return data;
    },
    async claim(showId, artistId) {
      const { error } = await admin.from('youtube_broadcasts').upsert({ show_id: showId, artist_id: artistId }, { onConflict: 'show_id', ignoreDuplicates: true });
      if (error) throw new Error('Could not reserve the YouTube broadcast');
      return this.get(showId, artistId);
    },
    async patch(showId, artistId, values) {
      const { data, error } = await admin.from('youtube_broadcasts').update({ ...values, updated_at: new Date().toISOString() }).eq('show_id', showId).eq('artist_id', artistId).select('*').maybeSingle();
      if (error || !data) throw new Error('Could not save the YouTube broadcast');
      return data;
    },
  };
}

export async function createArtistYouTubeBroadcastService(admin, artistId) {
  const config = getYouTubeConfig();
  const { data, error } = await admin.from('youtube_connections').select('artist_id,refresh_token_ciphertext,revoked_at').eq('artist_id', artistId).maybeSingle();
  if (error || !data || data.revoked_at) throw Object.assign(new Error('A valid YouTube connection is required'), { status: 401 });
  const refreshToken = decryptYouTubeRefreshToken(data.refresh_token_ciphertext, config);
  const tokens = await refreshYouTubeAccessToken(refreshToken, config);
  if (!tokens.access_token) throw new Error('YouTube did not return an access token');
  return createYouTubeBroadcastManager({
    repository: repository(admin),
    provider: new YouTubeBroadcastProvider(tokens.access_token),
    sealCredentials: value => encryptYouTubeRefreshToken(value, config),
  });
}
