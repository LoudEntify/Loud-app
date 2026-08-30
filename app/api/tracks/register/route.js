import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin';
import { verifySession } from '../../../../lib/verifyArtistAuth';
import { TRACK_BUCKET, MAX_TRACK_BYTES, isOwnTrackPath, titleFromFilename, SHA256_RE } from '../../../../lib/trackLimits';
import { readQuota, notEnoughSpaceMessage, megabytes } from '../../../../lib/mediaQuota';

// STEP 2 OF 2 — the row is written HERE, and only once the file exists.
//
// PRD: Director Experience / Live Show (backing track)
// S&I: Database, Stateless hosting (shared storage), Auth
//
// AUTH MODEL: any signed-in account (`verifySession`), plus a path
// ownership check — the caller may only register an object that lives
// under its own user id prefix. That check is what stops one account
// registering another account's uploaded object as its own.
//
// The order matters and is the point of splitting the flow: the track
// is registered AFTER the bytes have landed, so a failed or abandoned
// upload leaves a stray object at worst, never a library entry pointing
// at nothing. An artist selecting a track that does not exist mid-show
// is a far worse failure than an orphaned object nobody can see.
//
// ── EVERY NUMBER HERE COMES FROM STORAGE, NOT FROM THE CLIENT ──
// The browser told upload-url how big the file was so it could be
// refused politely before the transfer. That number is a courtesy and
// is not trusted again:
//
//   * over the per-track limit -> object deleted, refused
//   * over the shared quota    -> object deleted, refused
//
// ── THE HASH IS THE ONE THING STORAGE CANNOT TELL US ──────────
// It is computed in the browser from the same File the upload sent
// (lib/trackHash.js), and it is what makes an uploaded track the same
// track as the local file the artist already has cue sheets for. It is
// format-checked here and again by the column's own CHECK constraint,
// because a malformed hash does not fail loudly — it silently stops cue
// sheets matching, which takes a show to notice.
//
// Trusting a client-supplied hash is a deliberate, bounded decision: the
// worst a lying client can do is mis-key its OWN track, in its OWN
// library, against its OWN cue sheets. It cannot reach another artist's
// rows — RLS and the artist_id scoping below see to that — so verifying
// it server-side would mean downloading every upload back out of storage
// to re-hash it, which is the byte-through-the-function cost this whole
// two-step design exists to avoid.

export async function POST(request) {
  try {
    const auth = await verifySession(request);
    if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
    if (auth.profile?.deactivated_at) {
      return NextResponse.json({ error: 'This account is closed.' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const path = String(body.path || '');
    const sha256 = String(body.sha256 || '');
    const filename = String(body.filename || '');
    const durationMs = Number.isFinite(Number(body.durationMs)) ? Math.round(Number(body.durationMs)) : null;
    const title = String(body.title || '').trim() || titleFromFilename(filename);

    // THE OWNERSHIP CHECK. The path was server-chosen at step 1, but
    // this route is a separate request and must not assume the caller is
    // the one who asked for it.
    if (!isOwnTrackPath(path, auth.user.id)) {
      return NextResponse.json({ error: 'That is not your upload.' }, { status: 403 });
    }
    if (!SHA256_RE.test(sha256)) {
      return NextResponse.json({ error: 'That upload did not carry a usable track hash.' }, { status: 400 });
    }

    const admin = getSupabaseAdmin();

    // ── ASK STORAGE WHAT ACTUALLY LANDED ────────────────────────
    const folder = path.slice(0, path.lastIndexOf('/'));
    const name = path.slice(path.lastIndexOf('/') + 1);
    const { data: listed, error: listErr } = await admin.storage
      .from(TRACK_BUCKET)
      .list(folder, { search: name, limit: 1 });

    if (listErr) {
      console.error('[tracks/register] storage list failed:', listErr);
      return NextResponse.json({ error: `Could not confirm the upload — ${listErr.message}` }, { status: 500 });
    }
    const object = (listed || []).find((o) => o.name === name);
    if (!object) {
      return NextResponse.json(
        { error: 'The upload did not finish — nothing was saved. Try again.' },
        { status: 409 }
      );
    }

    const realSize = Number(object.metadata?.size ?? 0);
    const drop = async () => { try { await admin.storage.from(TRACK_BUCKET).remove([path]); } catch { /* best effort */ } };

    if (!Number.isFinite(realSize) || realSize <= 0) {
      await drop();
      return NextResponse.json({ error: 'That upload arrived empty. Nothing has been saved.' }, { status: 400 });
    }
    if (realSize > MAX_TRACK_BYTES) {
      await drop();
      return NextResponse.json(
        { error: `That track is ${megabytes(realSize)}MB. The limit is ${Math.round(MAX_TRACK_BYTES / 1048576)}MB per track. It has not been saved.` },
        { status: 413 }
      );
    }

    const quota = await readQuota(admin, auth.user.id);
    if (!quota.ok) {
      await drop();
      return NextResponse.json({ error: `Could not check your storage — ${quota.error}` }, { status: 500 });
    }
    if (realSize > quota.remaining) {
      await drop();
      return NextResponse.json({ error: notEnoughSpaceMessage(quota, realSize, 'a clip or a track') }, { status: 413 });
    }

    // ── UPSERT ON (artist_id, sha256) ───────────────────────────
    // The conflict target is the plain unique index from
    // docs/mvp2_01_backing_tracks.sql, named exactly. Re-uploading a
    // file the artist already has replaces the row rather than creating
    // a second one for identical bytes — which matters because the hash
    // is the identity every cue sheet keys on, and two rows for one
    // identity is an ambiguity the resolve-by-hash lookup cannot answer.
    const { data: row, error: rowErr } = await admin
      .from('backing_tracks')
      .upsert({
        artist_id: auth.user.id,
        storage_path: path,
        sha256,
        title,
        original_filename: filename || null,
        size_bytes: realSize,
        duration_ms: durationMs,
      }, { onConflict: 'artist_id,sha256' })
      .select('id, storage_path, sha256, title, original_filename, size_bytes, duration_ms, created_at')
      .single();

    if (rowErr) {
      await drop();
      const notMigrated = /relation .* does not exist|schema cache/i.test(rowErr.message || '');
      console.error('[tracks/register] insert failed:', rowErr);
      return NextResponse.json(
        { error: notMigrated ? 'Backing-track uploads need docs/mvp2_01_backing_tracks.sql to be run first.' : `Could not save that track — ${rowErr.message}` },
        { status: notMigrated ? 503 : 500 }
      );
    }

    const after = await readQuota(admin, auth.user.id);
    return NextResponse.json({ track: row, quota: after.ok ? after : null });
  } catch (err) {
    console.error('[tracks/register] request failed:', err);
    return NextResponse.json({ error: 'Request failed' }, { status: 500 });
  }
}
