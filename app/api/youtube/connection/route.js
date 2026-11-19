import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin';
import { verifyArtistAuth } from '../../../../lib/verifyArtistAuth';
import { assertYouTubeConnectionOwner, decryptYouTubeRefreshToken, getYouTubeConfig, refreshYouTubeAccessToken, revokeYouTubeToken, youtubeLiveEnabled, youtubeLog } from '../../../../lib/youtubeServer';

const VERIFY_TTL_MS = 15 * 60 * 1000;

// AUTH MODEL: verified artist, owner-scoped to artist_id for every read
// and delete. Token ciphertext is never included in a response.
export async function GET(request) {
  const auth = await verifyArtistAuth(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!youtubeLiveEnabled()) return NextResponse.json({ enabled: false, connected: false });

  const { data, error } = await getSupabaseAdmin()
    .from('youtube_connections')
    .select('artist_id,channel_id,channel_title,connected_at,updated_at,last_verified_at,revoked_at,refresh_token_ciphertext')
    .eq('artist_id', auth.user.id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: 'Could not load YouTube connection.' }, { status: 503 });
  if (data) {
    try { assertYouTubeConnectionOwner(data, auth.user.id); } catch { return NextResponse.json({ error: 'This YouTube connection is not yours.' }, { status: 403 }); }
  }

  let connection = data;
  const verifiedAt = data?.last_verified_at ? new Date(data.last_verified_at).getTime() : 0;
  if (data && !data.revoked_at && Date.now() - verifiedAt >= VERIFY_TTL_MS) {
    try {
      const config = getYouTubeConfig();
      await refreshYouTubeAccessToken(decryptYouTubeRefreshToken(data.refresh_token_ciphertext, config), config);
      const now = new Date().toISOString();
      await getSupabaseAdmin().from('youtube_connections').update({ last_verified_at: now, updated_at: now }).eq('artist_id', auth.user.id);
      connection = { ...data, last_verified_at: now };
    } catch (refreshError) {
      if (refreshError.status === 400 || /invalid_grant|revoked|expired/i.test(refreshError.reason || refreshError.message)) {
        const revokedAt = new Date().toISOString();
        await getSupabaseAdmin().from('youtube_connections').update({ revoked_at: revokedAt, updated_at: revokedAt }).eq('artist_id', auth.user.id);
        connection = { ...data, revoked_at: revokedAt };
        youtubeLog('authorization_invalid', { artistId: auth.user.id, status: refreshError.status || null });
      } else {
        youtubeLog('authorization_check_failed', { artistId: auth.user.id, status: refreshError.status || null });
        return NextResponse.json({ error: 'Could not verify YouTube authorization.' }, { status: 503 });
      }
    }
  }
  return NextResponse.json({
    enabled: true,
    connected: Boolean(connection && !connection.revoked_at),
    authorizationRequired: Boolean(connection?.revoked_at),
    channel: connection && !connection.revoked_at ? { id: connection.channel_id, title: connection.channel_title } : null,
    connectedAt: connection && !connection.revoked_at ? connection.connected_at : null,
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
