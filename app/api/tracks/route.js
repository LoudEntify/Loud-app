import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { verifySession } from '../../../lib/verifyArtistAuth';
import { SHA256_RE } from '../../../lib/trackLimits';
import { readQuota, isMissingRelation } from '../../../lib/mediaQuota';

// THE ARTIST'S TRACK LIBRARY, and the hash lookup that replaces the
// re-pick prompt.
//
// PRD: Director Experience / Live Show (backing track)
// S&I: Database, Auth
//
// AUTH MODEL: any signed-in account (`verifySession`). Every query below
// is scoped to `auth.user.id` and never to a parameter — there is no way
// to ask this for somebody else's library because there is nothing to
// ask with. That is the same lesson the cue-sheets IDOR taught in the
// 2026-08-28 security round: the route verified the caller and then
// trusted an artist_email from the query string.
//
// ── ?sha256= IS THE INTERESTING ONE ───────────────────────────
// It answers "the show_session_state row names this track — do I have an
// uploaded copy I can just fetch?" That single question is what removes
// the re-pick path for uploaded tracks: when the answer is yes, the app
// re-loads the audio itself instead of asking the artist to find the
// file again. Scoped to (artist_id, sha256), which is exactly the unique
// index in docs/mvp2_01_backing_tracks.sql.

export async function GET(request) {
  try {
    const auth = await verifySession(request);
    if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const { searchParams } = new URL(request.url);
    const sha256 = String(searchParams.get('sha256') || '');
    const admin = getSupabaseAdmin();

    let query = admin
      .from('backing_tracks')
      .select('id, storage_path, sha256, title, original_filename, size_bytes, duration_ms, created_at')
      .eq('artist_id', auth.user.id);

    if (sha256) {
      if (!SHA256_RE.test(sha256)) {
        return NextResponse.json({ error: 'Invalid sha256' }, { status: 400 });
      }
      query = query.eq('sha256', sha256).limit(1);
    } else {
      query = query.order('created_at', { ascending: false }).limit(200);
    }

    const { data, error } = await query;

    if (error) {
      // Not migrated is reported as an empty library rather than an
      // error, deliberately: the deck must keep working on a deployment
      // where mvp2_01 has not been run, exactly as it did before this
      // round existed. Local file selection is unaffected by any of it.
      if (isMissingRelation(error)) {
        return NextResponse.json({ tracks: [], notMigrated: true, quota: null });
      }
      console.error('[tracks] list failed:', error);
      return NextResponse.json({ error: 'Could not read your tracks.' }, { status: 500 });
    }

    // The hash lookup answers with one track or null — a shape the
    // caller can branch on without inspecting an array.
    if (sha256) {
      return NextResponse.json({ track: (data || [])[0] || null });
    }

    const quota = await readQuota(admin, auth.user.id);
    return NextResponse.json({ tracks: data || [], quota: quota.ok ? quota : null });
  } catch (err) {
    console.error('[tracks] request failed:', err);
    return NextResponse.json({ error: 'Request failed' }, { status: 500 });
  }
}
