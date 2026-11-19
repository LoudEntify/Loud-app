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

    await admin.from('notifications').upsert({
      user_id: auth.user.id,
      kind: 'system',
      body: `You accepted “${show.title || 'a Versus show'}”.`,
      href: '/dashboard/artist',
      dedupe_key: `versus_invite:${show.id}`,
      read_at: acceptedAt,
    }, { onConflict: 'user_id,dedupe_key' });

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

export async function DELETE(request) {
  try {
    const auth = await verifyArtistAuth(request);
    if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const { invite_token: inviteToken } = await request.json();
    if (!inviteToken) return NextResponse.json({ error: 'invite_token is required' }, { status: 400 });

    const admin = getSupabaseAdmin();
    const { data: slot, error: slotError } = await admin
      .from('show_slots')
      .select('show_id, slot, invited_user_id, claimed_by_user_id')
      .eq('invite_token', inviteToken)
      .maybeSingle();
    if (slotError) return NextResponse.json({ error: 'Could not load that invitation.' }, { status: 503 });
    if (!slot) return NextResponse.json({ error: 'This invitation is no longer valid.' }, { status: 404 });
    if (slot.invited_user_id && slot.invited_user_id !== auth.user.id) {
      return NextResponse.json({ error: 'This invitation belongs to another artist.' }, { status: 403 });
    }
    if (slot.claimed_by_user_id) return NextResponse.json({ error: 'An accepted booking can no longer be declined.' }, { status: 409 });

    const { data: show } = await admin.from('shows').select('id, artist_id, title').eq('id', slot.show_id).maybeSingle();
    if (!show) return NextResponse.json({ error: 'This show is no longer available.' }, { status: 404 });

    const { data: removed, error: removeError } = await admin
      .from('show_slots')
      .delete()
      .eq('show_id', slot.show_id)
      .eq('slot', slot.slot)
      .eq('invite_token', inviteToken)
      .is('claimed_by_user_id', null)
      .select('show_id')
      .maybeSingle();
    if (removeError) return NextResponse.json({ error: 'Could not decline that invitation.' }, { status: 503 });
    if (!removed) return NextResponse.json({ error: 'The invitation changed before it could be declined.' }, { status: 409 });

    const declinedAt = new Date().toISOString();
    await admin.from('notifications').upsert({
      user_id: auth.user.id,
      kind: 'system',
      body: `You declined “${show.title || 'a Versus show'}”.`,
      href: '/dashboard/artist',
      dedupe_key: `versus_invite:${show.id}`,
      read_at: declinedAt,
    }, { onConflict: 'user_id,dedupe_key' });

    if (show.artist_id) {
      await admin.from('notifications').upsert({
        user_id: show.artist_id,
        kind: 'system',
        body: `${auth.profile.display_name || auth.profile.username || 'The invited artist'} declined “${show.title || 'your Versus show'}”.`,
        href: '/schedule',
        dedupe_key: `show-invite-declined:${show.id}:${auth.user.id}`,
      }, { onConflict: 'user_id,dedupe_key', ignoreDuplicates: true });
    }

    return NextResponse.json({ ok: true, showId: show.id });
  } catch (error) {
    console.error('[decline-invite] request failed:', error);
    return NextResponse.json({ error: 'Could not decline that invitation.' }, { status: 500 });
  }
}
