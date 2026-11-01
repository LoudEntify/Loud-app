// GET /api/artist/shows/:id/console — everything the console needs on open:
// the show, my slot, broadcasts (state, video id; never keys), the
// connection status of my channel, the last kit check.
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../../../lib/supabaseAdmin';
import { verifyArtistAuth } from '../../../../../../lib/verifyArtistAuth';
import { correlationFrom, withCorrelation } from '../../../../../../lib/correlation';
import { loadOwnedShow } from '../../../../../../lib/artistShow';
import { connectionStatus, youtubeMode } from '../../../../../../lib/youtube/connections';
import { PUBLIC_PROFILE_COLUMNS, derivedState } from '../../../../../../lib/showPayload';
import { rigCameras } from '../../../../../../lib/rigCameras';
import { directionFromRow } from '../../../../../../lib/direction';

export async function GET(request, { params }) {
  const cid = correlationFrom(request);
  const auth = await verifyArtistAuth(request);
  if (auth.error) return withCorrelation(NextResponse.json({ error: auth.error }, { status: auth.status }), cid);
  const admin = getSupabaseAdmin();
  const owned = await loadOwnedShow(admin, params.id, auth.user.id);
  if (owned.error) return withCorrelation(NextResponse.json({ error: owned.error }, { status: owned.status }), cid);
  const { show, slot } = owned;
  // The rig, the shot settings and the clip count: without these three the
  // console cannot tell which cuts can be taken, and it used to assume a
  // single camera called main — so Side, Close and B-roll were refused for
  // every show, however many phones were paired.
  const [{ data: broadcasts }, conn, { data: artists }, { data: kit }, { data: pairings }, { data: direction }, { count: brollCount }] = await Promise.all([
    admin.from('broadcasts').select('id, channel_user_id, state, delivery_state, youtube_video_id, youtube_broadcast_id, last_error, attempts, started_at, ended_at').eq('show_id', show.id).order('created_at'),
    connectionStatus(admin, auth.user.id),
    admin.from('public_profiles').select(PUBLIC_PROFILE_COLUMNS).in('id', [show.artist_id, show.artist_b_id].filter(Boolean)),
    admin.from('kit_check_results').select('item, status, detail, checked_at').eq('artist_id', auth.user.id).order('checked_at', { ascending: false }).limit(14),
    admin.from('camfeed_pairings').select('id, role, used_at, last_seen_at, expires_at, revoked_at').eq('created_by', auth.user.id).is('revoked_at', null).then((r) => r, () => ({ data: null, error: true })),
    admin.from('direction_settings').select('settings').eq('artist_id', auth.user.id).maybeSingle(),
    admin.from('broll_clips').select('id', { count: 'exact', head: true }).eq('artist_id', auth.user.id),
  ]);
  return withCorrelation(NextResponse.json({ show: { ...show, derived_state: derivedState(show), artist: (artists || []).find((a) => a.id === show.artist_id) || null, artist_b: (artists || []).find((a) => a.id === show.artist_b_id) || null }, slot, broadcasts: broadcasts || [], connection: conn.status, youtubeMode: youtubeMode(), lastKitCheck: kit || [], cameras: pairings ? rigCameras(pairings) : null, direction: directionFromRow(direction), brollCount: brollCount || 0 }), cid);
}
