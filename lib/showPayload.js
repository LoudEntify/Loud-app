// lib/showPayload.js — what a viewer is allowed to know about a show.
// Server-side shaping so a screen never has to hide a field it received.
import 'server-only';

export const SHOW_COLUMNS = 'id, title, description, genre, cover_url, slated_at, ends_at, duration_minutes, state, performance_mode, delivery, youtube_video_id, versus_view, artist_id, artist_b_id, actual_started_at, actual_ended_at, cancelled_at, visibility, is_synthetic, room_name, active_performer_slot';
export const PUBLIC_PROFILE_COLUMNS = 'id, role, display_name, username, bio, avatar_url, genres, country, city';

/** scheduled | waiting (within 15 min of start) | live | ended | cancelled */
export function derivedState(show, now = Date.now()) {
  if (show.cancelled_at) return 'cancelled';
  if (show.actual_ended_at || show.state === 'ended') return 'ended';
  if (show.actual_started_at || show.state === 'live') return 'live';
  const slated = Date.parse(show.slated_at);
  const endsAt = show.ends_at ? Date.parse(show.ends_at) : slated + (show.duration_minutes || 60) * 60000;
  if (now > endsAt + 30 * 60000) return 'ended';
  if (slated - now <= 15 * 60000) return 'waiting';
  return 'scheduled';
}

export async function loadShowForViewer(admin, id) {
  const { data: show, error } = await admin.from('shows').select(SHOW_COLUMNS).eq('id', id).maybeSingle();
  if (error || !show) return { show: null, error };
  const ids = [show.artist_id, show.artist_b_id].filter(Boolean);
  let artists = [];
  if (ids.length) {
    const { data } = await admin.from('public_profiles').select(PUBLIC_PROFILE_COLUMNS).in('id', ids);
    artists = data || [];
  }
  const artist = artists.find((a) => a.id === show.artist_id) || null;
  const artistB = artists.find((a) => a.id === show.artist_b_id) || null;
  return { show: { ...show, derived_state: derivedState(show), artist, artist_b: artistB }, error: null };
}

export async function viewerCount(admin, showId) {
  const since = new Date(Date.now() - 45000).toISOString();
  const { data } = await admin.from('metering_events').select('viewer_id').eq('show_id', showId).gte('created_at', since).in('event', ['play', 'heartbeat', 'counted']).limit(2000);
  return new Set((data || []).map((r) => r.viewer_id)).size;
}

export async function openPrompt(admin, show) {
  const { data } = await admin.from('show_prompts').select('id, kind, body, options, pushed_at, closed_at, grace_seconds')
    .eq('show_id', show.id).not('pushed_at', 'is', null).order('pushed_at', { ascending: false }).limit(1);
  const p = data?.[0];
  if (!p) return null;
  if (p.closed_at && Date.parse(p.closed_at) + (p.grace_seconds || 15) * 1000 < Date.now()) return null;
  return p;
}
