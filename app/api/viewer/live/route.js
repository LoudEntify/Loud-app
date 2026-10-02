// GET /api/viewer/live — the Live tab: live now (followed first), starting
// soon (next few hours), upcoming by day. Filters: following, solo/versus,
// genre. Open and rate-limited.
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin';
import { rateLimit, clientKey } from '../../../../lib/rateLimit';
import { correlationFrom, withCorrelation } from '../../../../lib/correlation';
import { optionalSession } from '../../../../lib/viewerAuth';
import { SHOW_COLUMNS, PUBLIC_PROFILE_COLUMNS, derivedState } from '../../../../lib/showPayload';

export async function GET(request) {
  const cid = correlationFrom(request);
  const gate = rateLimit(clientKey(request, 'viewer-live'), { limit: 120, windowMs: 60000 });
  if (!gate.ok) return withCorrelation(NextResponse.json({ error: 'Rate limited' }, { status: 429 }), cid);
  const url = new URL(request.url);
  const filter = url.searchParams.get('filter') || 'all';
  const genre = url.searchParams.get('genre');
  const admin = getSupabaseAdmin();
  const session = await optionalSession(request);
  const from = new Date(Date.now() - 4 * 3600000).toISOString();
  const to = new Date(Date.now() + 14 * 86400000).toISOString();
  let q = admin.from('shows').select(SHOW_COLUMNS).eq('visibility', 'public').is('cancelled_at', null).gte('slated_at', from).lte('slated_at', to).order('slated_at').limit(200);
  if (filter === 'solo' || filter === 'versus') q = q.eq('performance_mode', filter);
  if (genre) q = q.eq('genre', genre);
  const { data: shows, error } = await q;
  if (error) return withCorrelation(NextResponse.json({ error: 'Could not load Live.' }, { status: 503 }), cid);
  let followed = new Set();
  let reminded = new Set();
  if (session.user) {
    const [{ data: f }, { data: r }] = await Promise.all([
      admin.from('follows').select('artist_id').eq('follower_id', session.user.id),
      admin.from('show_reminders').select('show_id').eq('user_id', session.user.id),
    ]);
    followed = new Set((f || []).map((x) => x.artist_id));
    reminded = new Set((r || []).map((x) => x.show_id));
  }
  let list = shows || [];
  if (filter === 'following') list = list.filter((s) => followed.has(s.artist_id) || followed.has(s.artist_b_id));
  const ids = [...new Set(list.flatMap((s) => [s.artist_id, s.artist_b_id]).filter(Boolean))];
  const { data: profiles } = ids.length ? await admin.from('public_profiles').select(PUBLIC_PROFILE_COLUMNS).in('id', ids) : { data: [] };
  const byId = new Map((profiles || []).map((p) => [p.id, p]));
  const now = Date.now();
  const shaped = list.map((s) => ({ ...s, derived_state: derivedState(s, now), artist: byId.get(s.artist_id) || null, artist_b: byId.get(s.artist_b_id) || null, reminded: reminded.has(s.id), followed: followed.has(s.artist_id) }));
  const liveNow = shaped.filter((s) => s.derived_state === 'live').sort((a, b) => Number(b.followed) - Number(a.followed));
  const soon = shaped.filter((s) => s.derived_state !== 'live' && s.derived_state !== 'ended' && Date.parse(s.slated_at) - now < 4 * 3600000);
  const upcoming = shaped.filter((s) => s.derived_state !== 'live' && s.derived_state !== 'ended' && Date.parse(s.slated_at) - now >= 4 * 3600000);
  const genres = [...new Set(shaped.map((s) => s.genre).filter(Boolean))].sort();
  return withCorrelation(NextResponse.json({ liveNow, soon, upcoming, genres, serverNow: new Date(now).toISOString() }), cid);
}
