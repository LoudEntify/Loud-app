// GET /api/viewer/search?q= — artists first, then shows, then genres; with
// near spellings and the closest genre when nothing matches (PRD row 97:
// "never dead-ends"). Open and rate-limited. Search history lives on the
// device, not here (guests get search without saved history).
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin';
import { rateLimit, clientKey } from '../../../../lib/rateLimit';
import { correlationFrom, withCorrelation } from '../../../../lib/correlation';
import { SHOW_COLUMNS, PUBLIC_PROFILE_COLUMNS, derivedState } from '../../../../lib/showPayload';
import { GENRES } from '../../../../lib/genres';

export function levenshtein(a, b) {
  a = a.toLowerCase(); b = b.toLowerCase();
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
export function nearSpellings(q, candidates, max = 3) {
  const s = q.trim().toLowerCase();
  if (!s) return [];
  return candidates
    .map((c) => ({ c, d: levenshtein(s, c) }))
    .filter((x) => x.d > 0 && x.d <= Math.max(1, Math.floor(s.length / 3)))
    .sort((a, b) => a.d - b.d).slice(0, max).map((x) => x.c);
}

export async function GET(request) {
  const cid = correlationFrom(request);
  const gate = rateLimit(clientKey(request, 'viewer-search'), { limit: 120, windowMs: 60000 });
  if (!gate.ok) return withCorrelation(NextResponse.json({ error: 'Rate limited' }, { status: 429 }), cid);
  const q = (new URL(request.url).searchParams.get('q') || '').trim().slice(0, 60);
  const admin = getSupabaseAdmin();
  const like = `%${q.replace(/[%_]/g, '')}%`;
  const [{ data: artists }, { data: shows }, { data: liveShows }] = await Promise.all([
    q ? admin.from('public_profiles').select(PUBLIC_PROFILE_COLUMNS).eq('role', 'artist').or(`display_name.ilike.${like},username.ilike.${like}`).limit(20) : { data: [] },
    q ? admin.from('shows').select(SHOW_COLUMNS).eq('visibility', 'public').is('cancelled_at', null).or(`title.ilike.${like},genre.ilike.${like}`).gte('slated_at', new Date(Date.now() - 4 * 3600000).toISOString()).order('slated_at').limit(20) : { data: [] },
    admin.from('shows').select(SHOW_COLUMNS).eq('visibility', 'public').is('cancelled_at', null).not('actual_started_at', 'is', null).is('actual_ended_at', null).order('actual_started_at', { ascending: false }).limit(6),
  ]);
  const genreList = GENRES.map((g) => (typeof g === 'string' ? g : g.label || g.name || String(g)));
  const genres = q ? genreList.filter((g) => g.toLowerCase().includes(q.toLowerCase())) : genreList;
  const ids = [...new Set([...(shows || []), ...(liveShows || [])].flatMap((s) => [s.artist_id, s.artist_b_id]).filter(Boolean))];
  const { data: profiles } = ids.length ? await admin.from('public_profiles').select(PUBLIC_PROFILE_COLUMNS).in('id', ids) : { data: [] };
  const byId = new Map((profiles || []).map((p) => [p.id, p]));
  const shape = (s) => ({ ...s, derived_state: derivedState(s), artist: byId.get(s.artist_id) || null, artist_b: byId.get(s.artist_b_id) || null });
  const results = { artists: artists || [], shows: (shows || []).map(shape), genres, liveNow: (liveShows || []).map(shape) };
  const nothing = q && !results.artists.length && !results.shows.length && !results.genres.length;
  const suggestions = nothing ? { spellings: nearSpellings(q, [...genreList, ...(await artistNames(admin))]), nearestGenre: nearest(q, genreList) } : null;
  return withCorrelation(NextResponse.json({ q, results, suggestions }), cid);
}
async function artistNames(admin) {
  const { data } = await admin.from('public_profiles').select('display_name').eq('role', 'artist').limit(500);
  return (data || []).map((p) => p.display_name).filter(Boolean);
}
function nearest(q, list) {
  let best = null, bd = Infinity;
  for (const g of list) { const d = levenshtein(q, g); if (d < bd) { bd = d; best = g; } }
  return best;
}
