'use client';

// lib/discoveryFeed.js
// ─────────────────────────────────────────────────────────────
// The discovery feed source.
//
// Deliberately a PAGED SOURCE returning a flat, uniform item shape --
// not a component's private fetch. The mobile swipe-discovery surface
// that comes later is the same sequence of items consumed one at a time
// instead of scrolled, so it must be able to call exactly this and get
// exactly this shape. A component that queried Supabase inline would
// have forced that surface to reimplement paging, filtering and ordering
// and then drift from it.
//
// Every item, whatever its kind, carries: id, kind, title, subtitle,
// href, and the raw row. A consumer that only knows those five fields
// can render the whole feed.
// ─────────────────────────────────────────────────────────────

import { getSupabase } from './supabaseClient';

export const PAGE_SIZE = 24;

// Above this many items a list stops reading as a line-up and starts
// reading as a wall of text, so the layout flips to a grid.
//
// 50 is the brief's number and it holds up: a grid needs roughly a dozen
// items before it stops looking sparse, and a list stays scannable well
// past that -- so anywhere in the 30-60 range is defensible and there is
// no reason to argue with the stated one. Narrow viewports never flip
// (see shouldUseGrid): a two-column grid of thumbnails is worse than a
// list on a phone at any count.
export const GRID_THRESHOLD = 50;
export const GRID_MIN_VIEWPORT = 700;

export function shouldUseGrid(itemCount, viewportWidth) {
  if (typeof viewportWidth === 'number' && viewportWidth < GRID_MIN_VIEWPORT) return false;
  return itemCount >= GRID_THRESHOLD;
}

function artistItem(row) {
  const name = row.display_name || row.username || 'Artist';
  return {
    id: `artist:${row.id}`,
    kind: 'artist',
    title: name,
    subtitle: [row.username ? `@${row.username}` : null, (row.genres || []).join(' · ') || null]
      .filter(Boolean)
      .join(' · '),
    href: `/artist/${row.id}`,
    genres: row.genres || [],
    row,
  };
}

function showItem(row) {
  return {
    id: `show:${row.id}`,
    kind: 'live',
    title: row.title || 'Live show',
    subtitle: [row.artist_name || null, (row.performance_mode || 'solo').toUpperCase()]
      .filter(Boolean)
      .join(' · '),
    // The show's own id, not a bare '/live'. Discover lists N live shows;
    // a link with no id could only ever have taken you to one of them,
    // and until this round /live resolved to a hardcoded room regardless
    // of which card you tapped.
    href: `/live?show=${row.id}`,
    genres: [],
    row,
  };
}

/**
 * Live shows: soundcheck rows whose slated time has passed.
 *
 * Not paged -- "who is on right now" is a small, bounded set by nature,
 * and paginating it would imply otherwise.
 */
export async function fetchLiveShows() {
  try {
    // select('*') on purpose: title/performance_mode only exist after the
    // scheduling migration, and naming them would 400 the query before it.
    const { data, error } = await getSupabase()
      .from('shows')
      .select('*')
      .eq('state', 'soundcheck')
      .limit(30);
    if (error) return [];
    const now = Date.now();
    return (data || [])
      .filter((s) => new Date(s.slated_at).getTime() <= now)
      .map(showItem);
  } catch {
    return [];
  }
}

/**
 * Shows that have not happened yet.
 *
 * Phase 4g. Discover has always been able to say who is on RIGHT NOW,
 * which is only useful to someone who happens to open the app at the
 * right moment. "Who is on later" is what turns a page you check into a
 * page you come back to, and the scheduling data to answer it has existed
 * since shows got a `slated_at`.
 *
 * Not paged, for the same reason as fetchLiveShows: a young platform's
 * diary is a small, bounded set, and paginating it would imply otherwise.
 */
export async function fetchUpcomingShows({ limit = 20 } = {}) {
  try {
    // select('*') on purpose — title/performance_mode/cancelled_at each
    // arrive with a different hand-run migration, and NAMING a column
    // that does not exist yet 400s the whole query rather than returning
    // null for it.
    const { data, error } = await getSupabase()
      .from('shows')
      .select('*')
      .neq('state', 'ended')
      .order('slated_at', { ascending: true })
      .limit(limit * 2); // over-fetch, because the filters below are client-side
    if (error) return [];
    const now = Date.now();
    return (data || [])
      // Strictly in the future. A show whose start time has passed is
      // either live (and belongs in the section above) or was never
      // started, and neither is "upcoming".
      .filter((s) => s.slated_at && new Date(s.slated_at).getTime() > now)
      // Cancelled shows — including every show belonging to a closed
      // account — are not upcoming. `cancelled_at` may not exist yet, in
      // which case this filter is simply always true.
      .filter((s) => !s.cancelled_at)
      .slice(0, limit)
      .map(upcomingItem);
  } catch {
    return [];
  }
}

function upcomingItem(row) {
  const when = row.slated_at ? new Date(row.slated_at) : null;
  return {
    id: `upcoming:${row.id}`,
    kind: 'upcoming',
    title: row.title || 'Untitled show',
    subtitle: [
      row.artist_name || null,
      when ? when.toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : null,
    ].filter(Boolean).join(' · '),
    // The link works before the show starts: /live shows a holding
    // screen with a countdown and connects nothing until the broadcast
    // window opens (lib/scheduling.js's rule). So an upcoming card is a
    // real destination, not a dead link with a date on it.
    href: `/live?show=${row.id}`,
    slatedAt: row.slated_at,
    genres: [],
    row,
  };
}

/**
 * Artists, paged. Returns { items, nextPage } -- nextPage is null when
 * the source is exhausted, which is what stops an infinite scroller
 * asking forever.
 */
export async function fetchArtistsPage({ page = 0, query = '', genre = 'ALL' } = {}) {
  // Built twice, once with the closed-account filter and once without.
  //
  // `profiles.deactivated_at` arrives with a migration that is run by
  // hand (docs/overnight2_02_profiles.sql). Naming a column that does not
  // exist yet does not return zero rows — it 400s the whole query, which
  // would empty Discover completely on an unmigrated database. So: try
  // the correct query, and fall back to the pre-migration one, where the
  // worst case is that a closed account is still listed because closing
  // accounts is not switched on either.
  function build(withDeactivationFilter) {
    let q = getSupabase()
      .from('profiles')
      .select('id, display_name, username, genres, avatar_url')
      .eq('role', 'artist')
      .order('created_at', { ascending: false })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

    // A closed account is not browsable. This is the public surface the
    // closure flow promises to remove someone from.
    if (withDeactivationFilter) q = q.is('deactivated_at', null);

    // Server-side filtering so paging stays correct. Filtering after the
    // fetch would make each page a different size and eventually skip
    // matches entirely.
    const term = query.trim();
    if (term) q = q.or(`display_name.ilike.%${term}%,username.ilike.%${term}%`);
    if (genre && genre !== 'ALL') q = q.contains('genres', [genre]);
    return q;
  }

  try {
    let { data, error } = await build(true);
    if (error && isMissingColumn(error)) ({ data, error } = await build(false));
    if (error) return { items: [], nextPage: null };
    const items = (data || []).map(artistItem);
    return { items, nextPage: items.length < PAGE_SIZE ? null : page + 1 };
  } catch {
    return { items: [], nextPage: null };
  }
}

// PostgREST reports an unknown column as 42703 (or PGRST204 through the
// schema cache). The message check is a belt-and-braces fallback for
// older/newer error shapes.
function isMissingColumn(error) {
  if (!error) return false;
  if (error.code === '42703' || error.code === 'PGRST204') return true;
  const msg = String(error.message || '').toLowerCase();
  return msg.includes('column') && (msg.includes('does not exist') || msg.includes('schema cache'));
}

/** Genre chips built from what artists actually perform. */
export async function fetchGenreFacets() {
  try {
    const { data, error } = await getSupabase()
      .from('profiles')
      .select('genres')
      .eq('role', 'artist')
      .limit(500);
    if (error) return [];
    return Array.from(new Set((data || []).flatMap((r) => r.genres || []))).sort();
  } catch {
    return [];
  }
}
