import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin';
import { verifyArtistAuth } from '../../../../lib/verifyArtistAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  const auth = await verifyArtistAuth(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const showId = new URL(request.url).searchParams.get('show_id');
  if (!showId) return NextResponse.json({ error: 'show_id is required' }, { status: 400 });

  try {
    const admin = getSupabaseAdmin();
    const { data: show } = await admin.from('shows').select('id, artist_id, performance_mode').eq('id', showId).maybeSingle();
    if (!show) return NextResponse.json({ error: 'Show not found.' }, { status: 404 });
    if (show.artist_id !== auth.user.id) return NextResponse.json({ error: 'Only the host can view this line-up.' }, { status: 403 });
    if (show.performance_mode !== 'versus') return NextResponse.json({ status: 'not_applicable' });

    const { data: slot, error } = await admin
      .from('show_slots')
      .select('slot, invited_user_id, invited_username, claimed_by_user_id, invite_token, invite_accepted_at')
      .eq('show_id', show.id)
      .eq('slot', 'b')
      .maybeSingle();
    if (error) return NextResponse.json({ error: 'Could not load the line-up.' }, { status: 503 });
    if (!slot) return NextResponse.json({ status: 'empty' });

    const artistId = slot.claimed_by_user_id || slot.invited_user_id;
    const { data: artist } = artistId
      ? await admin.from('profiles').select('id, display_name, username').eq('id', artistId).maybeSingle()
      : { data: null };

    return NextResponse.json({
      status: slot.claimed_by_user_id ? 'claimed' : 'pending',
      artist: artist ? { id: artist.id, displayName: artist.display_name, username: artist.username } : null,
      invitedUsername: slot.invited_username || null,
      inviteToken: slot.claimed_by_user_id ? null : slot.invite_token,
      acceptedAt: slot.invite_accepted_at || null,
    });
  } catch (error) {
    console.error('[show-lineup] request failed:', error);
    return NextResponse.json({ error: 'Could not load the line-up.' }, { status: 500 });
  }
}

export async function DELETE(request) {
  const auth = await verifyArtistAuth(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const showId = new URL(request.url).searchParams.get('show_id');
  if (!showId) return NextResponse.json({ error: 'show_id is required' }, { status: 400 });

  try {
    const admin = getSupabaseAdmin();
    const { data: show } = await admin.from('shows').select('id, artist_id, title').eq('id', showId).maybeSingle();
    if (!show) return NextResponse.json({ error: 'Show not found.' }, { status: 404 });
    if (show.artist_id !== auth.user.id) return NextResponse.json({ error: 'Only the host can change this line-up.' }, { status: 403 });

    const { data: slot } = await admin
      .from('show_slots')
      .select('invited_user_id, claimed_by_user_id')
      .eq('show_id', show.id)
      .eq('slot', 'b')
      .maybeSingle();
    if (!slot) return NextResponse.json({ ok: true, alreadyEmpty: true });
    if (slot.claimed_by_user_id) return NextResponse.json({ error: 'The guest has already accepted. Cancel the show if the line-up can no longer go ahead.' }, { status: 409 });

    const { data: removed, error: removeError } = await admin
      .from('show_slots')
      .delete()
      .eq('show_id', show.id)
      .eq('slot', 'b')
      .is('claimed_by_user_id', null)
      .select('show_id')
      .maybeSingle();
    if (removeError) return NextResponse.json({ error: 'Could not withdraw that invitation.' }, { status: 503 });
    if (!removed) return NextResponse.json({ error: 'The invitation changed before it could be withdrawn. Refresh and try again.' }, { status: 409 });

    if (slot.invited_user_id) {
      await admin.from('notifications').upsert({
        user_id: slot.invited_user_id,
        kind: 'system',
        body: `The invitation to “${show.title || 'a Versus show'}” was withdrawn by the host.`,
        href: '/dashboard/artist',
        dedupe_key: `versus_invite:${show.id}`,
        read_at: null,
      }, { onConflict: 'user_id,dedupe_key' });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[show-lineup] withdraw failed:', error);
    return NextResponse.json({ error: 'Could not withdraw that invitation.' }, { status: 500 });
  }
}
