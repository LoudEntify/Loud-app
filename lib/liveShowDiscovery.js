import { getSupabase } from './supabaseClient.js';
import { effectiveState } from './showState.js';

const POSTER_COLORS = ['#2ec4b6', '#e71d36', '#ff9f1c', '#5b5fef', '#9b5de5'];
export const DISCOVERY_SWIPE = Object.freeze({ minPx: 72, axisRatio: 1.3, maxMs: 900 });

function colorFor(id = '') {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
  return POSTER_COLORS[Math.abs(hash) % POSTER_COLORS.length];
}

export function showHref(showId) {
  return `/live?show=${encodeURIComponent(showId)}`;
}

export function targetForDiscoverySwipe(shows, { dx, dy, elapsedMs }) {
  if (!Array.isArray(shows) || !shows.length) return null;
  if (elapsedMs > DISCOVERY_SWIPE.maxMs) return null;
  if (Math.abs(dx) < DISCOVERY_SWIPE.minPx) return null;
  if (Math.abs(dx) < Math.abs(dy) * DISCOVERY_SWIPE.axisRatio) return null;
  return dx < 0 ? shows[0] : shows[shows.length - 1];
}

// "Live" is derived in this product, never stored: only soundcheck rows
// whose slated time has passed and whose duration window remains open
// qualify. effectiveState is the final authority, so abandoned rows
// cannot remain advertised forever.
export async function getAdjacentLiveShows(currentShowId, now = Date.now()) {
  try {
    let query = getSupabase()
      .from('shows')
      .select('id,artist_id,artist_name,title,slated_at,duration_minutes,ends_at,state,actual_started_at')
      .eq('state', 'soundcheck')
      .lte('slated_at', new Date(now).toISOString())
      .order('slated_at', { ascending: false })
      .limit(16);
    if (currentShowId) query = query.neq('id', currentShowId);

    const { data, error } = await query;
    if (error) throw error;
    const live = (data || []).filter((show) => effectiveState(show, now) === 'live');
    if (!live.length) return [];

    const artistIds = [...new Set(live.map((show) => show.artist_id).filter(Boolean))];
    let profiles = [];
    if (artistIds.length) {
      const result = await getSupabase()
        .from('profiles')
        .select('id,display_name,username,avatar_url')
        .in('id', artistIds);
      profiles = result.data || [];
    }
    const profileById = new Map(profiles.map((profile) => [profile.id, profile]));

    return live.map((show) => {
      const profile = profileById.get(show.artist_id);
      return {
        id: show.id,
        artistName: profile?.display_name || profile?.username || show.artist_name || 'Live artist',
        showTitle: show.title || 'Live now',
        avatarUrl: profile?.avatar_url || null,
        posterColor: colorFor(show.id),
      };
    });
  } catch (error) {
    console.warn('[live-show-discovery] could not load live shows', error);
    return [];
  }
}

// A passed navigator keeps this shared between desktop and a future
// mobile swipe surface. The browser fallback also works outside React.
export function switchToLiveShow(showId, navigate) {
  if (!showId) return false;
  const href = showHref(showId);
  if (typeof navigate === 'function') navigate(href);
  else if (typeof window !== 'undefined') window.location.assign(href);
  return true;
}
