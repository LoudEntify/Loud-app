import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';

// TEMPORARY -- verification only. Delete once done.
export async function GET() {
  const admin = getSupabaseAdmin();
  const { data: show } = await admin.from('shows').select('id').eq('room_name', 'pilot-room').maybeSingle();
  const { data: slots, error } = await admin.from('show_slots').select('*').eq('show_id', show?.id);
  return NextResponse.json({ showId: show?.id, slots, error: error?.message ?? null });
}

export async function POST() {
  const admin = getSupabaseAdmin();
  const slatedAt = new Date(Date.now() + 2 * 60 * 1000).toISOString();
  const { data, error } = await admin
    .from('shows')
    .update({ state: 'scheduled', slated_at: slatedAt })
    .eq('room_name', 'pilot-room')
    .select()
    .maybeSingle();
  return NextResponse.json({ ok: !error, data, error: error?.message ?? null });
}
