import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin';
import { verifySession } from '../../../../lib/verifyArtistAuth';

// B-roll delete, service-role. Ownership is checked here because RLS no
// longer permits a direct client delete -- there is exactly one writer.
const BUCKET = process.env.LIVEKIT_S3_BUCKET || 'recordings';

export async function POST(request) {
  try {
    const auth = await verifySession(request);
    if (auth.error) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { id } = await request.json();
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    const admin = getSupabaseAdmin();
    const { data: clip } = await admin
      .from('broll_clips')
      .select('id, artist_id, storage_path')
      .eq('id', id)
      .maybeSingle();

    if (!clip) return NextResponse.json({ error: 'Clip not found' }, { status: 404 });
    if (clip.artist_id !== auth.user.id) {
      return NextResponse.json({ error: 'Not your clip' }, { status: 403 });
    }

    // Object first, then the row. This order leaves an orphaned ROW if
    // the second step fails, which is visible and fixable; the reverse
    // leaves an orphaned FILE, which is invisible and eats quota.
    const { error: rmErr } = await admin.storage.from(BUCKET).remove([clip.storage_path]);
    if (rmErr) console.error('[broll/delete] storage remove failed:', rmErr);

    const { error: delErr } = await admin.from('broll_clips').delete().eq('id', id);
    if (delErr) {
      console.error('[broll/delete] row delete failed:', delErr);
      return NextResponse.json({ error: `Could not delete that clip — ${delErr.message}` }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[broll/delete] request failed:', err);
    return NextResponse.json({ error: `Request failed — ${String(err?.message || err)}` }, { status: 500 });
  }
}
