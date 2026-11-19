import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin';
import { verifyArtistAuth } from '../../../../lib/verifyArtistAuth';
import { assertYouTubeConnectionOwner, checkYouTubeLiveEligibility, decryptYouTubeRefreshToken, fetchYouTubeChannel, getYouTubeConfig, refreshYouTubeAccessToken, youtubeLiveEnabled, youtubeLog } from '../../../../lib/youtubeServer';
import { classifyYouTubeReadinessError, readinessCacheTtlMs, readinessMessage, YOUTUBE_ACTIVATION_STEPS, YOUTUBE_READINESS } from '../../../../lib/youtubeReadiness.mjs';

function payload({ status, code = null, summary, channel = null, evidence = null, checkedAt = null, cached = false }) {
  return {
    status,
    code,
    summary: summary || readinessMessage(status, code),
    channel,
    evidence,
    checkedAt,
    cached,
    activationSteps: status === YOUTUBE_READINESS.READY ? [] : YOUTUBE_ACTIVATION_STEPS,
  };
}

async function cacheResult(admin, artistId, result) {
  const checkedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + readinessCacheTtlMs(result.status)).toISOString();
  const { error } = await admin.from('youtube_connections').update({
    readiness_status: result.status,
    readiness_code: result.code,
    readiness_summary: result.summary,
    readiness_evidence: result.evidence,
    readiness_checked_at: checkedAt,
    readiness_expires_at: expiresAt,
    updated_at: checkedAt,
  }).eq('artist_id', artistId);
  if (error) youtubeLog('readiness_cache_failed', { artistId, code: error.code || null });
  return { ...result, checkedAt };
}

// AUTH MODEL: verified artist. Credential lookup is owner-scoped and the
// encrypted refresh token never leaves this route. Only non-sensitive
// readiness evidence is returned and cached.
export async function GET(request) {
  const auth = await verifyArtistAuth(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!youtubeLiveEnabled()) return NextResponse.json(payload({ status: YOUTUBE_READINESS.NOT_CONNECTED }));

  const admin = getSupabaseAdmin();
  const { data, error } = await admin.from('youtube_connections')
    .select('artist_id,channel_id,channel_title,refresh_token_ciphertext,revoked_at,readiness_status,readiness_code,readiness_summary,readiness_evidence,readiness_checked_at,readiness_expires_at')
    .eq('artist_id', auth.user.id)
    .maybeSingle();
  if (error) {
    youtubeLog('readiness_connection_lookup_failed', { artistId: auth.user.id, code: error.code || null });
    return NextResponse.json(payload({ status: YOUTUBE_READINESS.ERROR }), { status: 503 });
  }
  if (!data) return NextResponse.json(payload({ status: YOUTUBE_READINESS.NOT_CONNECTED }));
  try { assertYouTubeConnectionOwner(data, auth.user.id); } catch { return NextResponse.json({ error: 'This YouTube connection is not yours.' }, { status: 403 }); }

  const channel = { id: data.channel_id, title: data.channel_title };
  if (data.revoked_at) return NextResponse.json(payload({ status: YOUTUBE_READINESS.AUTH_REQUIRED, code: 'AUTHORIZATION_INVALID', channel }));

  const force = new URL(request.url).searchParams.get('refresh') === '1';
  const cacheValid = data.readiness_status && data.readiness_expires_at && new Date(data.readiness_expires_at).getTime() > Date.now();
  if (!force && cacheValid) {
    return NextResponse.json(payload({
      status: data.readiness_status,
      code: data.readiness_code,
      summary: data.readiness_summary,
      channel,
      evidence: data.readiness_evidence,
      checkedAt: data.readiness_checked_at,
      cached: true,
    }));
  }

  let config;
  try { config = getYouTubeConfig(); } catch {
    return NextResponse.json(payload({ status: YOUTUBE_READINESS.ERROR, code: 'SERVER_CONFIGURATION' }), { status: 503 });
  }

  try {
    const refreshToken = decryptYouTubeRefreshToken(data.refresh_token_ciphertext, config);
    const tokens = await refreshYouTubeAccessToken(refreshToken, config);
    if (!tokens.access_token) throw new Error('YouTube did not return an access token');
    const [freshChannel, eligibility] = await Promise.all([
      fetchYouTubeChannel(tokens.access_token),
      checkYouTubeLiveEligibility(tokens.access_token),
    ]);
    const result = await cacheResult(admin, auth.user.id, {
      status: YOUTUBE_READINESS.READY,
      code: 'LIVE_STREAMS_LIST_AUTHORIZED',
      summary: readinessMessage(YOUTUBE_READINESS.READY),
      evidence: {
        signal: 'liveStreams.list authorized successfully',
        existingStreams: eligibility.existingStreams,
        channelLinked: freshChannel.isLinked,
        longUploadsStatus: freshChannel.longUploadsStatus,
      },
    });
    await admin.from('youtube_connections').update({ channel_id: freshChannel.id, channel_title: freshChannel.title, last_verified_at: result.checkedAt }).eq('artist_id', auth.user.id);
    youtubeLog('readiness_checked', { artistId: auth.user.id, channelId: freshChannel.id, status: result.status });
    return NextResponse.json(payload({ ...result, channel: { id: freshChannel.id, title: freshChannel.title } }));
  } catch (checkError) {
    const classification = classifyYouTubeReadinessError(checkError);
    const result = await cacheResult(admin, auth.user.id, {
      ...classification,
      summary: readinessMessage(classification.status, classification.code),
      evidence: { signal: classification.code },
    });
    if (classification.status === YOUTUBE_READINESS.AUTH_REQUIRED) {
      await admin.from('youtube_connections').update({ revoked_at: result.checkedAt }).eq('artist_id', auth.user.id);
    }
    youtubeLog('readiness_checked', { artistId: auth.user.id, channelId: data.channel_id, status: result.status, code: result.code });
    const httpStatus = classification.status === YOUTUBE_READINESS.ERROR ? 503 : 200;
    return NextResponse.json(payload({ ...result, channel }), { status: httpStatus });
  }
}
