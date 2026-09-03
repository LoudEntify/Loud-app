import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { verifySession } from '../../../lib/verifyArtistAuth';
import { isMissingRelation } from '../../../lib/mediaQuota';

// SET LISTS — the artist's named, ordered arrangements.
//
// PRD: Director Experience / Live Show (set lists)
// S&I: Database, Auth
//
// AUTH MODEL: any signed-in account (`verifySession`). Every statement
// below is scoped to `auth.user.id` and never to a parameter — there is
// no way to ask this for somebody else's sets because there is nothing
// to ask with. That is the lesson from the cue-sheets IDOR in the
// 2026-08-28 security round: the route verified the caller and then
// trusted an artist_email out of the query string.

function notMigrated(error) {
  return NextResponse.json(
    { error: 'Set lists need docs/mvp2_02_set_lists.sql and mvp2_03_set_list_items.sql to be run first.' },
    { status: 503 }
  );
}

export async function GET(request) {
  try {
    const auth = await verifySession(request);
    if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const admin = getSupabaseAdmin();
    // Sets and their items in one round trip. The embedded select is
    // ordered here rather than in the client so every surface agrees on
    // what "the order" is — (position, created_at), matching the index.
    const { data, error } = await admin
      .from('set_lists')
      .select(`
        id, name, created_at, updated_at,
        set_list_items (
          id, position, backing_track_id, cue_sheet_id, created_at,
          backing_tracks ( id, sha256, title, duration_ms, size_bytes )
        )
      `)
      .eq('artist_id', auth.user.id)
      .order('updated_at', { ascending: false })
      .order('position', { referencedTable: 'set_list_items', ascending: true })
      .order('created_at', { referencedTable: 'set_list_items', ascending: true })
      .limit(50);

    if (error) {
      if (isMissingRelation(error)) return NextResponse.json({ setLists: [], notMigrated: true });
      console.error('[set-lists] list failed:', error);
      return NextResponse.json({ error: 'Could not read your set lists.' }, { status: 500 });
    }
    return NextResponse.json({ setLists: data || [] });
  } catch (err) {
    console.error('[set-lists] request failed:', err);
    return NextResponse.json({ error: 'Request failed' }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const auth = await verifySession(request);
    if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const body = await request.json().catch(() => ({}));
    const name = String(body.name || '').trim().slice(0, 120) || 'Untitled set';

    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from('set_lists')
      .insert({ artist_id: auth.user.id, name })
      .select('id, name, created_at, updated_at')
      .single();

    if (error) {
      if (isMissingRelation(error)) return notMigrated(error);
      console.error('[set-lists] create failed:', error);
      return NextResponse.json({ error: 'Could not create that set list.' }, { status: 500 });
    }
    return NextResponse.json({ setList: { ...data, set_list_items: [] } });
  } catch (err) {
    console.error('[set-lists] request failed:', err);
    return NextResponse.json({ error: 'Request failed' }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    const auth = await verifySession(request);
    if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const body = await request.json().catch(() => ({}));
    const id = String(body.id || '');
    const name = String(body.name || '').trim().slice(0, 120);
    if (!id || !name) return NextResponse.json({ error: 'id and name are required' }, { status: 400 });

    const admin = getSupabaseAdmin();
    // Scoped by artist_id as well as id: a set belonging to someone else
    // simply does not match, so there is no separate ownership check to
    // forget.
    const { data, error } = await admin
      .from('set_lists')
      .update({ name })
      .eq('id', id)
      .eq('artist_id', auth.user.id)
      .select('id, name, updated_at')
      .maybeSingle();

    if (error) {
      console.error('[set-lists] rename failed:', error);
      return NextResponse.json({ error: 'Could not rename that set list.' }, { status: 500 });
    }
    if (!data) return NextResponse.json({ error: 'No such set list.' }, { status: 404 });
    return NextResponse.json({ setList: data });
  } catch (err) {
    console.error('[set-lists] request failed:', err);
    return NextResponse.json({ error: 'Request failed' }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const auth = await verifySession(request);
    if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const { searchParams } = new URL(request.url);
    const id = String(searchParams.get('id') || '');
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    const admin = getSupabaseAdmin();
    // Items cascade with the set (mvp2_03). The TRACKS do not — they are
    // the artist's library and outlive any arrangement of them.
    const { error } = await admin
      .from('set_lists')
      .delete()
      .eq('id', id)
      .eq('artist_id', auth.user.id);

    if (error) {
      console.error('[set-lists] delete failed:', error);
      return NextResponse.json({ error: 'Could not delete that set list.' }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[set-lists] request failed:', err);
    return NextResponse.json({ error: 'Request failed' }, { status: 500 });
  }
}
