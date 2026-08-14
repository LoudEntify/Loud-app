import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin';

// Stage 4 of MULTI_PERFORMER_SPEC.md. This write IS the security
// boundary for the active-performer switch (section 5 of the spec) --
// the data-channel message a client also broadcasts after a successful
// call here is never trusted directly by receivers, only treated as a
// signal to re-fetch this row. show_id here is the real shows.id UUID
// (matching participants/show_slots' FK), NOT the ROOM_NAME string the
// existing shot_commands.show_id / DirectorShotPanel's showId prop use
// -- those are a separate, pre-existing convention this route doesn't
// touch.
export async function POST(request) {
  try {
    const { show_id: showId, sessionToken, targetSlot } = await request.json();
    if (!showId || !sessionToken || !targetSlot) {
      return NextResponse.json(
        { error: 'show_id, sessionToken, and targetSlot are required' },
        { status: 400 }
      );
    }

    const admin = getSupabaseAdmin();

    // Only slot 'a' -- the broadcast controller -- may ever drive this,
    // per the locked "slot a = broadcast controller" decision (this
    // stays a literal 'a' check deliberately -- it's a fixed rule about
    // WHO controls the switch, not a slot-count assumption). Checked
    // against the CURRENT session_token, which rotates on every claim
    // (Stage 3) -- a stale token from an earlier claim of slot 'a' is
    // rejected here even if the device holding it never got a UI cue
    // that it lost the privilege.
    const { data: slotA, error: slotErr } = await admin
      .from('show_slots')
      .select('session_token')
      .eq('show_id', showId)
      .eq('slot', 'a')
      .maybeSingle();

    if (slotErr || !slotA || !slotA.session_token || slotA.session_token !== sessionToken) {
      return NextResponse.json({ error: 'Not authorized to switch the active performer' }, { status: 403 });
    }

    // MULTI_PERFORMER_SPEC.md's generalization pass -- targetSlot is no
    // longer checked against a hardcoded a/b whitelist. It must be a
    // slot that genuinely exists in show_slots for this show; this is
    // strictly stronger than the old check (a whitelist would still
    // accept 'a'/'b' for a show that never seeded either), not just a
    // different shape of the same check.
    const { data: targetRow, error: targetErr } = await admin
      .from('show_slots')
      .select('slot')
      .eq('show_id', showId)
      .eq('slot', targetSlot)
      .maybeSingle();

    if (targetErr || !targetRow) {
      return NextResponse.json({ error: 'targetSlot does not exist for this show' }, { status: 400 });
    }

    const { data, error } = await admin
      .from('shows')
      .update({ active_performer_slot: targetSlot })
      .eq('id', showId)
      .select('active_performer_slot')
      .maybeSingle();

    if (error || !data) {
      return NextResponse.json({ error: 'Could not update active performer' }, { status: 500 });
    }

    return NextResponse.json({ ok: true, activePerformerSlot: data.active_performer_slot });
  } catch (err) {
    console.error('[active-performer] request failed:', err);
    return NextResponse.json(
      { error: 'Request failed', detail: String(err?.message || err) },
      { status: 500 }
    );
  }
}
