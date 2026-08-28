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

  // ── LIBRARY MODE (Product Ruling 2) ───────────────────────────
  // Every sheet this artist has, across every track. The rest of this
  // route is scoped to one track_hash because that is what the editor
  // needs; a management surface needs the opposite, and inventing a
  // second route for the same table would be worse than one flag.
  //
  // Scoped to the VERIFIED session's own id/email, never to a parameter
  // -- there is no way to ask this for somebody else's library because
  // there is nothing to ask with.
  if (searchParams.get('all') === '1') {
    try {
      const admin = getSupabaseAdmin();
      const { data, error } = await admin
        .from('cue_sheets')
        .select('id, track_hash, artist_email, artist_id, name, track_label, fallback_behaviour, cues, updated_at')
        .or(`artist_id.eq.${auth.user.id},artist_email.eq.${normalizeEmail(auth.user.email)}`)
        .order('updated_at', { ascending: false })
        .limit(200);
      if (error) {
        console.error('[cue-sheets] library fetch failed:', error);
        return NextResponse.json({ error: 'Fetch failed' }, { status: 500 });
      }
      return NextResponse.json({ sheets: data || [] });
    } catch (err) {
      console.error('[cue-sheets] library request failed:', err);
      return NextResponse.json({ error: 'Request failed' }, { status: 500 });
    }
  }

  const trackHash = searchParams.get('track_hash') || '';
  // ── artist_email COMES FROM THE SESSION, NOT THE REQUEST ──────
  //
  // Security round finding 4 (docs/SECURITY_AUDIT_2026-08-28.md). This
  // read the `artist_email` query parameter and queried by it, having
  // verified only that the caller was *an* artist — so any artist
  // account could read any other artist's cue sheets for a track, given
  // their email address.
  //
  // The parameter is still ACCEPTED and still validated, because every
  // existing caller sends it and rejecting it outright would 400 the
  // editor mid-deploy. It is simply no longer trusted: it is compared
  // against the session's own email, and a mismatch is refused rather
  // than quietly answered with the caller's own data — silently
  // substituting would make a client bug look like a working feature.
  //
  // PATCH and DELETE in this same file already did this correctly, via
  // ownsSheet() below. They were written later, for Product Ruling 2,
  // and the two methods above were never brought into line. That is the
  // whole defect: a file can be half-secured and read as secured.
  const sessionEmail = normalizeEmail(auth.user.email);
  const requestedEmail = normalizeEmail(searchParams.get('artist_email'));
  if (requestedEmail && requestedEmail !== sessionEmail) {
    return NextResponse.json(
      { error: 'You can only read your own cue sheets.' },
      { status: 403 }
    );
  }
  const artistEmail = sessionEmail;
  // Named cue sheets: `name` selects one sheet from the artist's library
  // for this track. Omitting it lists every sheet they have for the
  // track, which is what the picker needs. `list=1` forces list mode.
  const name = (searchParams.get('name') || '').trim();
  const listMode = searchParams.get('list') === '1' || !name;

  if (!TRACK_HASH_RE.test(trackHash)) {
    return NextResponse.json({ error: 'Invalid track_hash' }, { status: 400 });
  }
  // Now validating the SESSION's email, not a parameter — so a failure
  // here is an account without a usable email address, not a bad
  // request. Said accurately: "Invalid artist_email" would send someone
  // looking at their client code for a bug that is not there.
  if (!EMAIL_RE.test(artistEmail)) {
    return NextResponse.json({ error: 'This account has no email address to file cue sheets under.' }, { status: 403 });
  }

  try {
    const admin = getSupabaseAdmin();
    const query = admin
      .from('cue_sheets')
      .select('id, track_hash, artist_email, name, track_label, fallback_behaviour, cues, updated_at')
      .eq('track_hash', trackHash)
      .eq('artist_email', artistEmail);

    // One sheet by name, or the whole library for this track.
    const { data: rows, error } = listMode
      ? await query.order('updated_at', { ascending: false })
      : await query.eq('name', name).limit(1);

    if (error) {
      console.error('[cue-sheets] fetch failed:', error);
      return NextResponse.json({ error: 'Fetch failed' }, { status: 500 });
    }
    const list = rows || [];
    // Backwards compatible on purpose: existing callers (AudioDeckPanel's
    // cue-sheet load) read `sheet` and know nothing about names, so list
    // mode still returns the most recently updated sheet as `sheet` and
    // adds `sheets` alongside for the new picker.
    const data = listMode ? (list[0] ?? null) : (list[0] ?? null);

    // No sheet for this track/artist yet is a normal state (a freshly
    // loaded track that's never been authored against), not an error --
    // 200 with a null sheet, not 404.
    return NextResponse.json({ sheet: data ?? null, sheets: list });
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
    // Same rule as GET, and this is the half with teeth. The upsert
    // below conflicts on (track_hash, artist_email, name) — so a
    // request naming somebody else's email did not read their sheet,
    // it OVERWROTE it. Including, by default, the one called 'Default'
    // that their show is about to load.
    const sessionEmail = normalizeEmail(auth.user.email);
    const requestedEmail = normalizeEmail(body.artist_email);
    if (requestedEmail && requestedEmail !== sessionEmail) {
      return NextResponse.json(
        { error: 'You can only save cue sheets to your own account.' },
        { status: 403 }
      );
    }
    const artistEmail = sessionEmail;
    const trackLabel = typeof body.track_label === 'string' ? body.track_label.slice(0, 500) : null;
    const fallbackBehaviour = body.fallback_behaviour;

    if (!TRACK_HASH_RE.test(trackHash)) {
      return NextResponse.json({ error: 'Invalid track_hash' }, { status: 400 });
    }
    if (!EMAIL_RE.test(artistEmail)) {
      return NextResponse.json({ error: 'This account has no email address to file cue sheets under.' }, { status: 403 });
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
          // Defaults to 'Default' so a save from a client that predates
          // named sheets still lands on a real, selectable row rather
          // than a null-named one.
          name: (body.name || 'Default').trim() || 'Default',
          artist_id: auth.user.id,
          track_label: trackLabel,
          fallback_behaviour: fallbackBehaviour,
          cues,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'track_hash,artist_email,name' }
      )
      .select('id, track_hash, artist_email, artist_id, name, track_label, fallback_behaviour, cues, updated_at')
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


// ─── RENAME (Product Ruling 2) ───────────────────────────────
// A sheet's NAME is the whole point of a library -- "Slow version",
// "Festival cut" -- and a name you cannot change is a name you have to
// get right first time, before you know what the sheet turns out to be.
//
// OWNERSHIP is re-checked against the row, not inferred from the fact
// that the caller is an artist. `artist_id` is the modern column and
// `artist_email` the legacy one; a sheet authored before
// docs/ownership_migration.sql has a null artist_id, so both are
// accepted and either matching is sufficient. Without the email branch,
// renaming would silently fail on exactly the oldest sheets -- the ones
// most likely to need a better name.
export async function PATCH(request) {
  const auth = await verifyArtistAuth(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = await request.json().catch(() => ({}));
    const id = String(body.id || '');
    const name = String(body.name || '').trim().slice(0, 80);
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
    if (!name) return NextResponse.json({ error: 'Give the sheet a name.' }, { status: 400 });

    const admin = getSupabaseAdmin();
    const { data: sheet } = await admin
      .from('cue_sheets')
      .select('id, artist_id, artist_email')
      .eq('id', id)
      .maybeSingle();

    if (!sheet || !ownsSheet(sheet, auth)) {
      // Same answer for "no such sheet" and "not yours" -- a caller
      // probing ids learns nothing from the response.
      return NextResponse.json({ error: 'That cue sheet does not belong to this account.' }, { status: 403 });
    }

    const { data, error } = await admin
      .from('cue_sheets')
      .update({ name, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('id, track_hash, artist_email, name, track_label, fallback_behaviour, cues, updated_at')
      .single();

    if (error) {
      // The unique index is (track_hash, artist_email, name) -- two
      // sheets for one track cannot share a name. That is a real user
      // mistake with a real answer, not a 500.
      if (error.code === '23505') {
        return NextResponse.json({ error: `You already have a sheet called “${name}” for this track.` }, { status: 409 });
      }
      console.error('[cue-sheets] rename failed:', error);
      return NextResponse.json({ error: 'Rename failed' }, { status: 500 });
    }
    return NextResponse.json({ sheet: data });
  } catch (err) {
    console.error('[cue-sheets] rename request failed:', err);
    return NextResponse.json({ error: 'Request failed' }, { status: 500 });
  }
}

// ─── DELETE (Product Ruling 2) ───────────────────────────────
// Same ownership check as rename. Deliberately a hard delete: a cue
// sheet is the artist's own working material with no downstream
// references and nothing financial attached, so a soft-delete would be
// a hidden row nobody could ever see again -- clutter rather than
// safety. (Contrast wallet_transactions, which is append-only for
// exactly the opposite reason.)
export async function DELETE(request) {
  const auth = await verifyArtistAuth(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id') || '';
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    const admin = getSupabaseAdmin();
    const { data: sheet } = await admin
      .from('cue_sheets')
      .select('id, artist_id, artist_email')
      .eq('id', id)
      .maybeSingle();

    if (!sheet || !ownsSheet(sheet, auth)) {
      return NextResponse.json({ error: 'That cue sheet does not belong to this account.' }, { status: 403 });
    }

    const { error } = await admin.from('cue_sheets').delete().eq('id', id);
    if (error) {
      console.error('[cue-sheets] delete failed:', error);
      return NextResponse.json({ error: 'Delete failed' }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[cue-sheets] delete request failed:', err);
    return NextResponse.json({ error: 'Request failed' }, { status: 500 });
  }
}

/**
 * Does this sheet belong to the caller?
 *
 * Both columns, because they are two eras of the same fact:
 * `artist_email` is how sheets were owned before
 * docs/ownership_migration.sql, `artist_id` is how they are owned now,
 * and rows from before that migration have a null id. Checking only the
 * modern column would lock an artist out of their own oldest sheets.
 */
function ownsSheet(sheet, auth) {
  if (sheet.artist_id && sheet.artist_id === auth.user.id) return true;
  const email = normalizeEmail(auth.user.email);
  return !!email && normalizeEmail(sheet.artist_email) === email;
}
