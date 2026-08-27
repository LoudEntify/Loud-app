import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin';
import { verifySession } from '../../../../lib/verifyArtistAuth';

// B-roll upload, service-role, matching the recordings pattern.
//
// WHY THIS ROUTE EXISTS: the first version uploaded straight from the
// browser with the anon+auth client -- both the storage object AND the
// broll_clips row. The recordings bucket deliberately has NO storage
// policies (recordings are signed server-side by the service role), so
// a client write to it was always going to be refused. That is the
// "new row violates row-level security policy" from the sitting.
//
// Now: the client sends the file here, the service role writes both the
// object and the row, and broll_clips has no direct-write policy at all.
// One writer, one place to enforce quota, and storage and the table can
// never disagree about what exists.
const BUCKET = process.env.LIVEKIT_S3_BUCKET || 'recordings';
const MAX_CLIP_BYTES = 100 * 1024 * 1024;
const MAX_TOTAL_BYTES = 500 * 1024 * 1024;

export async function POST(request) {
  try {
    const auth = await verifySession(request);
    if (auth.error) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const form = await request.formData();
    const file = form.get('file');
    if (!file || typeof file === 'string') {
      return NextResponse.json({ error: 'No file received.' }, { status: 400 });
    }
    if (!String(file.type || '').startsWith('video/')) {
      return NextResponse.json({ error: 'B-roll must be a video file.' }, { status: 400 });
    }
    if (file.size > MAX_CLIP_BYTES) {
      return NextResponse.json(
        { error: `That clip is ${Math.round(file.size / 1048576)}MB. The limit is 100MB per clip.` },
        { status: 413 }
      );
    }

    const admin = getSupabaseAdmin();

    // Quota is enforced HERE, not in the browser. The client also checks
    // it for a fast error message, but a check that only runs in a
    // browser is a suggestion.
    const { data: existing, error: sumErr } = await admin
      .from('broll_clips')
      .select('size_bytes')
      .eq('artist_id', auth.user.id);
    if (sumErr) {
      console.error('[broll/upload] quota read failed:', sumErr);
      return NextResponse.json({ error: `Could not check your storage — ${sumErr.message}` }, { status: 500 });
    }
    const used = (existing || []).reduce((sum, r) => sum + (r.size_bytes || 0), 0);
    if (used + file.size > MAX_TOTAL_BYTES) {
      const leftMb = Math.max(0, Math.round((MAX_TOTAL_BYTES - used) / 1048576));
      return NextResponse.json(
        { error: `Not enough space — ${leftMb}MB left of your 500MB. Delete a clip first.` },
        { status: 413 }
      );
    }

    const safeName = (file.name || 'clip.mp4').replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `broll/${auth.user.id}/${Date.now()}-${safeName}`;

    const bytes = Buffer.from(await file.arrayBuffer());
    const { error: upErr } = await admin.storage.from(BUCKET).upload(path, bytes, {
      contentType: file.type,
      upsert: false,
    });
    if (upErr) {
      console.error('[broll/upload] storage upload failed:', upErr);
      return NextResponse.json({ error: `Upload failed — ${upErr.message}` }, { status: 500 });
    }

    const { data: row, error: rowErr } = await admin
      .from('broll_clips')
      .insert({
        artist_id: auth.user.id,
        storage_path: path,
        title: (file.name || 'Untitled clip').replace(/\.[^.]+$/, ''),
        size_bytes: file.size,
      })
      .select()
      .single();

    if (rowErr) {
      // Roll the object back so storage and the table cannot disagree.
      await admin.storage.from(BUCKET).remove([path]);
      console.error('[broll/upload] row insert failed:', rowErr);
      return NextResponse.json(
        { error: /relation .* does not exist|schema cache/i.test(rowErr.message || '')
            ? 'B-roll needs docs/broll_migration.sql to be run first.'
            : `Could not save that clip — ${rowErr.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, clip: row });
  } catch (err) {
    console.error('[broll/upload] request failed:', err);
    return NextResponse.json({ error: `Request failed — ${String(err?.message || err)}` }, { status: 500 });
  }
}
