import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin';
import { verifyArtistAuth } from '../../../../lib/verifyArtistAuth';
import { assertYouTubeConnectionOwner, decryptYouTubeRefreshToken, getYouTubeConfig, revokeYouTubeToken, youtubeLiveEnabled, youtubeLog } from '../../../../lib/youtubeServer';

// AUTH MODEL: verified artist, owner-scoped to artist_id for every read
// and delete. Token ciphertext is never included in a response.
export async function GET(request) {
  const auth = await verifyArtistAuth(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!youtubeLiveEnabled()) return NextResponse.json({ enabled: false, connected: false });

  const { data, error } = await getSupabaseAdmin()
    .from('youtube_connections')
    .select('artist_id,channel_id,channel_title,connected_at,revoked_at')
    .eq('artist_id', auth.user.id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: 'Could not load YouTube connection.' }, { status: 503 });
  if (data) {
    try { assertYouTubeConnectionOwner(data, auth.user.id); } catch { return NextResponse.json({ error: 'This YouTube connection is not yours.' }, { status: 403 }); }
  }

  return NextResponse.json({
    enabled: true,
    connected: Boolean(data && !data.revoked_at),
    authorizationRequired: Boolean(data?.revoked_at),
    channel: data && !data.revoked_at ? { id: data.channel_id, title: data.channel_title } : null,
    connectedAt: data && !data.revoked_at ? data.connected_at : null,
  });
}

export async function DELETE(request) {
  const auth = await verifyArtistAuth(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!youtubeLiveEnabled()) return NextResponse.json({ error: 'YouTube Live is not enabled.' }, { status: 404 });

  let config;
  try { config = getYouTubeConfig(); } catch { return NextResponse.json({ error: 'YouTube connection setup is incomplete.' }, { status: 503 }); }
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from('youtube_connections')
    .select('artist_id,refresh_token_ciphertext')
    .eq('artist_id', auth.user.id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: 'Could not load YouTube connection.' }, { status: 503 });
  if (!data) return NextResponse.json({ ok: true, disconnected: false });
  try { assertYouTubeConnectionOwner(data, auth.user.id); } catch { return NextResponse.json({ error: 'This YouTube connection is not yours.' }, { status: 403 }); }

  try {
    await revokeYouTubeToken(decryptYouTubeRefreshToken(data.refresh_token_ciphertext, config));
  } catch (error_) {
    youtubeLog('oauth_revoke_failed', { artistId: auth.user.id, reason: error_.message });
    return NextResponse.json({ error: 'Could not revoke YouTube access. Try again.' }, { status: 502 });
  }

  const { error: deleteError } = await admin.from('youtube_connections').delete().eq('artist_id', auth.user.id);
  if (deleteError) return NextResponse.json({ error: 'YouTube access was revoked, but local cleanup failed.' }, { status: 503 });
  youtubeLog('oauth_disconnected', { artistId: auth.user.id });
  return NextResponse.json({ ok: true, disconnected: true });
}
