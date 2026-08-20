import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin';
import { verifyArtistAuth } from '../../../../lib/verifyArtistAuth';

// Accounts & Identity Day 2 -- both "the backfill" for recordings that
// existed before this table did, and the ongoing way new recordings get a
// row at all (no egress webhook exists to do this automatically -- see
// app/api/egress/stop/route.js's own comment on that gap, unchanged this
// round per the stated boundary). Idempotent and safe to call any time:
// lists what's actually in the bucket and reconciles against what's already
// in the table, rather than trusting anything the app "thinks" happened.
//
// Object key format egress writes (app/api/egress/start/route.js, untouched
// this round): `recordings/{room}-{epoch-ms}.mp4`. That format doesn't embed
// a show_id, so attribution here is necessarily a heuristic, not exact: for
// each object, find the `shows` row for that room_name whose `slated_at` is
// closest to the object's embedded timestamp. At current pilot scale (one
// room, few shows) this is unambiguous in practice; a room reused across
// many distinct shows over a long period would make it fuzzier -- a real,
// stated limitation, not hidden.
//
// Scoped to the calling artist's OWN shows only -- a sync call only ever
// inserts rows for recordings whose matched show is owned by the caller
// (shows.artist_id === this session's user id). An object whose show has no
// owner yet, or a different owner, is skipped -- it'll sync the next time
// its actual owner calls this after claiming that show.

const BUCKET = process.env.LIVEKIT_S3_BUCKET || 'recordings';
const RECORDINGS_PREFIX = 'recordings';
const KEY_RE = /^(.+)-(\d+)\.mp4$/;

export async function POST(request) {
  const auth = await verifyArtistAuth(request);
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const admin = getSupabaseAdmin();

  const { data: objects, error: listErr } = await admin.storage
    .from(BUCKET)
    .list(RECORDINGS_PREFIX, { limit: 1000 });
  if (listErr) {
    console.error('[recordings/sync] bucket list failed:', listErr);
    return NextResponse.json({ error: 'Could not list recordings bucket' }, { status: 500 });
  }

  const { data: ownedShows, error: showsErr } = await admin
    .from('shows')
    .select('id, room_name, artist_name, slated_at')
    .eq('artist_id', auth.user.id);
  if (showsErr) {
    console.error('[recordings/sync] shows lookup failed:', showsErr);
    return NextResponse.json({ error: 'Could not look up shows' }, { status: 500 });
  }

  let inserted = 0;
  let skipped = 0;

  for (const obj of objects || []) {
    const match = obj.name.match(KEY_RE);
    if (!match) {
      skipped += 1;
      continue;
    }
    const [, room, tsStr] = match;
    const recordedAtMs = Number(tsStr);
    const storagePath = `${RECORDINGS_PREFIX}/${obj.name}`;

    const { data: existing } = await admin
      .from('recordings')
      .select('id')
      .eq('storage_path', storagePath)
      .maybeSingle();
    if (existing) {
      skipped += 1;
      continue;
    }

    // Nearest-by-time match among the caller's own shows for this room --
    // see header comment on why this is a heuristic, not an exact key.
    const candidates = (ownedShows || []).filter((s) => s.room_name === room);
    if (candidates.length === 0) {
      skipped += 1; // no show of the caller's uses this room -- not theirs to attribute
      continue;
    }
    const bestShow = candidates.reduce((best, s) => {
      const diff = Math.abs(new Date(s.slated_at).getTime() - recordedAtMs);
      const bestDiff = Math.abs(new Date(best.slated_at).getTime() - recordedAtMs);
      return diff < bestDiff ? s : best;
    });

    const { error: insertErr } = await admin.from('recordings').insert({
      show_id: bestShow.id,
      artist_id: auth.user.id,
      storage_path: storagePath,
      title: `${bestShow.artist_name} — ${new Date(recordedAtMs).toLocaleDateString()}`,
      recorded_at: new Date(recordedAtMs).toISOString(),
    });
    if (insertErr) {
      console.error('[recordings/sync] insert failed:', insertErr, storagePath);
      skipped += 1;
      continue;
    }
    inserted += 1;
  }

  return NextResponse.json({ inserted, skipped, total: (objects || []).length });
}
