import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin';
import { verifyArtistAuth } from '../../../../lib/verifyArtistAuth';

// Signed playback URLs for B-roll, mirroring
// app/api/recordings/[id]/url/route.js exactly -- same private bucket,
// same service-role signing, same short TTL. B-roll is working material
// with no public visibility flag, so ownership is the whole check: a
// clip is only ever signed for the artist who owns the row.
// Same env var recordings uses, so both live in one bucket by config
// rather than by coincidence.
const BUCKET = process.env.LIVEKIT_S3_BUCKET || 'recordings';
const SIGNED_URL_TTL_SECONDS = 60 * 60;

export async function GET(request) {
  const auth = await verifyArtistAuth(request);
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  try {
    const admin = getSupabaseAdmin();
    const { data: clip, error } = await admin
      .from('broll_clips')
      .select('id, artist_id, storage_path')
      .eq('id', id)
      .maybeSingle();

    if (error || !clip) {
      return NextResponse.json({ error: 'Clip not found' }, { status: 404 });
    }
    if (clip.artist_id !== auth.user.id) {
      return NextResponse.json({ error: 'Not your clip' }, { status: 403 });
    }

    const { data: signed, error: signErr } = await admin.storage
      .from(BUCKET)
      .createSignedUrl(clip.storage_path, SIGNED_URL_TTL_SECONDS);

    if (signErr || !signed?.signedUrl) {
      console.error('[broll/url] signing failed:', signErr);
      return NextResponse.json({ error: 'Could not generate playback URL' }, { status: 500 });
    }

    return NextResponse.json({ url: signed.signedUrl, expiresIn: SIGNED_URL_TTL_SECONDS });
  } catch (err) {
    console.error('[broll/url] request failed:', err);
    return NextResponse.json({ error: 'Request failed' }, { status: 500 });
  }
}
