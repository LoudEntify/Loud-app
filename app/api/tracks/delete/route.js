import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin';
import { verifySession } from '../../../../lib/verifyArtistAuth';
import { TRACK_BUCKET } from '../../../../lib/trackLimits';
import { readQuota } from '../../../../lib/mediaQuota';

// Remove a track: the row AND the object.
//
// PRD: Director Experience / Live Show (backing track)
// S&I: Database, Stateless hosting (shared storage), Auth
//
// AUTH MODEL: any signed-in account (`verifySession`), row scoped to the
// caller by artist_id, so another artist's id does not resolve.
//
// ── ORDER: OBJECT FIRST, THEN ROW ─────────────────────────────
// The opposite of registration, and for the same reason. Registration
// writes the row last so a failure leaves an orphaned object rather than
// a library entry pointing at nothing. Deletion removes the object first
// so a failure leaves a row pointing at nothing — which is visible,
// recoverable, and can be retried — rather than an invisible object
// still spending the artist's quota with no way to reach it.
//
// ── WHAT IS NOT CASCADED, AND WHY ─────────────────────────────
// Cue sheets are NOT deleted. They are keyed on (track_hash,
// artist_email) and belong to the TRACK's identity, not to this upload:
// deleting an uploaded copy leaves the artist able to pick the same file
// locally and find their cues exactly where they left them. Deleting
// someone's cue authoring because they cleared storage space would be a
// destructive surprise, and the hash makes it entirely unnecessary.

export async function POST(request) {
  try {
    const auth = await verifySession(request);
    if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const body = await request.json().catch(() => ({}));
    const id = String(body.id || '');
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    const admin = getSupabaseAdmin();
    const { data: row, error: findErr } = await admin
      .from('backing_tracks')
      .select('id, storage_path')
      .eq('id', id)
      .eq('artist_id', auth.user.id)
      .maybeSingle();

    if (findErr) {
      console.error('[tracks/delete] lookup failed:', findErr);
      return NextResponse.json({ error: 'Could not look up that track.' }, { status: 500 });
    }
    if (!row) return NextResponse.json({ error: 'No such track.' }, { status: 404 });

    const { error: rmErr } = await admin.storage.from(TRACK_BUCKET).remove([row.storage_path]);
    if (rmErr) {
      // Reported rather than swallowed: if the object survives, deleting
      // the row would strand it, still spending quota with nothing left
      // pointing at it.
      console.error('[tracks/delete] object remove failed:', rmErr);
      return NextResponse.json({ error: `Could not delete the file — ${rmErr.message}` }, { status: 500 });
    }

    const { error: delErr } = await admin
      .from('backing_tracks')
      .delete()
      .eq('id', id)
      .eq('artist_id', auth.user.id);

    if (delErr) {
      console.error('[tracks/delete] row delete failed:', delErr);
      return NextResponse.json({ error: `The file was removed but its entry was not — ${delErr.message}` }, { status: 500 });
    }

    const quota = await readQuota(admin, auth.user.id);
    return NextResponse.json({ ok: true, quota: quota.ok ? quota : null });
  } catch (err) {
    console.error('[tracks/delete] request failed:', err);
    return NextResponse.json({ error: 'Request failed' }, { status: 500 });
  }
}
