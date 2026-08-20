import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../../lib/supabaseAdmin';
import { verifyArtistAuth } from '../../../../../lib/verifyArtistAuth';

// Accounts & Identity Day 2 -- the actual privacy enforcement mechanism for
// recordings (docs/recordings_migration.sql's own header comment explains
// the split): RLS gates the `recordings` metadata row, THIS route gates the
// file itself, independently. The client never sees or stores a raw
// storage_path -- only a recording's `id`, exchanged here for a short-lived
// signed URL, generated via the service-role client (bypasses RLS/storage
// policies entirely, same as every other admin-client route in this app) --
// so no storage.objects RLS policy is needed for this bucket at all. Once
// the `recordings` bucket is set private in the dashboard (manual step, not
// done by any migration here), a bare object URL is unfetchable by anyone;
// only a signed URL minted through this route, after the checks below,
// works.
const SIGNED_URL_TTL_SECONDS = 60;
const BUCKET = process.env.LIVEKIT_S3_BUCKET || 'recordings';

export async function GET(request, { params }) {
  const { id } = params;
  const admin = getSupabaseAdmin();

  const { data: recording, error: fetchErr } = await admin
    .from('recordings')
    .select('id, artist_id, storage_path, visibility')
    .eq('id', id)
    .maybeSingle();
  if (fetchErr || !recording) {
    return NextResponse.json({ error: 'Recording not found' }, { status: 404 });
  }

  // Public recordings need no auth at all -- anyone (a visitor on the
  // public artist page, logged in or not) can play these.
  if (recording.visibility !== 'public') {
    const auth = await verifyArtistAuth(request);
    if (auth.error) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    if (auth.user.id !== recording.artist_id) {
      return NextResponse.json({ error: 'Not authorized to view this recording' }, { status: 403 });
    }
  }

  const { data: signed, error: signErr } = await admin.storage
    .from(BUCKET)
    .createSignedUrl(recording.storage_path, SIGNED_URL_TTL_SECONDS);
  if (signErr || !signed?.signedUrl) {
    console.error('[recordings/url] signing failed:', signErr);
    return NextResponse.json({ error: 'Could not generate playback URL' }, { status: 500 });
  }

  return NextResponse.json({ url: signed.signedUrl, expiresIn: SIGNED_URL_TTL_SECONDS });
}
