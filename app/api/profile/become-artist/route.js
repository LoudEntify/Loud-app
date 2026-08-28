import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin';
import { verifySession } from '../../../../lib/verifyArtistAuth';

// Viewer → artist upgrade.
//
// Deliberately a SERVER route rather than a client-side profile update,
// even though profiles_update_own would technically permit the latter.
// Two reasons:
//   1. It creates one place to add the checks this will eventually need
//      -- terms acceptance, age thresholds, identity or payout
//      verification -- instead of discovering later that role can be
//      flipped from a browser console.
//   2. It keeps the upgrade auditable as a single named operation.
//
// One-way by design this round: there is no artist → viewer downgrade.
// Downgrading raises questions this round does not answer (what happens
// to scheduled shows, public recordings, an invited opponent), and a
// half-answered downgrade is worse than none.
//
// The account itself does not change. Same user id, same wallet ledger,
// same notifications, same history -- only capability is added.
// Kept server-side rather than imported from the client component: this
// check must not depend on anything a browser can edit.
const MIN_AGE = 18;

function ageFrom(dob) {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age -= 1;
  return age;
}

export async function POST(request) {
  try {
    // verifySession, NOT verifyArtistAuth: the person making this
    // request is by definition not an artist yet, so the artist check
    // would 403 the very request meant to make them one.
    const auth = await verifySession(request);
    if (auth.error) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { stage_name: stageName, genres, bio } = await request.json();

    const admin = getSupabaseAdmin();
    const { data: profile } = await admin
      .from('profiles')
      .select('id, role, username, display_name, date_of_birth')
      .eq('id', auth.user.id)
      .maybeSingle();

    if (!profile) {
      return NextResponse.json({ error: 'No profile found for this account.' }, { status: 404 });
    }
    if (profile.role === 'artist') {
      return NextResponse.json({ ok: true, alreadyArtist: true });
    }

    // 18+ enforced HERE, server-side, not only at signup. Standing launch
    // policy (paid voting mechanics, UK Online Safety Act exposure,
    // safeguarding), so it is re-checked at every point where someone
    // gains capability -- not assumed to have been checked earlier.
    //
    // A null date_of_birth means the account predates the field, and
    // there is no basis to assert they are 18. Refused rather than
    // waved through: the safe default for an age gate is "no".
    const age = ageFrom(profile.date_of_birth);
    if (age === null) {
      return NextResponse.json(
        { error: `Add your date of birth in settings first — Loudentify is ${MIN_AGE}+.` },
        { status: 403 }
      );
    }
    if (age < MIN_AGE) {
      return NextResponse.json(
        { error: `You must be at least ${MIN_AGE} to perform on Loudentify.` },
        { status: 403 }
      );
    }

    const trimmedStage = (stageName || '').trim();
    if (!trimmedStage) {
      return NextResponse.json({ error: 'A stage name is required.' }, { status: 400 });
    }

    // A viewer already HAS a username -- both roles share one namespace,
    // so nothing needs claiming here. The stage name is the display name
    // artists perform under, which is a separate, non-unique thing.
    const update = {
      role: 'artist',
      display_name: trimmedStage,
    };
    if (Array.isArray(genres)) update.genres = genres;
    if (typeof bio === 'string') update.bio = bio.trim() || null;

    const { error: updErr } = await admin.from('profiles').update(update).eq('id', auth.user.id);
    if (updErr) {
      console.error('[become-artist] update failed:', updErr);
      return NextResponse.json({ error: 'Could not upgrade this account.' }, { status: 500 });
    }

    return NextResponse.json({ ok: true, role: 'artist' });
  } catch (err) {
    console.error('[become-artist] request failed:', err);
    return NextResponse.json({ error: 'Request failed' }, { status: 500 });
  }
}
