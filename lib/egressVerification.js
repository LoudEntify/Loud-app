// lib/egressVerification.js
// ─────────────────────────────────────────────────────────────
// "Did the recording actually work?"
//
// Until tonight, nothing answered that. A `recordings` row said a file
// was SUPPOSED to exist; whether it landed, how long it was, and whether
// it contained any picture were all unknown until an artist clicked play
// on their own show and found out the hard way.
//
// The three failures worth catching are specific, and each has a check:
//
//   1. THE FILE NEVER LANDED. The egress "succeeded" and the S3 upload
//      did not. Caught by asking storage for the object and looking at
//      its size — not by trusting the egress result, which is written
//      before the upload finishes.
//   2. THE DURATION IS NONSENSE. A few hundred milliseconds means the
//      recorder started and died. Caught against a floor.
//   3. THE FILE HAS NO PICTURE. A room-composite egress of a room where
//      nobody published video produces a real file of real duration
//      containing nothing but audio. This is the nastiest of the three
//      because every other signal looks healthy — the file exists, the
//      duration is right, the size is plausible — and it is exactly what
//      an artist would never think to check until they watched it.
//
// Deliberately shared between the webhook and the manual verify route so
// there is ONE definition of "verified". Two implementations of a check
// like this diverge, and then a recording is verified by one path and
// suspect by the other with no way to tell which is right.
// ─────────────────────────────────────────────────────────────

import 'server-only';

// Under this and the recorder started and died. Ten seconds is short
// enough that a genuinely tiny show still passes and long enough that a
// crash never does.
const MIN_SANE_DURATION_MS = 10_000;

// A file this small cannot contain ten seconds of anything. Catches the
// zero-byte and near-empty upload without needing to guess a bitrate.
const MIN_SANE_BYTES = 50_000;

// LiveKit reports durations in NANOseconds. Converted here, at the
// boundary, rather than stored raw — nothing else in this product thinks
// in nanoseconds, and a mixed-unit column is a bug waiting for a reader.
export function nanosToMs(nanos) {
  const n = Number(nanos);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n / 1_000_000);
}

/**
 * Pull the useful parts out of a LiveKit EgressInfo, tolerating both the
 * protobuf object shape and the plain JSON a webhook delivers.
 *
 * `?? null` throughout rather than `|| null`: a duration of 0 and a size
 * of 0 are meaningful values (they are exactly the failures being looked
 * for) and must not be flattened into "unknown".
 */
export function describeEgressResult(egressInfo) {
  const file = (egressInfo?.fileResults || egressInfo?.file_results || [])[0] || {};
  const filename = file.filename || file.location || null;
  return {
    egressId: egressInfo?.egressId ?? egressInfo?.egress_id ?? null,
    roomName: egressInfo?.roomName ?? egressInfo?.room_name ?? null,
    status: egressInfo?.status ?? null,
    error: egressInfo?.error || null,
    filename,
    // The storage key, without the bucket or any URL wrapper — this is
    // what `recordings.storage_path` holds and what Storage is asked for.
    storagePath: filename ? String(filename).replace(/^https?:\/\/[^/]+\//, '').replace(/^\/+/, '') : null,
    durationMs: nanosToMs(file.duration),
    reportedBytes: file.size != null ? Number(file.size) : null,
    startedAt: egressInfo?.startedAt ?? egressInfo?.started_at ?? null,
    endedAt: egressInfo?.endedAt ?? egressInfo?.ended_at ?? null,
  };
}

/**
 * Ask STORAGE what is actually there.
 *
 * Deliberately not the egress result's own `size`: that number is written
 * when the recorder finishes muxing, before the S3 upload completes, so a
 * failed upload reports a healthy size for a file that does not exist.
 * The only trustworthy answer comes from the bucket.
 */
async function inspectObject(admin, bucket, storagePath) {
  if (!storagePath) return { found: false, bytes: null, reason: 'no storage path on the egress result' };
  const lastSlash = storagePath.lastIndexOf('/');
  const dir = lastSlash === -1 ? '' : storagePath.slice(0, lastSlash);
  const name = lastSlash === -1 ? storagePath : storagePath.slice(lastSlash + 1);

  try {
    const { data, error } = await admin.storage.from(bucket).list(dir, { search: name, limit: 100 });
    if (error) return { found: false, bytes: null, reason: `storage list failed: ${error.message}` };
    const match = (data || []).find((o) => o.name === name);
    if (!match) return { found: false, bytes: null, reason: 'object not present in the bucket' };
    // Supabase reports size under metadata; the shape has moved between
    // versions, so both are read rather than one being assumed.
    const bytes = match.metadata?.size ?? match.metadata?.contentLength ?? null;
    return { found: true, bytes: bytes == null ? null : Number(bytes), reason: null };
  } catch (err) {
    return { found: false, bytes: null, reason: `storage list threw: ${String(err?.message || err)}` };
  }
}

/**
 * Was there any video in the room while this was recording?
 *
 * Answered from our OWN telemetry rather than by probing the file,
 * because probing an MP4 for a video track means downloading and parsing
 * it, and this runs inside a webhook handler with a short budget.
 *
 * `health_events` already records every track publish in the room
 * (lib/healthLog.js, from the live page), so the question becomes: did
 * anyone publish a video track in this show. That is a proxy and is
 * labelled as one in the stored result — it can be wrong in one specific
 * direction, which is worth stating: video published but never SUBSCRIBED
 * by the recorder would read as has_video true against a file with no
 * picture. Catching that properly needs the file itself, and is the right
 * job for the export/transcode worker that does not exist yet.
 */
async function inferVideoPresence(admin, showId) {
  if (!showId) return { hasVideo: null, reason: 'no show id to check telemetry against' };
  try {
    const { data, error } = await admin
      .from('health_events')
      .select('event_type, detail')
      .eq('show_id', String(showId))
      .in('event_type', ['local_track_published', 'track_published', 'track_subscribed'])
      .limit(200);
    if (error) return { hasVideo: null, reason: `telemetry read failed: ${error.message}` };
    const events = data || [];
    if (events.length === 0) return { hasVideo: null, reason: 'no publish telemetry for this show' };
    const sawVideo = events.some((e) => {
      const kind = String(e.detail?.kind ?? e.detail?.source ?? '').toLowerCase();
      return kind.includes('video') || kind.includes('camera');
    });
    return { hasVideo: sawVideo, reason: sawVideo ? null : 'no video track publish recorded for this show' };
  } catch (err) {
    return { hasVideo: null, reason: `telemetry read threw: ${String(err?.message || err)}` };
  }
}

/**
 * Run every check, write the result, and log one health event per
 * outcome.
 *
 * Returns { ok, checks, recordingId } — `ok` false does NOT mean an
 * error occurred; it means the recording is suspect, which is a
 * successful outcome for this function.
 */
export async function verifyEgressResult(admin, egressInfo, { bucket, showId = null, artistId = null } = {}) {
  const summary = describeEgressResult(egressInfo);
  const checks = {};

  // ── 1. did the file land ────────────────────────────────────
  const object = await inspectObject(admin, bucket, summary.storagePath);
  const bytes = object.bytes ?? summary.reportedBytes ?? null;
  checks.file_present = {
    pass: object.found,
    detail: object.reason || `found in ${bucket}`,
  };
  checks.file_size = {
    pass: bytes != null && bytes >= MIN_SANE_BYTES,
    value: bytes,
    detail: bytes == null ? 'size unknown' : `${bytes} bytes (floor ${MIN_SANE_BYTES})`,
  };

  // ── 2. is the duration sane ─────────────────────────────────
  checks.duration_sane = {
    pass: summary.durationMs != null && summary.durationMs >= MIN_SANE_DURATION_MS,
    value: summary.durationMs,
    detail: summary.durationMs == null
      ? 'no duration reported'
      : `${summary.durationMs}ms (floor ${MIN_SANE_DURATION_MS}ms)`,
  };

  // ── 3. is there any picture ─────────────────────────────────
  const video = await inferVideoPresence(admin, showId);
  checks.video_present = {
    // null (unknown) is NOT a pass. A recording whose video presence
    // cannot be established is exactly the one worth looking at by hand.
    pass: video.hasVideo === true,
    value: video.hasVideo,
    inferred: true,
    detail: video.reason || 'video publish recorded for this show',
  };

  // ── 4. did the egress itself report an error ────────────────
  checks.egress_ok = {
    pass: !summary.error,
    detail: summary.error || 'no error reported by LiveKit',
  };

  const ok = Object.values(checks).every((c) => c.pass);
  const now = new Date().toISOString();

  // ── Write it down ───────────────────────────────────────────
  // Upsert on storage_path — the natural key, unique and plain (see
  // docs/overnight2_10_recordings.sql). This resolves to ONE row whether
  // the recording was already synced, arrives twice, or is being seen for
  // the first time.
  let recordingId = null;
  if (summary.storagePath) {
    const patch = {
      storage_path: summary.storagePath,
      egress_id: summary.egressId,
      duration_ms: summary.durationMs,
      size_bytes: bytes,
      has_video: video.hasVideo,
      verified_at: now,
      verification: { ok, checks, verified_at: now },
      ended_reason: summary.error || null,
    };
    // artist_id and recorded_at are NOT NULL on this table, so an upsert
    // that might INSERT has to carry them. Only supplied when known —
    // where they are not, the update path is used instead, which is the
    // normal case (the row already exists from recordings/sync).
    if (artistId) {
      patch.artist_id = artistId;
      patch.recorded_at = summary.startedAt ? new Date(Number(summary.startedAt) / 1_000_000 || summary.startedAt).toISOString() : now;
      if (showId) patch.show_id = showId;
    }

    const { data, error } = artistId
      ? await admin.from('recordings').upsert(patch, { onConflict: 'storage_path' }).select('id').maybeSingle()
      : await admin.from('recordings').update(patch).eq('storage_path', summary.storagePath).select('id').maybeSingle();

    if (error) {
      console.error('[egress-verify] could not write verification:', error);
      checks.persisted = { pass: false, detail: error.message };
    } else {
      recordingId = data?.id || null;
      checks.persisted = { pass: true, detail: recordingId ? 'recording row updated' : 'no matching recording row yet' };
    }
  }

  // ── One health event per result ─────────────────────────────
  // Under the show's own id where we have it, so a recording problem sits
  // in the same timeline as whatever else went wrong during that show.
  try {
    await admin.from('health_events').insert({
      show_id: String(showId || summary.roomName || 'egress'),
      participant_identity: null,
      role: 'egress',
      event_type: ok ? 'egress_verified_ok' : 'egress_verified_suspect',
      detail: {
        egressId: summary.egressId,
        storagePath: summary.storagePath,
        durationMs: summary.durationMs,
        bytes,
        hasVideo: video.hasVideo,
        failed: Object.entries(checks).filter(([, c]) => !c.pass).map(([k]) => k),
      },
      client_ts: now,
    });
  } catch {
    // Diagnostics must never fail the thing they diagnose.
  }

  return { ok, checks, recordingId, summary };
}
