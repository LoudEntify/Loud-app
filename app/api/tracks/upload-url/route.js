import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin';
import { verifySession } from '../../../../lib/verifyArtistAuth';
import { TRACK_BUCKET, MAX_TRACK_BYTES, looksLikeAudio, trackObjectPath, SHA256_RE } from '../../../../lib/trackLimits';
import { readQuota, notEnoughSpaceMessage, megabytes } from '../../../../lib/mediaQuota';

// STEP 1 OF 2 — mint a signed upload URL. The bytes never come here.
//
// PRD: Director Experience / Live Show (backing track)
// S&I: Stateless hosting (shared storage), Auth
//
// AUTH MODEL: any signed-in account (`verifySession`). The path is
// SERVER-CHOSEN and namespaced under the caller's own user id — the
// client never proposes a path, so a signed URL can only ever write
// into the folder belonging to whoever asked for it.
//
// This is deliberately the SAME two-step shape as
// app/api/broll/upload-url: browser uploads straight to storage against
// a short-lived signed URL, function does two small JSON round trips
// and never touches a byte. The reasoning is written out in full over
// there (the deleted /api/broll/upload put every byte through the
// function twice and hung); it applies identically here and is not
// repeated.
//
// WHAT THIS ROUTE DOES *NOT* GUARANTEE: a signed upload URL carries no
// size limit of its own. The declared size is checked here to fail fast
// and politely, but a client that lied could still upload something
// larger. That is caught at registration, which reads the object's REAL
// size from storage and deletes it if it is over.

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
    const filename = String(body.filename || 'track.mp3');
    const sha256 = String(body.sha256 || '');

    if (!looksLikeAudio(contentType)) {
      return NextResponse.json({ error: 'A backing track must be an audio file.' }, { status: 400 });
    }
    // ── THE HASH IS REQUIRED UP FRONT, NOT AT REGISTRATION ──────
    // Because it is the identity, and the identity is what makes an
    // uploaded track the same track as the local file the artist has
    // already been cueing against. A route that accepted an upload and
    // only then discovered it had no usable hash would have to either
    // orphan the object or invent one.
    if (!SHA256_RE.test(sha256)) {
      return NextResponse.json(
        { error: 'That upload did not carry a usable track hash. This is a client bug, not a bad file.' },
        { status: 400 }
      );
    }
    if (!Number.isFinite(declaredSize) || declaredSize <= 0) {
      return NextResponse.json({ error: 'Could not read that file’s size.' }, { status: 400 });
    }
    if (declaredSize > MAX_TRACK_BYTES) {
      return NextResponse.json(
        { error: `That track is ${megabytes(declaredSize)}MB. The limit is ${Math.round(MAX_TRACK_BYTES / 1048576)}MB per track.` },
        { status: 413 }
      );
    }

    const admin = getSupabaseAdmin();

    // ── ALREADY HAVE IT? ────────────────────────────────────────
    // Same artist, same bytes: no second upload and no second object.
    // Worth catching here rather than at registration because the point
    // is to skip the TRANSFER, and because an artist re-adding a track
    // they already have should look like success, not a duplicate.
    const { data: existingTrack } = await admin
      .from('backing_tracks')
      .select('id, storage_path, title, size_bytes')
      .eq('artist_id', auth.user.id)
      .eq('sha256', sha256)
      .maybeSingle();
    if (existingTrack) {
      return NextResponse.json({ alreadyHave: true, track: existingTrack });
    }

    // Quota, checked here so an over-quota upload is refused BEFORE the
    // artist waits for the transfer. Re-checked at registration against
    // the real size, because this one trusts a number from a browser
    // and that one does not.
    const quota = await readQuota(admin, auth.user.id);
    if (!quota.ok) {
      const missing = quota.missing;
      return NextResponse.json(
        { error: missing ? `Storage needs docs/${missing === 'broll_clips' ? 'broll_migration.sql' : 'mvp2_01_backing_tracks.sql'} to be run first.` : `Could not check your storage — ${quota.error}` },
        { status: missing ? 503 : 500 }
      );
    }
    if (quota.tracksTableMissing) {
      return NextResponse.json(
        { error: 'Backing-track uploads need docs/mvp2_01_backing_tracks.sql to be run first.' },
        { status: 503 }
      );
    }
    if (declaredSize > quota.remaining) {
      return NextResponse.json(
        { error: notEnoughSpaceMessage(quota, declaredSize, 'a clip or a track') },
        { status: 413 }
      );
    }

    const path = trackObjectPath(auth.user.id, filename);

    const { data: signed, error: signErr } = await admin.storage
      .from(TRACK_BUCKET)
      .createSignedUploadUrl(path, { expiresIn: SIGNED_UPLOAD_TTL_SECONDS });

    if (signErr || !signed) {
      console.error('[tracks/upload-url] signing failed:', signErr);
      return NextResponse.json({ error: `Could not start the upload — ${signErr?.message || 'no signed URL returned'}` }, { status: 500 });
    }

    return NextResponse.json({
      path,
      token: signed.token,
      // storage-js has returned this as both an absolute URL and a
      // project-relative path across versions. Both are passed through
      // and the client normalises, rather than this route guessing which
      // shape it got and being wrong on an upgrade. Same as b-roll.
      signedUrl: signed.signedUrl,
      contentType,
      expiresIn: SIGNED_UPLOAD_TTL_SECONDS,
    });
  } catch (err) {
    console.error('[tracks/upload-url] request failed:', err);
    return NextResponse.json({ error: 'Request failed' }, { status: 500 });
  }
}
