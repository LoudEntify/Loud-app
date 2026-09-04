import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin';
import { verifyArtistAuth } from '../../../../lib/verifyArtistAuth';

// Find an artist to invite into a Versus show.
//
// PRD: Director Experience / Live Show (Versus)
// S&I: Database, Auth
//
// ── WHY THIS EXISTS AT ALL ────────────────────────────────────
// Until now a Versus invite was a link the artist copied and sent over
// WhatsApp. That took the invitation off the platform, made the other
// artist accept somewhere else, and left no record of who invited whom.
// Selecting a person requires being able to find one, and nothing in the
// app could: the profiles search in lib/discoveryFeed.js is bound to the
// Discover feed's own paging and filters.
//
// ── WHY ARTIST-ONLY, AND WHY THAT IS NOT A PRIVACY DECISION ───
// It filters to role='artist' because a Versus slot is a performing
// slot and offering fans would be offering something that cannot be
// accepted. Nothing here exposes anything a signed-out visitor cannot
// already see on a public profile page — display name, username, avatar,
// genres. It is a narrower view of an already-public surface, not a
// wider one.
//
// ── WHAT IT DELIBERATELY DOES NOT RETURN ──────────────────────
// Email, date of birth, wallet, or anything else that would make this a
// people-lookup rather than a picker. The caller needs enough to
// recognise the right person and an id to invite them by.
export async function GET(request) {
  // Signed in AND an artist: only an artist can schedule a Versus, so
  // only an artist has any reason to search for a co-performer. This is
  // the same gate app/api/performer/invite already applies.
  const auth = await verifyArtistAuth(request);
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { searchParams } = new URL(request.url);
  const term = (searchParams.get('q') || '').trim();

  // Two characters, not one. A single letter matches most of the
  // directory and returns a list nobody can use; it is a wasted query
  // rather than a useful one.
  if (term.length < 2) return NextResponse.json({ artists: [] });

  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from('profiles')
      .select('id, username, display_name, avatar_url, genres')
      .eq('role', 'artist')
      // A closed account is not invitable. Same rule the Discover feed
      // applies — the closure flow promises to remove someone from the
      // public surface, and a picker is a public surface.
      .is('deactivated_at', null)
      // Never yourself. A Versus with one artist twice is not a state
      // worth having a rule about later.
      .neq('id', auth.user.id)
      .or(`display_name.ilike.%${term}%,username.ilike.%${term}%`)
      .order('display_name', { ascending: true })
      .limit(10);

    if (error) {
      console.error('[artists/search] query failed:', error);
      return NextResponse.json({ error: 'Search failed' }, { status: 500 });
    }

    return NextResponse.json({ artists: data ?? [] });
  } catch (err) {
    console.error('[artists/search] request failed:', err);
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}
