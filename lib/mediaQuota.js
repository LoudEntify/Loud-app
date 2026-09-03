// lib/mediaQuota.js
// ─────────────────────────────────────────────────────────────
// THE 500MB, defined once, for both kinds of media that consume it.
//
// PRD: Director Experience / Live Show (b-roll, backing tracks)
// S&I: Stateless hosting (shared storage), Database
//
// ── WHY THIS FILE EXISTS RATHER THAN A SECOND CONSTANT ────────
// lib/brollLimits.js already carries the warning, from the time it
// happened: the per-clip and total limits were declared twice, once in
// the UI and once in the upload route, which is how a UI ends up
// promising one number against a server enforcing another.
//
// Backing tracks now share that same 500MB. Copying MAX_TOTAL_BYTES
// into a tracks module would repeat the exact mistake that file was
// written to record, one directory over. So the total lives here, and
// brollLimits re-exports it rather than declaring its own.
//
// ── ONE QUOTA, TWO TABLES ─────────────────────────────────────
// The artist sees a single number. Underneath, usage is the sum of
// broll_clips.size_bytes and backing_tracks.size_bytes for that artist.
// Both are read from the DATABASE rather than from storage, because the
// registration routes only ever write a size they read back from
// storage itself — a client-declared size is a courtesy for failing
// fast and is never recorded.
//
// Deliberately dependency-free (no 'server-only', no supabase import)
// so the browser can render the same limit the routes enforce. The
// admin client is passed in rather than imported.
// ─────────────────────────────────────────────────────────────

export const SHARED_BUCKET = process.env.LIVEKIT_S3_BUCKET || 'recordings';

/** The whole allowance, across b-roll clips AND backing tracks. */
export const MAX_TOTAL_BYTES = 500 * 1024 * 1024;

export function megabytes(bytes) {
  return Math.round(((Number(bytes) || 0) / 1048576) * 10) / 10;
}

function sumSizes(rows) {
  return (rows || []).reduce((total, r) => total + (Number(r.size_bytes) || 0), 0);
}

/**
 * Detects "the migration has not been run" as distinct from "the query
 * failed", so a caller can say which. They need different answers: one
 * is a deploy step somebody owes, the other is an outage.
 */
export function isMissingRelation(error) {
  if (!error) return false;
  if (error.code === '42P01' || error.code === 'PGRST205') return true;
  return /relation .* does not exist|schema cache/i.test(error.message || '');
}

/**
 * What this artist is using, split by kind.
 *
 * Returns { ok:true, broll, tracks, used, limit, remaining } or
 * { ok:false, missing, error } — never throws, because every caller is
 * either about to refuse an upload politely or about to render a bar.
 *
 * ── BACKING TRACKS ARE TREATED AS ZERO IF NOT MIGRATED ────────
 * Deliberate. b-roll worked before this round and must keep working on
 * an environment where mvp2_01 has not been run yet; a missing
 * backing_tracks table means the artist has no uploaded tracks, which
 * is exactly zero bytes, not an error. The reverse is NOT true: a
 * missing broll_clips table is reported, because b-roll's own migration
 * is long-standing and its absence is a real misconfiguration.
 */
export async function readQuota(admin, artistId) {
  const { data: brollRows, error: brollErr } = await admin
    .from('broll_clips')
    .select('size_bytes')
    .eq('artist_id', artistId);

  if (brollErr) {
    return {
      ok: false,
      missing: isMissingRelation(brollErr) ? 'broll_clips' : null,
      error: brollErr.message || 'could not read b-roll usage',
    };
  }

  const { data: trackRows, error: trackErr } = await admin
    .from('backing_tracks')
    .select('size_bytes')
    .eq('artist_id', artistId);

  if (trackErr && !isMissingRelation(trackErr)) {
    return { ok: false, missing: null, error: trackErr.message || 'could not read track usage' };
  }

  const broll = sumSizes(brollRows);
  const tracks = trackErr ? 0 : sumSizes(trackRows);
  const used = broll + tracks;

  return {
    ok: true,
    broll,
    tracks,
    used,
    limit: MAX_TOTAL_BYTES,
    remaining: Math.max(0, MAX_TOTAL_BYTES - used),
    tracksTableMissing: !!trackErr,
  };
}

/**
 * The sentence an artist reads when an upload will not fit. One place,
 * so b-roll and tracks refuse in the same words with the same numbers.
 */
export function notEnoughSpaceMessage(quota, incomingBytes, whatToDelete = 'something') {
  const leftMb = megabytes(quota.remaining);
  const limitMb = Math.round(MAX_TOTAL_BYTES / 1048576);
  const needMb = megabytes(incomingBytes);
  return `Not enough space — that is ${needMb}MB and you have ${leftMb}MB left of your ${limitMb}MB `
    + `(b-roll ${megabytes(quota.broll)}MB, backing tracks ${megabytes(quota.tracks)}MB). `
    + `Delete ${whatToDelete} first.`;
}
