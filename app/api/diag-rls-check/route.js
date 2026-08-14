import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { getSupabase } from '../../../lib/supabaseClient';

// TEMPORARY -- Stage 1 verification only for MULTI_PERFORMER_SPEC.md.
// Proves (a) the admin (service-role) client can actually reach the new
// tables, and (b) the anon client genuinely cannot read or write them,
// against the real deployed RLS config -- not just inspecting the SQL.
// Delete this route once Stage 1 is verified; it has no business
// existing once its one job is done.
export async function GET() {
  const admin = getSupabaseAdmin();
  const anon = getSupabase();

  const { data: show, error: showErr } = await admin
    .from('shows')
    .select('id')
    .eq('room_name', 'pilot-room')
    .maybeSingle();

  const adminShowSlots = await admin.from('show_slots').select('*').limit(5);
  const adminParticipants = await admin.from('participants').select('*').limit(5);

  const anonShowSlotsRead = await anon.from('show_slots').select('*').limit(5);
  const anonParticipantsRead = await anon.from('participants').select('*').limit(5);

  let anonWriteAttempt = { attempted: false };
  if (show?.id) {
    const { data, error } = await anon
      .from('show_slots')
      .insert({ show_id: show.id, slot: 'diag-should-fail', code: 'diag-should-fail' })
      .select();
    anonWriteAttempt = { attempted: true, succeeded: !error, error: error?.message ?? null };
    if (!error && data?.length) {
      // RLS did NOT block this -- clean up immediately via admin and flag loudly.
      await admin.from('show_slots').delete().eq('slot', 'diag-should-fail');
    }
  }

  return NextResponse.json({
    showLookup: { found: !!show?.id, error: showErr?.message ?? null },
    admin: {
      show_slots: { rows: adminShowSlots.data?.length ?? null, error: adminShowSlots.error?.message ?? null },
      participants: { rows: adminParticipants.data?.length ?? null, error: adminParticipants.error?.message ?? null },
    },
    anonRead: {
      show_slots: { rows: anonShowSlotsRead.data?.length ?? null, error: anonShowSlotsRead.error?.message ?? null, sawData: anonShowSlotsRead.data },
      participants: { rows: anonParticipantsRead.data?.length ?? null, error: anonParticipantsRead.error?.message ?? null, sawData: anonParticipantsRead.data },
    },
    anonWriteAttempt,
  });
}
