// GET /api/viewer/feed — Discover, in the order docs/USER_JOURNEY.md sets:
// live from artists you follow, live matching your genres, starting soon,
// clips and recordings. A fixed share of cards goes to new artists.
// Open (guests get a feed too) and rate-limited. The feed is computed here
// per request for now; the precomputed read model is Hardening work.
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin';
import { rateLimit, clientKey } from '../../../../lib/rateLimit';
import { correlationFrom, withCorrelation } from '../../../../lib/correlation';
import { optionalSession } from '../../../../lib/viewerAuth';
import { SHOW_COLUMNS, PUBLIC_PROFILE_COLUMNS, derivedState } from '../../../../lib/showPayload';

export const NEW_ARTIST_SHARE = 0.2;

export function orderFeed({ shows, recordings, followedIds, genres, profilesById }) {
  const now = Date.now();
  const live = shows.filter((s) => derivedState(s, now) === 'live');
  const soon = shows.filter((s) => ['waiting', 'scheduled'].includes(derivedState(s, now))).sort((a, b) => Date.parse(a.slated_at) - Date.parse(b.slated_at));
  const liveFollowed = live.filter((s) => followedIds.has(s.artist_id) || followedIds.has(s.artist_b_id));
  const liveGenre = live.filter((s) => !liveFollowed.includes(s) && genres.length && genres.includes(s.genre));
  const liveRest = live.filter((s) => !liveFollowed.includes(s) && !liveGenre.includes(s));
  const cards = [];
  for (const s of [...liveFollowed, ...liveGenre, ...liveRest]) cards.push({ kind: 'live', show: s });
  for (const s of soon.slice(0, 6)) cards.push({ kind: 'soon', show: s });
  for (const r of recordings) cards.push({ kind: 'recording', recording: r });
  // A fixed share of cards goes to new artists: move cards for artists who
  // joined in the last 30 days forward so at least that share of the first
  // ten cards is new artists, when there are any.
  const isNew = (c) => {
    const id = c.show?.artist_id || c.recording?.artist_id;
    const p = profilesById.get(id);
    return p && now - Date.parse(p.created_at) < 30 * 86400000;
  };
  const head = cards.slice(0, 10);
  const want = Math.ceil(head.length * NEW_ARTIST_SHARE);
  const haveNew = head.filter(isNew).length;
  if (haveNew < want) {
    const extra = cards.slice(10).filter(isNew).slice(0, want - haveNew);
    for (const e of extra) { cards.splice(cards.indexOf(e), 1); cards.splice(Math.min(cards.length, 3), 0, e); }
  }
  return cards;
}

export async function GET(request) {
  const cid = correlationFrom(request);
  const gate = rateLimit(clientKey(request, 'viewer-feed'), { limit: 120, windowMs: 60000 });
  if (!gate.ok) return withCorrelation(NextResponse.json({ error: 'Rate limited' }, { status: 429 }), cid);
  const admin = getSupabaseAdmin();
  const session = await optionalSession(request);
  const nowIso = new Date().toISOString();
  const windowStart = new Date(Date.now() - 4 * 3600000).toISOString();
  const windowEnd = new Date(Date.now() + 7 * 86400000).toISOString();
  const [{ data: shows, error }, { data: recordings }] = await Promise.all([
    admin.from('shows').select(SHOW_COLUMNS).eq('visibility', 'public').is('cancelled_at', null).gte('slated_at', windowStart).lte('slated_at', windowEnd).order('slated_at').limit(60),
    admin.from('recordings').select('id, show_id, artist_id, title, recorded_at, duration_ms, clip_start_ms, clip_end_ms').eq('visibility', 'public').order('recorded_at', { ascending: false }).limit(12),
  ]);
  if (error) return withCorrelation(NextResponse.json({ error: 'Could not load Discover.' }, { status: 503 }), cid);
  let followedIds = new Set();
  let genres = [];
  if (session.user) {
    const { data: f } = await admin.from('follows').select('artist_id').eq('follower_id', session.user.id);
    followedIds = new Set((f || []).map((r) => r.artist_id));
    genres = session.profile?.genres || [];
  }
  const ids = new Set();
  for (const s of shows || []) { if (s.artist_id) ids.add(s.artist_id); if (s.artist_b_id) ids.add(s.artist_b_id); }
  for (const r of recordings || []) ids.add(r.artist_id);
  const { data: profiles } = ids.size ? await admin.from('public_profiles').select(PUBLIC_PROFILE_COLUMNS + ', created_at').in('id', [...ids]) : { data: [] };
  const profilesById = new Map((profiles || []).map((p) => [p.id, p]));
  const attach = (s) => s && { ...s, derived_state: derivedState(s), artist: profilesById.get(s.artist_id) || null, artist_b: profilesById.get(s.artist_b_id) || null };
  const cards = orderFeed({ shows: shows || [], recordings: recordings || [], followedIds, genres, profilesById })
    .map((c) => (c.show ? { ...c, show: attach(c.show) } : { ...c, recording: { ...c.recording, artist: profilesById.get(c.recording.artist_id) || null } }));
  return withCorrelation(NextResponse.json({ cards, serverNow: nowIso, signedIn: Boolean(session.user) }), cid);
}
