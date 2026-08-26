import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin';
import { verifySession } from '../../../../lib/verifyArtistAuth';
import { BROLL_BUCKET, MAX_CLIP_BYTES, MAX_TOTAL_BYTES, brollObjectPath } from '../../../../lib/brollLimits';

// STEP 1 OF 2 — mint a signed upload URL. The bytes never come here.
//
// ── WHY THE OLD ROUTE HUNG ──────────────────────────────────────
// `app/api/broll/upload` (deleted) took the file as multipart form data
// and did this:
//
//     const form  = await request.formData();        // whole file into the function
//     const bytes = Buffer.from(await file.arrayBuffer());  // and again, a second copy
//     await admin.storage.from(BUCKET).upload(path, bytes); // then out again
//
// So every byte crossed the network twice — browser → function →
// Supabase — and sat in the function's memory twice while it did. The
// browser's POST stayed open for the whole of that, which is why the
// request showed as Pending: it genuinely was.
//
// It never resolved and never errored because a request body over the
// platform's limit is not rejected by our code — our code never runs.
// The request is refused at the edge before the handler is invoked, and
// a client `fetch()` in that situation can be left holding a connection
// that produces neither a response nor an error. Nothing in the route
// could have caught it, and no amount of error handling inside the
// handler would have helped.
//
// A second, independent problem with the same design: `fetch()` gives no
// upload progress. Even when it worked, "WORKING…" was the only thing
// the artist could be shown for a 50MB file.
//
// ── THE FIX ─────────────────────────────────────────────────────
// The browser uploads STRAIGHT TO STORAGE using a short-lived signed
// URL minted here. The function does two small JSON round trips and
// never touches a byte of video. That removes the body limit, the
// double transit, the memory, and the function duration from the
// problem entirely — and an XHR against the signed URL gives real
// progress events.
//
// AUTH MODEL: any signed-in account (`verifySession`). The path is
// SERVER-CHOSEN and namespaced under the caller's own user id — the
// client never proposes a path, so a signed URL can only ever write into
// the folder belonging to whoever asked for it.
//
// WHAT THIS ROUTE DOES *NOT* GUARANTEE, stated plainly: a signed upload
// URL carries no size limit of its own. The declared size is checked
// here to fail fast and politely, but a client that lied could still
// upload something larger. That is caught at registration, which reads
// the object's REAL size from storage and deletes it if it is over.
// Nothing is ever recorded on the strength of a client-declared size.

// Long enough for a slow connection to finish a 100MB clip, short enough
// that a leaked URL is not a standing write capability.
const SIGNED_UPLOAD_TTL_SECONDS = 60 * 30;

export async function POST(request) {
  try {
    const auth = await verifySession(request);
    if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
    if (auth.profile?.deactivated_at) {
      return NextResponse.json({ error: 'This account is closed.' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const declaredSize = Number(body.size);
    const contentType = String(body.contentType || '');
    const filename = String(body.filename || 'clip.mp4');

    if (!contentType.startsWith('video/')) {
      return NextResponse.json({ error: 'B-roll must be a video file.' }, { status: 400 });
    }
    if (!Number.isFinite(declaredSize) || declaredSize <= 0) {
      return NextResponse.json({ error: 'Could not read that file’s size.' }, { status: 400 });
    }
    if (declaredSize > MAX_CLIP_BYTES) {
      return NextResponse.json(
        { error: `That clip is ${Math.round(declaredSize / 1048576)}MB. The limit is ${Math.round(MAX_CLIP_BYTES / 1048576)}MB per clip.` },
        { status: 413 }
      );
    }

    const admin = getSupabaseAdmin();

    // Quota, checked here so an over-quota upload is refused BEFORE the
    // artist waits for 50MB to transfer. Re-checked at registration
    // against the real size, because this one trusts a number from a
    // browser and that one does not.
    const { data: existing, error: sumErr } = await admin
      .from('broll_clips')
      .select('size_bytes')
      .eq('artist_id', auth.user.id);
    if (sumErr) {
      const notMigrated = /relation .* does not exist|schema cache/i.test(sumErr.message || '');
      return NextResponse.json(
        { error: notMigrated ? 'B-roll needs docs/broll_migration.sql to be run first.' : `Could not check your storage — ${sumErr.message}` },
        { status: notMigrated ? 503 : 500 }
      );
    }
    const used = (existing || []).reduce((sum, r) => sum + (r.size_bytes || 0), 0);
    if (used + declaredSize > MAX_TOTAL_BYTES) {
      const leftMb = Math.max(0, Math.round((MAX_TOTAL_BYTES - used) / 1048576));
      return NextResponse.json(
        { error: `Not enough space — ${leftMb}MB left of your ${Math.round(MAX_TOTAL_BYTES / 1048576)}MB. Delete a clip first.` },
        { status: 413 }
      );
    }

    const path = brollObjectPath(auth.user.id, filename);

    const { data: signed, error: signErr } = await admin.storage
      .from(BROLL_BUCKET)
      .createSignedUploadUrl(path, { expiresIn: SIGNED_UPLOAD_TTL_SECONDS });

    if (signErr || !signed) {
      console.error('[broll/upload-url] signing failed:', signErr);
      return NextResponse.json({ error: `Could not start the upload — ${signErr?.message || 'no signed URL returned'}` }, { status: 500 });
    }

    return NextResponse.json({
      path,
      token: signed.token,
      // storage-js has returned this as both an absolute URL and a
      // project-relative path across versions. Both are passed through
      // and the client normalises, rather than this route guessing which
      // shape it got and being wrong on an upgrade.
      signedUrl: signed.signedUrl,
      contentType,
      expiresIn: SIGNED_UPLOAD_TTL_SECONDS,
    });
  } catch (err) {
    console.error('[broll/upload-url] request failed:', err);
    return NextResponse.json({ error: `Could not start the upload — ${String(err?.message || err)}` }, { status: 500 });
  }
}
