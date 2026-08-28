'use client';

// lib/follows.js
// ─────────────────────────────────────────────────────────────
// Following an artist. Goes straight through the anon client under RLS
// (docs/overnight2_03_follows.sql) — no API route, because there is
// nothing here a server needs to decide: the policies say a person may
// only ever create and delete their own follows, and that is the whole
// rule.
//
// Every function degrades to "not available" rather than throwing if the
// table has not been created yet. A missing relation reads as PostgREST
// 42P01, which is checked for explicitly rather than swallowed with the
// rest — a network failure and an unmigrated database should not look
// the same to a caller.
// ─────────────────────────────────────────────────────────────

import { getSupabase } from './supabaseClient';

function isMissingTable(error) {
  if (!error) return false;
  if (error.code === '42P01' || error.code === 'PGRST205') return true;
  const msg = String(error.message || '').toLowerCase();
  return msg.includes('relation') && msg.includes('does not exist');
}

/** Artist ids this user follows. Empty set when unavailable. */
export async function fetchFollowedArtistIds(userId) {
  if (!userId) return { ids: new Set(), supported: true };
  try {
    const { data, error } = await getSupabase()
      .from('follows')
      .select('artist_id')
      .eq('follower_id', userId);
    if (error) return { ids: new Set(), supported: !isMissingTable(error) };
    return { ids: new Set((data || []).map((r) => r.artist_id)), supported: true };
  } catch {
    return { ids: new Set(), supported: true };
  }
}

/**
 * Follow. Upsert with ignoreDuplicates so a double tap — or a tap on a
 * button whose state hadn't refreshed — is a no-op rather than a 409 the
 * UI has to interpret.
 *
 * The conflict target is the composite primary key, which is a plain
 * (non-partial) index and therefore inferrable. See the note in
 * docs/overnight2_03_follows.sql.
 */
export async function followArtist(userId, artistId) {
  if (!userId || !artistId || userId === artistId) return { ok: false };
  try {
    const { error } = await getSupabase()
      .from('follows')
      .upsert({ follower_id: userId, artist_id: artistId }, { onConflict: 'follower_id,artist_id', ignoreDuplicates: true });
    if (error) return { ok: false, supported: !isMissingTable(error), error };
    return { ok: true, supported: true };
  } catch (error) {
    return { ok: false, supported: true, error };
  }
}

export async function unfollowArtist(userId, artistId) {
  if (!userId || !artistId) return { ok: false };
  try {
    const { error } = await getSupabase()
      .from('follows')
      .delete()
      .eq('follower_id', userId)
      .eq('artist_id', artistId);
    if (error) return { ok: false, supported: !isMissingTable(error), error };
    return { ok: true, supported: true };
  } catch (error) {
    return { ok: false, supported: true, error };
  }
}

/**
 * Artists worth suggesting to a new fan.
 *
 * Genre-matched first, then anyone. Deliberately NOT ranked by follower
 * count or play count: this platform is young enough that such a ranking
 * would be a handful of accounts shown to everyone forever, which is how
 * a new artist never gets a first listener. Newest-first with a genre
 * filter gives a new fan something relevant AND gives a new artist a
 * genuine chance of appearing.
 *
 * Excludes the caller, so a fan who is also an artist is never suggested
 * to themselves.
 */
export async function suggestedArtists({ userId, genres = [], limit = 12 }) {
  const supabase = getSupabase();
  const pick = 'id, display_name, username, genres, avatar_url, bio';

  // Same two-pass shape as lib/discoveryFeed.js, for the same reason:
  // naming `deactivated_at` before its migration has run 400s the query
  // rather than returning rows, so the correct query is tried first and
  // the pre-migration one is the fallback.
  async function query(withGenres, withDeactivationFilter = true) {
    let q = supabase.from('profiles').select(pick).eq('role', 'artist').limit(limit);
    if (userId) q = q.neq('id', userId);
    if (withDeactivationFilter) q = q.is('deactivated_at', null);
    if (withGenres && genres.length) q = q.overlaps('genres', genres);
    const { data, error } = await q.order('created_at', { ascending: false });
    if (error) {
      const msg = String(error.message || '').toLowerCase();
      const missingColumn = error.code === '42703' || error.code === 'PGRST204' ||
        (msg.includes('column') && (msg.includes('does not exist') || msg.includes('schema cache')));
      if (missingColumn && withDeactivationFilter) return query(withGenres, false);
      return null;
    }
    return data || [];
  }

  const matched = genres.length ? await query(true) : null;
  if (matched && matched.length >= 3) return matched;

  // Top up from everyone rather than showing a fan two suggestions and a
  // lot of white space. Merge, don't replace — the genre matches keep
  // their position at the top, where they belong.
  const all = (await query(false)) || [];
  const seen = new Set((matched || []).map((a) => a.id));
  return [...(matched || []), ...all.filter((a) => !seen.has(a.id))].slice(0, limit);
}
