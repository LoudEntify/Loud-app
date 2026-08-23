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
    subtitle: (row.performance_mode || 'solo').toUpperCase(),
    href: '/live',
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
 * Artists, paged. Returns { items, nextPage } -- nextPage is null when
 * the source is exhausted, which is what stops an infinite scroller
 * asking forever.
 */
export async function fetchArtistsPage({ page = 0, query = '', genre = 'ALL' } = {}) {
  try {
    let q = getSupabase()
      .from('profiles')
      .select('id, display_name, username, genres, avatar_url')
      .eq('role', 'artist')
      .order('created_at', { ascending: false })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

    // Server-side filtering so paging stays correct. Filtering after the
    // fetch would make each page a different size and eventually skip
    // matches entirely.
    const term = query.trim();
    if (term) q = q.or(`display_name.ilike.%${term}%,username.ilike.%${term}%`);
    if (genre && genre !== 'ALL') q = q.contains('genres', [genre]);

    const { data, error } = await q;
    if (error) return { items: [], nextPage: null };
    const items = (data || []).map(artistItem);
    return { items, nextPage: items.length < PAGE_SIZE ? null : page + 1 };
  } catch {
    return { items: [], nextPage: null };
  }
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
