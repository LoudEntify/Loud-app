import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin';
import { verifySession } from '../../../../lib/verifyArtistAuth';
import {
  BROLL_BUCKET,
  MAX_CLIP_BYTES,
  MAX_TOTAL_BYTES,
  isOwnBrollPath,
  titleFromFilename,
} from '../../../../lib/brollLimits';

// STEP 2 OF 2 — the row is written HERE, and only once the file exists.
//
// The order matters and is the point of splitting the flow: the clip is
// registered *after* the bytes have landed, so a failed or abandoned
// upload leaves a stray object at worst, never a library entry pointing
// at nothing. An artist cueing a clip that does not exist mid-show is a
// far worse failure than an orphaned object nobody can see.
//
// ── EVERY NUMBER HERE COMES FROM STORAGE, NOT FROM THE CLIENT ──
// The browser told `upload-url` how big the file was so it could be
// refused politely before the transfer. That number is a courtesy and is
// not trusted again. This route asks STORAGE what actually landed:
//
//   * over the per-clip limit  → object deleted, refused
//   * over the artist's quota  → object deleted, refused
//   * object missing entirely  → refused, nothing written
//
// Deleting on refusal is what stops a client lying its way past the
// size check: a signed upload URL carries no size limit of its own, so
// the enforcement has to happen after the fact. It is the only point in
// the flow that can be authoritative.
//
// AUTH MODEL: any signed-in account, and the path must be under
// `broll/{their own id}/`. The path was minted server-side in step 1, so
// this check is belt-and-braces — but it is the one line that stops a
// caller registering somebody else's object into their own library.

export async function POST(request) {
  try {
    const auth = await verifySession(request);
    if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const body = await request.json().catch(() => ({}));
    const path = String(body.path || '');
    const filename = String(body.filename || '');

    if (!isOwnBrollPath(path, auth.user.id)) {
      // Same answer whether the path is malformed or belongs to someone
      // else — a caller probing paths learns nothing from the response.
      return NextResponse.json({ error: 'That upload does not belong to this account.' }, { status: 403 });
    }

    const admin = getSupabaseAdmin();

    // ── Did it actually land, and how big is it really? ─────────
    const lastSlash = path.lastIndexOf('/');
    const dir = path.slice(0, lastSlash);
    const name = path.slice(lastSlash + 1);

    const { data: objects, error: listErr } = await admin.storage
      .from(BROLL_BUCKET)
      .list(dir, { search: name, limit: 100 });

    if (listErr) {
      console.error('[broll/register] storage list failed:', listErr);
      return NextResponse.json({ error: `Could not confirm the upload — ${listErr.message}` }, { status: 500 });
    }

    const object = (objects || []).find((o) => o.name === name);
    if (!object) {
      return NextResponse.json(
        { error: 'The upload did not finish — nothing arrived in storage. Try again.' },
        { status: 409 }
      );
    }

    // Supabase has moved this between metadata shapes across versions;
    // both are read rather than one being assumed, and a size we cannot
    // read is a refusal rather than a guess.
    const realSize = Number(object.metadata?.size ?? object.metadata?.contentLength ?? NaN);
    if (!Number.isFinite(realSize) || realSize <= 0) {
      await admin.storage.from(BROLL_BUCKET).remove([path]);
      return NextResponse.json(
        { error: 'The uploaded file arrived empty or unreadable. Nothing was saved.' },
        { status: 409 }
      );
    }

    if (realSize > MAX_CLIP_BYTES) {
      await admin.storage.from(BROLL_BUCKET).remove([path]);
      return NextResponse.json(
        { error: `That clip is ${Math.round(realSize / 1048576)}MB. The limit is ${Math.round(MAX_CLIP_BYTES / 1048576)}MB per clip — it has not been saved.` },
        { status: 413 }
      );
    }

    // ── Quota, against the real size ────────────────────────────
    const { data: existing, error: sumErr } = await admin
      .from('broll_clips')
      .select('size_bytes')
      .eq('artist_id', auth.user.id);
    if (sumErr) {
      await admin.storage.from(BROLL_BUCKET).remove([path]);
      const notMigrated = /relation .* does not exist|schema cache/i.test(sumErr.message || '');
      return NextResponse.json(
        { error: notMigrated ? 'B-roll needs docs/broll_migration.sql to be run first.' : `Could not check your storage — ${sumErr.message}` },
        { status: notMigrated ? 503 : 500 }
      );
    }
    const used = (existing || []).reduce((sum, r) => sum + (r.size_bytes || 0), 0);
    if (used + realSize > MAX_TOTAL_BYTES) {
      await admin.storage.from(BROLL_BUCKET).remove([path]);
      const leftMb = Math.max(0, Math.round((MAX_TOTAL_BYTES - used) / 1048576));
      return NextResponse.json(
        { error: `Not enough space — ${leftMb}MB left of your ${Math.round(MAX_TOTAL_BYTES / 1048576)}MB. The clip has not been saved.` },
        { status: 413 }
      );
    }

    const { data: row, error: rowErr } = await admin
      .from('broll_clips')
      .insert({
        artist_id: auth.user.id,
        storage_path: path,
        title: titleFromFilename(filename || name),
        size_bytes: realSize,
      })
      .select()
      .single();

    if (rowErr) {
      // Roll the object back so storage and the table cannot disagree —
      // the same guarantee the old single-shot route made, kept.
      await admin.storage.from(BROLL_BUCKET).remove([path]);
      console.error('[broll/register] row insert failed:', rowErr);
      return NextResponse.json(
        {
          error: /relation .* does not exist|schema cache/i.test(rowErr.message || '')
            ? 'B-roll needs docs/broll_migration.sql to be run first.'
            : `Could not save that clip — ${rowErr.message}`,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, clip: row });
  } catch (err) {
    console.error('[broll/register] request failed:', err);
    return NextResponse.json({ error: `Could not save that clip — ${String(err?.message || err)}` }, { status: 500 });
  }
}
