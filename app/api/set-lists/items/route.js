import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin';
import { verifySession } from '../../../../lib/verifyArtistAuth';

// SET LIST ITEMS — add, remove, reorder.
//
// PRD: Director Experience / Live Show (set lists)
// S&I: Database, Auth
//
// AUTH MODEL: any signed-in account (`verifySession`), and every write
// is gated on OWNING THE PARENT SET. That check is done explicitly here
// (ownsSet below) rather than leaned on from RLS, because these routes
// use the service-role client, which bypasses RLS entirely. The policies
// in mvp2_03 protect direct PostgREST access; this function is what
// protects the route.

async function ownsSet(admin, setListId, userId) {
  if (!setListId) return false;
  const { data } = await admin
    .from('set_lists')
    .select('id')
    .eq('id', setListId)
    .eq('artist_id', userId)
    .maybeSingle();
  return !!data;
}

// Add a track to the end of a set.
export async function POST(request) {
  try {
    const auth = await verifySession(request);
    if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const body = await request.json().catch(() => ({}));
    const setListId = String(body.setListId || '');
    const trackId = String(body.backingTrackId || '');
    if (!setListId || !trackId) {
      return NextResponse.json({ error: 'setListId and backingTrackId are required' }, { status: 400 });
    }

    const admin = getSupabaseAdmin();
    if (!(await ownsSet(admin, setListId, auth.user.id))) {
      return NextResponse.json({ error: 'No such set list.' }, { status: 404 });
    }
    // The TRACK must be the caller's too. Without this, an artist could
    // add somebody else's track id to their own set and the join in GET
    // would happily read its title back out.
    const { data: track } = await admin
      .from('backing_tracks')
      .select('id')
      .eq('id', trackId)
      .eq('artist_id', auth.user.id)
      .maybeSingle();
    if (!track) return NextResponse.json({ error: 'No such track.' }, { status: 404 });

    // Append. Reading max(position) rather than counting rows: a set
    // that has had items removed has gaps, and counting would collide.
    const { data: last } = await admin
      .from('set_list_items')
      .select('position')
      .eq('set_list_id', setListId)
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle();
    const position = (last?.position ?? -1) + 1;

    const { data: row, error } = await admin
      .from('set_list_items')
      .insert({ set_list_id: setListId, backing_track_id: trackId, position })
      .select('id, position, backing_track_id, cue_sheet_id, created_at')
      .single();

    if (error) {
      console.error('[set-lists/items] add failed:', error);
      return NextResponse.json({ error: 'Could not add that track.' }, { status: 500 });
    }
    return NextResponse.json({ item: row });
  } catch (err) {
    console.error('[set-lists/items] request failed:', err);
    return NextResponse.json({ error: 'Request failed' }, { status: 500 });
  }
}

// Reorder. The client sends the FULL ordered list of item ids; the
// server rewrites every position from it.
//
// ── WHY THE WHOLE LIST RATHER THAN A MOVE ─────────────────────
// A "move item X to index N" API has to reason about what the other
// rows currently are, and the client already knows the answer it wants.
// Sending the destination order outright makes the operation
// idempotent, makes a lost response harmless to retry, and means no
// intermediate state is ever half-applied in a way that depends on
// which order the updates landed in.
export async function PATCH(request) {
  try {
    const auth = await verifySession(request);
    if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const body = await request.json().catch(() => ({}));
    const setListId = String(body.setListId || '');
    const orderedIds = Array.isArray(body.orderedItemIds) ? body.orderedItemIds.map(String) : null;
    if (!setListId || !orderedIds) {
      return NextResponse.json({ error: 'setListId and orderedItemIds are required' }, { status: 400 });
    }

    const admin = getSupabaseAdmin();
    if (!(await ownsSet(admin, setListId, auth.user.id))) {
      return NextResponse.json({ error: 'No such set list.' }, { status: 404 });
    }

    // Every id must belong to THIS set. Otherwise a reorder could be
    // used to write a position onto another set's item.
    const { data: existing, error: readErr } = await admin
      .from('set_list_items')
      .select('id')
      .eq('set_list_id', setListId);
    if (readErr) {
      console.error('[set-lists/items] reorder read failed:', readErr);
      return NextResponse.json({ error: 'Could not reorder that set.' }, { status: 500 });
    }
    const mine = new Set((existing || []).map((r) => r.id));
    if (orderedIds.some((id) => !mine.has(id))) {
      return NextResponse.json({ error: 'That order refers to items not in this set.' }, { status: 400 });
    }

    // Sequential updates. position is NOT unique (mvp2_03), which is
    // exactly what makes this safe without a transaction: no
    // intermediate state can violate a constraint, so a partially
    // applied reorder is merely a different valid order, never an error.
    for (let i = 0; i < orderedIds.length; i += 1) {
      const { error } = await admin
        .from('set_list_items')
        .update({ position: i })
        .eq('id', orderedIds[i])
        .eq('set_list_id', setListId);
      if (error) {
        console.error('[set-lists/items] reorder write failed:', error);
        return NextResponse.json({ error: 'Could not reorder that set.' }, { status: 500 });
      }
    }
    // Touch the parent so the set sorts as recently-changed. The value
    // written is irrelevant — set_lists_touch_trg overwrites updated_at
    // with now() on any UPDATE — but an update with no assignable
    // columns is a no-op, so it has to set something real.
    await admin
      .from('set_lists')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', setListId)
      .eq('artist_id', auth.user.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[set-lists/items] request failed:', err);
    return NextResponse.json({ error: 'Request failed' }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const auth = await verifySession(request);
    if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const { searchParams } = new URL(request.url);
    const id = String(searchParams.get('id') || '');
    const setListId = String(searchParams.get('setListId') || '');
    if (!id || !setListId) {
      return NextResponse.json({ error: 'id and setListId are required' }, { status: 400 });
    }

    const admin = getSupabaseAdmin();
    if (!(await ownsSet(admin, setListId, auth.user.id))) {
      return NextResponse.json({ error: 'No such set list.' }, { status: 404 });
    }

    const { error } = await admin
      .from('set_list_items')
      .delete()
      .eq('id', id)
      .eq('set_list_id', setListId);

    if (error) {
      console.error('[set-lists/items] remove failed:', error);
      return NextResponse.json({ error: 'Could not remove that item.' }, { status: 500 });
    }
    // Positions are deliberately NOT compacted. Gaps are harmless —
    // ordering is by (position, created_at), not by index — and
    // rewriting every remaining row to close a gap is a lot of writes to
    // fix something nobody can see.
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[set-lists/items] request failed:', err);
    return NextResponse.json({ error: 'Request failed' }, { status: 500 });
  }
}
