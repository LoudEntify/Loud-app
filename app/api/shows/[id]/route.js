import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin';
import { verifyArtistAuth } from '../../../../lib/verifyArtistAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(request, { params }) {
  try {
    const auth = await verifyArtistAuth(request);
    if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const { id } = await params;
    const body = await request.json();
    const title = typeof body.title === 'string' ? body.title.trim().slice(0, 120) : '';
    const slatedAt = new Date(body.slated_at);
    const duration = Number(body.duration_minutes);

    if (Number.isNaN(slatedAt.getTime()) || slatedAt.getTime() <= Date.now()) {
      return NextResponse.json({ error: 'Choose a date and time in the future.' }, { status: 400 });
    }
    if (!Number.isInteger(duration) || duration < 15 || duration > 180) {
      return NextResponse.json({ error: 'Choose a duration between 15 and 180 minutes.' }, { status: 400 });
    }

    const admin = getSupabaseAdmin();
    const { data: show, error: readError } = await admin
      .from('shows')
      .select('id, artist_id, title, slated_at, duration_minutes, performance_mode, state, actual_started_at')
      .eq('id', id)
      .maybeSingle();

    if (readError) return NextResponse.json({ error: 'Could not load that show.' }, { status: 503 });
    if (!show) return NextResponse.json({ error: 'Show not found.' }, { status: 404 });
    if (show.artist_id !== auth.user.id) return NextResponse.json({ error: 'Only the host can edit this show.' }, { status: 403 });
    if (show.state !== 'scheduled' || show.actual_started_at) {
      return NextResponse.json({ error: 'A show that has started or ended can no longer be rescheduled.' }, { status: 409 });
    }

    const { data: updated, error: updateError } = await admin
      .from('shows')
      .update({ title: title || null, slated_at: slatedAt.toISOString(), duration_minutes: duration, ends_at: null })
      .eq('id', show.id)
      .eq('artist_id', auth.user.id)
      .eq('state', 'scheduled')
      .is('actual_started_at', null)
      .select('id, title, slated_at, duration_minutes')
      .maybeSingle();

    if (updateError) return NextResponse.json({ error: 'Could not update that show.' }, { status: 503 });
    if (!updated) return NextResponse.json({ error: 'The show changed before it could be updated. Refresh and try again.' }, { status: 409 });

    if (show.performance_mode === 'versus') {
      const { data: slots } = await admin
        .from('show_slots')
        .select('invited_user_id, claimed_by_user_id')
        .eq('show_id', show.id)
        .eq('slot', 'b');
      const guests = [...new Set((slots || []).flatMap(slot => [slot.claimed_by_user_id, slot.invited_user_id]).filter(Boolean))];
      if (guests.length) {
        const when = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/London' }).format(slatedAt);
        await admin.from('notifications').upsert(guests.map(userId => ({
          user_id: userId,
          kind: 'system',
          body: `“${updated.title || 'A Versus show'}” was updated. It is now scheduled for ${when}.`,
          href: '/dashboard/artist',
          dedupe_key: `show-updated:${show.id}:${userId}`,
          read_at: null,
        })), { onConflict: 'user_id,dedupe_key' });
      }
    }

    return NextResponse.json({ ok: true, show: updated });
  } catch (error) {
    console.error('[shows/update] request failed:', error);
    return NextResponse.json({ error: 'Could not update that show.' }, { status: 500 });
  }
}
