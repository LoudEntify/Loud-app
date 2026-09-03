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

    // ── IS THIS TRACK IN A SET LIST? ────────────────────────────
    // Refused if so, and the refusal NAMES the sets. Someone deleting a
    // track is thinking about storage space; they are not thinking about
    // a running order they built last week, and "cannot delete" without
    // saying why would send them looking for a bug.
    //
    // set_list_items.backing_track_id is ON DELETE RESTRICT, so the
    // database would refuse this anyway. That constraint is the
    // backstop; this check is the one that can be helpful about it.
    //
    // A track in NO set list falls straight through to the delete below,
    // exactly as it did before set lists existed — same flow, same
    // "cue sheets are kept" message. That path is deliberately untouched.
    const { data: usedIn, error: usedErr } = await admin
      .from('set_list_items')
      .select('set_lists ( id, name )')
      .eq('backing_track_id', id);

    // A missing set_list_items table means set lists have not been
    // migrated on this environment, which means the track cannot be in
    // one. Not an error — carry on and delete.
    if (usedErr && !/relation .* does not exist|schema cache/i.test(usedErr.message || '')) {
      console.error('[tracks/delete] set list check failed:', usedErr);
      return NextResponse.json({ error: 'Could not check whether that track is in a set list.' }, { status: 500 });
    }
    const sets = (usedIn || []).map((r) => r.set_lists).filter(Boolean);
    if (sets.length > 0) {
      const names = [...new Set(sets.map((s) => s.name))];
      const list = names.length === 1
        ? `“${names[0]}”`
        : `${names.slice(0, -1).map((n) => `“${n}”`).join(', ')} and “${names[names.length - 1]}”`;
      return NextResponse.json({
        error: `That track is in ${names.length === 1 ? 'the set list' : 'the set lists'} ${list}. `
          + 'Remove it from there first — nothing has been deleted.',
        inSetLists: names,
      }, { status: 409 });
    }

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
