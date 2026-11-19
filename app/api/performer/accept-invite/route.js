import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin';
import { verifyArtistAuth } from '../../../../lib/verifyArtistAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request) {
  try {
    const auth = await verifyArtistAuth(request);
    if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const { invite_token: inviteToken } = await request.json();
    if (!inviteToken) return NextResponse.json({ error: 'invite_token is required' }, { status: 400 });

    const admin = getSupabaseAdmin();
    const { data: slot, error: slotError } = await admin
      .from('show_slots')
      .select('show_id, slot, invite_token, invited_user_id, claimed_by_user_id')
      .eq('invite_token', inviteToken)
      .maybeSingle();

    if (slotError) return NextResponse.json({ error: 'Could not load that invitation.' }, { status: 503 });
    if (!slot) return NextResponse.json({ error: 'This invitation is no longer valid.' }, { status: 404 });
    if (slot.invited_user_id && slot.invited_user_id !== auth.user.id) {
      return NextResponse.json({ error: 'This invitation belongs to another artist.' }, { status: 403 });
    }
    if (slot.claimed_by_user_id && slot.claimed_by_user_id !== auth.user.id) {
      return NextResponse.json({ error: 'This slot has already been accepted.' }, { status: 409 });
    }

    const { data: show } = await admin
      .from('shows')
      .select('id, artist_id, title, state')
      .eq('id', slot.show_id)
      .maybeSingle();
    if (!show || show.state === 'ended') return NextResponse.json({ error: 'This show is no longer available.' }, { status: 409 });
    if (show.artist_id === auth.user.id) return NextResponse.json({ error: 'The host already owns slot A.' }, { status: 409 });

    const acceptedAt = new Date().toISOString();
    const { data: accepted, error: acceptError } = await admin
      .from('show_slots')
      .update({
        claimed_by_user_id: auth.user.id,
        claimed_by_email: (auth.user.email || '').trim().toLowerCase(),
        claimed_at: acceptedAt,
        invite_accepted_at: acceptedAt,
        invite_token: null,
      })
      .eq('show_id', slot.show_id)
      .eq('slot', slot.slot)
      .eq('invite_token', inviteToken)
      .is('claimed_by_user_id', null)
      .select('show_id, slot')
      .maybeSingle();

    if (acceptError) return NextResponse.json({ error: 'Could not accept that invitation.' }, { status: 503 });
    if (!accepted) return NextResponse.json({ error: 'This invitation was accepted or replaced before your request completed.' }, { status: 409 });

    // The host should know the line-up is confirmed. Notifications are
    // helpful but not allowed to undo an already accepted booking.
    if (show.artist_id) {
      await admin.from('notifications').upsert({
        user_id: show.artist_id,
        kind: 'system',
        body: `${auth.profile.display_name || auth.profile.username || 'An artist'} accepted “${show.title || 'your show'}”.`,
        href: '/schedule',
        dedupe_key: `show-invite-accepted:${show.id}:${auth.user.id}`,
      }, { onConflict: 'user_id,dedupe_key', ignoreDuplicates: true });
    }

    return NextResponse.json({ ok: true, showId: show.id, slot: accepted.slot });
  } catch (error) {
    console.error('[accept-invite] request failed:', error);
    return NextResponse.json({ error: 'Could not accept that invitation.' }, { status: 500 });
  }
}
