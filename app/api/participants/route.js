import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { verifySession } from '../../../lib/verifyArtistAuth';

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

// ── AUTH MODEL: a verified session, and the email comes from it ───
//
// Security round finding 6 (docs/SECURITY_AUDIT_2026-08-28.md). This
// accepted an arbitrary email address against an arbitrary show_id with
// no session at all — an unauthenticated write of somebody else's PII
// into a table, at whatever rate a script could manage.
//
// `verifySession`, NOT `verifyArtistAuth`: the people this records are
// viewers, and requiring an artist account would refuse every single
// legitimate caller.
//
// THE EMAIL IS NOW DERIVED, NEVER READ FROM THE BODY, and this costs
// nothing because the only caller was already sending exactly that:
// components/LiveDemo.jsx's join flow passes
// `session?.user?.email` (around :950). The client was already telling
// the truth; the server simply had no way to know that. Now it does not
// need to.
export async function POST(request) {
  try {
    const auth = await verifySession(request);
    if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const { show_id: showId, consent } = await request.json();

    if (!showId) {
      return NextResponse.json({ error: 'show_id is required' }, { status: 400 });
    }

    const email = String(auth.user.email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      return NextResponse.json({ error: 'This account has no email address.' }, { status: 403 });
    }

    const admin = getSupabaseAdmin();

    // The show has to exist. Without this the route is an open door to
    // writing rows against any UUID at all — it previously answered 500
    // on a foreign-key violation, which is a database error leaking out
    // as an API contract.
    const { data: show } = await admin.from('shows').select('id').eq('id', showId).maybeSingle();
    if (!show) {
      return NextResponse.json({ error: 'No such show.' }, { status: 404 });
    }

    const { data, error } = await admin
      .from('participants')
      .insert({
        show_id: showId,
        email,
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
