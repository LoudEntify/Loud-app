import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { verifyArtistAuth } from '../../../lib/verifyArtistAuth';
import { validateCueSheet, isValidFallbackBehaviour } from '../../../lib/cueSheetValidation';

// Cue-Sheet Director (CD-3/CD-4). cue_sheets is now keyed by
// (track_hash, artist_email) -- docs/cue_sheets_migration_v2.sql -- not
// (show_id, slot) anymore, so sheets persist per track and are reusable
// across shows. Written via the service-role client only, same as every
// other route touching this table.
//
// Accounts & Identity Day 2: previously this route trusted whatever
// artist_email string a client sent, with zero verification -- in
// practice always reachable only via an authenticated artist session (cue
// authoring UI only renders behind isMainPerformer), but not enforced
// here. Now requires the same verifyArtistAuth check claim-slot uses, and
// writes artist_id (docs/ownership_migration.sql) from the verified
// session on every save. artist_email/its unique key are unchanged --
// this adds a verified ownership column alongside them, not a rekey.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TRACK_HASH_RE = /^[0-9a-f]{64}$/; // lib/trackHash.js -- hex SHA-256

function normalizeEmail(raw) {
  return typeof raw === 'string' ? raw.trim().toLowerCase() : '';
}

export async function GET(request) {
  const auth = await verifyArtistAuth(request);
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { searchParams } = new URL(request.url);
  const trackHash = searchParams.get('track_hash') || '';
  const artistEmail = normalizeEmail(searchParams.get('artist_email'));

  if (!TRACK_HASH_RE.test(trackHash)) {
    return NextResponse.json({ error: 'Invalid track_hash' }, { status: 400 });
  }
  if (!EMAIL_RE.test(artistEmail)) {
    return NextResponse.json({ error: 'Invalid artist_email' }, { status: 400 });
  }

  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from('cue_sheets')
      .select('id, track_hash, artist_email, track_label, fallback_behaviour, cues, updated_at')
      .eq('track_hash', trackHash)
      .eq('artist_email', artistEmail)
      .maybeSingle();

    if (error) {
      console.error('[cue-sheets] fetch failed:', error);
      return NextResponse.json({ error: 'Fetch failed' }, { status: 500 });
    }

    // No sheet for this track/artist yet is a normal state (a freshly
    // loaded track that's never been authored against), not an error --
    // 200 with a null sheet, not 404.
    return NextResponse.json({ sheet: data ?? null });
  } catch (err) {
    console.error('[cue-sheets] request failed:', err);
    return NextResponse.json(
      { error: 'Request failed', detail: String(err?.message || err) },
      { status: 500 }
    );
  }
}

export async function POST(request) {
  const auth = await verifyArtistAuth(request);
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const body = await request.json();
    const trackHash = body.track_hash || '';
    const artistEmail = normalizeEmail(body.artist_email);
    const trackLabel = typeof body.track_label === 'string' ? body.track_label.slice(0, 500) : null;
    const fallbackBehaviour = body.fallback_behaviour;

    if (!TRACK_HASH_RE.test(trackHash)) {
      return NextResponse.json({ error: 'Invalid track_hash' }, { status: 400 });
    }
    if (!EMAIL_RE.test(artistEmail)) {
      return NextResponse.json({ error: 'Invalid artist_email' }, { status: 400 });
    }
    if (!isValidFallbackBehaviour(fallbackBehaviour)) {
      return NextResponse.json({ error: 'Invalid fallback_behaviour' }, { status: 400 });
    }

    // Re-validated server-side regardless of what the editor UI already
    // checked client-side -- the UI's own checks are for immediate
    // feedback, not the trust boundary. Same validator the seed script
    // uses (lib/cueSheetValidation.js), same "reject unknowns" rule.
    const { cues, errors } = validateCueSheet(body.cues);
    if (errors.length > 0) {
      return NextResponse.json({ error: 'Invalid cues', detail: errors }, { status: 400 });
    }

    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from('cue_sheets')
      .upsert(
        {
          track_hash: trackHash,
          artist_email: artistEmail,
          artist_id: auth.user.id,
          track_label: trackLabel,
          fallback_behaviour: fallbackBehaviour,
          cues,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'track_hash,artist_email' }
      )
      .select('id, track_hash, artist_email, artist_id, track_label, fallback_behaviour, cues, updated_at')
      .single();

    if (error) {
      console.error('[cue-sheets] upsert failed:', error);
      return NextResponse.json({ error: 'Save failed' }, { status: 500 });
    }

    return NextResponse.json({ sheet: data });
  } catch (err) {
    console.error('[cue-sheets] request failed:', err);
    return NextResponse.json(
      { error: 'Request failed', detail: String(err?.message || err) },
      { status: 500 }
    );
  }
}
