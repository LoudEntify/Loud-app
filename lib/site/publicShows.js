// lib/site/publicShows.js — server-side reads for the public website
// (home live strip, What's on, the share page). Anon key through RLS:
// shows are public, artists through public_profiles. Every function
// returns { rows, error } so pages can show the error state honestly.
import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { SHOW_COLUMNS, PUBLIC_PROFILE_COLUMNS, derivedState } from '../showPayload';

function anon() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL; const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

async function attachArtists(sb, shows) {
  const ids = [...new Set(shows.flatMap((s) => [s.artist_id, s.artist_b_id]).filter(Boolean))];
  if (!ids.length) return shows.map((s) => ({ ...s, artist: null, artist_b: null }));
  const { data } = await sb.from('public_profiles').select(PUBLIC_PROFILE_COLUMNS).in('id', ids);
  const by = new Map((data || []).map((a) => [a.id, a]));
  return shows.map((s) => ({ ...s, artist: by.get(s.artist_id) || null, artist_b: by.get(s.artist_b_id) || null }));
}

/** Live now plus public shows scheduled in the next `days` days, oldest first. */
export async function publicSchedule({ days = 7, limit = 60 } = {}) {
  const sb = anon();
  if (!sb) return { rows: [], error: 'Site is not connected to a database' };
  const now = new Date();
  const until = new Date(now.getTime() + days * 86400000).toISOString();
  const since = new Date(now.getTime() - 3 * 3600000).toISOString(); // a show that started up to 3 h ago may still be live
  const { data, error } = await sb.from('shows').select(SHOW_COLUMNS)
    .or('visibility.eq.public,visibility.is.null').is('cancelled_at', null)
    .gte('slated_at', since).lte('slated_at', until)
    .order('slated_at', { ascending: true }).limit(limit);
  if (error) return { rows: [], error: error.message };
  const rows = (await attachArtists(sb, data || [])).map((s) => ({ ...s, derived_state: derivedState(s, now.getTime()) })).filter((s) => s.derived_state !== 'ended' && s.derived_state !== 'cancelled');
  return { rows, error: null };
}

export async function publicShow(id) {
  const sb = anon();
  if (!sb) return { show: null, error: 'Site is not connected to a database' };
  const { data, error } = await sb.from('shows').select(SHOW_COLUMNS).eq('id', id).maybeSingle();
  if (error) return { show: null, error: error.message };
  if (!data) return { show: null, error: null };
  const [show] = await attachArtists(sb, [data]);
  const { data: more } = await sb.from('shows').select('id, title, slated_at, actual_ended_at, state, cover_url').eq('artist_id', data.artist_id).neq('id', id).or('visibility.eq.public,visibility.is.null').order('slated_at', { ascending: false }).limit(2);
  return { show: { ...show, derived_state: derivedState(show) }, more: more || [], error: null };
}

export function whoLabel(show) {
  if (show.performance_mode === 'versus') return `${show.artist?.display_name || 'Artist A'} vs ${show.artist_b?.display_name || 'Artist B'}`;
  return show.artist?.display_name || show.artist_name || 'An artist';
}

export function dayBucket(iso, now = new Date()) {
  const d = new Date(iso); const today = new Date(now); today.setHours(0, 0, 0, 0);
  const diff = Math.floor((new Date(d).setHours(0, 0, 0, 0) - today.getTime()) / 86400000);
  if (diff <= 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
}
