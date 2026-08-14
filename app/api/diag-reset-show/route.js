import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';

// TEMPORARY -- verification only. Resets pilot-room's show row to
// 'scheduled' with a near-future slated_at. Delete once done.
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
