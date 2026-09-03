import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin';
import { verifySession } from '../../../../lib/verifyArtistAuth';
import { TRACK_BUCKET } from '../../../../lib/trackLimits';

// A short-lived signed URL to FETCH a track back.
//
// PRD: Director Experience / Live Show (backing track)
// S&I: Stateless hosting (shared storage), Auth
//
// AUTH MODEL: any signed-in account (`verifySession`), and the row is
// looked up BY ID SCOPED TO THE CALLER — `.eq('artist_id', auth.user.id)`
// — so an id belonging to someone else simply does not resolve. The
// bucket is private; a signed URL is the only way to read from it, and
// this is the only place one is minted for a track.
//
// ── THIS ROUTE IS WHAT REMOVES THE RE-PICK PROMPT ─────────────
// A locally picked file cannot be reopened after a reload without a
// fresh user gesture — that is a browser rule and no amount of server
// state changes it. An UPLOADED track has no such problem: the app
// fetches these bytes and decodes them itself. needsRepick() therefore
// narrows to local files only once this exists.

const SIGNED_DOWNLOAD_TTL_SECONDS = 60 * 60;

export async function GET(request) {
  try {
    const auth = await verifySession(request);
    if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const { searchParams } = new URL(request.url);
    const id = String(searchParams.get('id') || '');
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    const admin = getSupabaseAdmin();
    const { data: row, error } = await admin
      .from('backing_tracks')
      .select('id, storage_path, sha256, title, duration_ms')
      .eq('id', id)
      .eq('artist_id', auth.user.id)
      .maybeSingle();

    if (error) {
      console.error('[tracks/url] lookup failed:', error);
      return NextResponse.json({ error: 'Could not look up that track.' }, { status: 500 });
    }
    // Not found and not yours are answered identically on purpose: a
    // different message would confirm the existence of another artist's
    // row to anyone probing ids.
    if (!row) return NextResponse.json({ error: 'No such track.' }, { status: 404 });

    const { data: signed, error: signErr } = await admin.storage
      .from(TRACK_BUCKET)
      .createSignedUrl(row.storage_path, SIGNED_DOWNLOAD_TTL_SECONDS);

    if (signErr || !signed?.signedUrl) {
      console.error('[tracks/url] signing failed:', signErr);
      return NextResponse.json({ error: 'Could not open that track.' }, { status: 500 });
    }

    return NextResponse.json({
      url: signed.signedUrl,
      sha256: row.sha256,
      title: row.title,
      durationMs: row.duration_ms,
      expiresIn: SIGNED_DOWNLOAD_TTL_SECONDS,
    });
  } catch (err) {
    console.error('[tracks/url] request failed:', err);
    return NextResponse.json({ error: 'Request failed' }, { status: 500 });
  }
}
