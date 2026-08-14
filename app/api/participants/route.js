import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';

// Stage 2 of MULTI_PERFORMER_SPEC.md -- the entry gate every joiner
// (performer or viewer) hits before the existing mode/role join flow.
// Always inserts role:'viewer', slot:null -- a performer's row is
// UPDATED (not re-inserted) once/if they successfully claim a slot code
// (Stage 3, app/api/performer/claim-slot), found by the participantId
// this route returns.
//
// This is the app's first table holding PII (email); writes go through
// the service-role client so it never depends on participants' RLS
// (which has zero policies -- see MULTI_PERFORMER_SPEC.md section 1).

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request) {
  try {
    const { show_id: showId, email, consent } = await request.json();

    if (!showId) {
      return NextResponse.json({ error: 'show_id is required' }, { status: 400 });
    }
    if (typeof email !== 'string' || !EMAIL_RE.test(email.trim())) {
      return NextResponse.json({ error: 'A valid email is required' }, { status: 400 });
    }

    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from('participants')
      .insert({
        show_id: showId,
        email: email.trim().toLowerCase(),
        role: 'viewer',
        slot: null,
        consent: !!consent,
      })
      .select('id')
      .single();

    if (error) {
      console.error('[participants] insert failed:', error);
      return NextResponse.json({ error: 'Could not record entry' }, { status: 500 });
    }

    return NextResponse.json({ ok: true, participantId: data.id });
  } catch (err) {
    console.error('[participants] request failed:', err);
    return NextResponse.json(
      { error: 'Request failed', detail: String(err?.message || err) },
      { status: 500 }
    );
  }
}
