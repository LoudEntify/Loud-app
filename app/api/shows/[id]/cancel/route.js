import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../../lib/supabaseAdmin';
import { verifyArtistAuth } from '../../../../../lib/verifyArtistAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request, { params }) {
  try {
    const auth = await verifyArtistAuth(request);
    if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const { id } = await params;
    const admin = getSupabaseAdmin();
    const { data: show, error: readError } = await admin
      .from('shows')
      .select('id, artist_id, title, slated_at, state, actual_started_at')
      .eq('id', id)
      .maybeSingle();

    if (readError) return NextResponse.json({ error: 'Could not load that show.' }, { status: 503 });
    if (!show) return NextResponse.json({ error: 'Show not found.' }, { status: 404 });
    if (show.artist_id !== auth.user.id) return NextResponse.json({ error: 'Only the host can cancel this show.' }, { status: 403 });
    if (show.state !== 'scheduled' || show.actual_started_at) {
      return NextResponse.json({ error: 'A show that has started or ended cannot be cancelled here.' }, { status: 409 });
    }

    const cancelledAt = new Date().toISOString();
    const { data: cancelled, error: cancelError } = await admin
      .from('shows')
      .update({ state: 'ended', cancelled_at: cancelledAt, cancelled_reason: 'artist_cancelled' })
      .eq('id', show.id)
      .eq('artist_id', auth.user.id)
      .eq('state', 'scheduled')
      .is('actual_started_at', null)
      .select('id')
      .maybeSingle();

    if (cancelError) return NextResponse.json({ error: 'Could not cancel that show.' }, { status: 503 });
    if (!cancelled) return NextResponse.json({ error: 'The show changed before it could be cancelled. Refresh and try again.' }, { status: 409 });

    // Versus support is optional in a fresh installation. Cancellation
    // succeeds even if show_slots/notifications have not been migrated.
    const { data: slots } = await admin
      .from('show_slots')
      .select('claimed_by_user_id, invited_user_id')
      .eq('show_id', show.id);

    const invitees = [...new Set((slots || []).flatMap(slot => [slot.claimed_by_user_id, slot.invited_user_id]).filter(id => id && id !== auth.user.id))];
    if (invitees.length) {
      await admin.from('notifications').upsert(
        invitees.map(userId => ({
          user_id: userId,
          kind: 'system',
          body: `“${show.title || 'A show'}” has been cancelled by the host.`,
          href: '/dashboard/artist',
          dedupe_key: `show-cancelled:${show.id}:${userId}`,
          read_at: null,
        })),
        { onConflict: 'user_id,dedupe_key', ignoreDuplicates: true }
      );
    }

    return NextResponse.json({ ok: true, id: show.id, cancelledAt });
  } catch (error) {
    console.error('[shows/cancel] request failed:', error);
    return NextResponse.json({ error: 'Could not cancel that show.' }, { status: 500 });
  }
}
