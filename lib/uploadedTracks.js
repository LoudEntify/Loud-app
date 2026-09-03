'use client';

// lib/uploadedTracks.js
// ─────────────────────────────────────────────────────────────
// The browser half of uploaded backing tracks.
//
// PRD: Director Experience / Live Show (backing track)
// S&I: Stateless hosting (shared storage), Database
//
// ── THE PROPERTY EVERYTHING HERE RESTS ON ─────────────────────
// A track uploaded to storage and the same file picked off the artist's
// device produce the SAME sha256, so they are the same track to
// cue_sheets and to show_session_state. That was verified against the
// shipped computeTrackHash before this module was written: File and
// Blob hash identically, the digest is lowercase 64-char hex, filename
// and MIME type do not affect it, and arbitrary non-audio bytes hash
// fine — which proves nothing in the path decodes or re-encodes.
//
// So the bytes fetched back here go through exactly the same two calls
// a locally picked file does — computeTrackHash and loadBackingTrack,
// both of which take any Blob — and a cue sheet authored against the
// local copy matches the uploaded one without anything being migrated.
//
// ── WHY THIS EXISTS AT ALL ────────────────────────────────────
// A locally picked file cannot be reopened after a reload without a
// fresh user gesture. That is a browser rule and no server state
// changes it, which is why needsRepick() and the "re-select Track.mp3
// to resume at 2:14" prompt exist. An uploaded track has no such
// problem: the app fetches the bytes itself. This module is what turns
// that prompt into a silent reload for tracks that have been uploaded.
// ─────────────────────────────────────────────────────────────

/**
 * Does this artist have an uploaded copy of this exact track?
 *
 * Returns the row, or null. Never throws: every caller is deciding
 * between "fetch it silently" and "ask the artist to re-pick", and an
 * unreachable API means the honest answer is the second one.
 */
export async function findUploadedTrackByHash(sha256, accessToken) {
  if (!sha256 || !accessToken) return null;
  try {
    const res = await fetch(`/api/tracks?sha256=${encodeURIComponent(sha256)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => ({}));
    return data.track || null;
  } catch {
    return null;
  }
}

/** Every uploaded track, plus the shared quota. */
export async function listUploadedTracks(accessToken) {
  if (!accessToken) return { tracks: [], quota: null, notMigrated: false };
  try {
    const res = await fetch('/api/tracks', { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) return { tracks: [], quota: null, notMigrated: false };
    const data = await res.json().catch(() => ({}));
    return { tracks: data.tracks || [], quota: data.quota || null, notMigrated: !!data.notMigrated };
  } catch {
    return { tracks: [], quota: null, notMigrated: false };
  }
}

/**
 * Fetch a track's bytes.
 *
 * Two hops by design: a signed URL from our own route (which is where
 * ownership is enforced), then the object straight from storage. The
 * bytes never pass through a function — same reasoning as the upload
 * side, and the reason a 30MB track does not need to fit in a serverless
 * response.
 */
export async function fetchUploadedTrackBlob(trackId, accessToken) {
  const res = await fetch(`/api/tracks/url?id=${encodeURIComponent(trackId)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Could not open that track (${res.status})`);
  }
  const { url, sha256, title } = await res.json();
  const objectRes = await fetch(url);
  if (!objectRes.ok) throw new Error(`Could not download that track (${objectRes.status})`);
  const blob = await objectRes.blob();
  return { blob, sha256, title };
}

/**
 * Upload a track the artist picked, in the same two steps b-roll uses.
 *
 * `sha256` is computed by the CALLER from the same File object, before
 * this runs — deliberately, because the hash is the identity and a
 * route that had to invent one after the bytes landed would either
 * orphan the object or key it wrong.
 *
 * onProgress receives 0..1. XHR rather than fetch for exactly one
 * reason: fetch gives no upload progress, and a 30MB file with no
 * feedback looks identical to a hang.
 */
export async function uploadTrack({ file, sha256, durationMs, accessToken, onProgress }) {
  const startRes = await fetch('/api/tracks/upload-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      filename: file.name,
      size: file.size,
      contentType: file.type || 'audio/mpeg',
      sha256,
    }),
  });
  const start = await startRes.json().catch(() => ({}));
  if (!startRes.ok) throw new Error(start.error || `Could not start the upload (${startRes.status})`);

  // The artist already has these exact bytes. Not an error — the same
  // track, already theirs, and re-transferring it would be waste.
  if (start.alreadyHave) return { track: start.track, alreadyHave: true };

  await putToSignedUrl(start, file, onProgress);

  const regRes = await fetch('/api/tracks/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ path: start.path, sha256, filename: file.name, durationMs }),
  });
  const reg = await regRes.json().catch(() => ({}));
  if (!regRes.ok) throw new Error(reg.error || `Could not save that track (${regRes.status})`);
  return { track: reg.track, quota: reg.quota, alreadyHave: false };
}

function putToSignedUrl(start, file, onProgress) {
  // storage-js has returned signedUrl as both an absolute URL and a
  // project-relative path across versions. The route passes through
  // whatever it got rather than guessing; normalising is done here, once.
  const url = /^https?:\/\//i.test(start.signedUrl)
    ? start.signedUrl
    : `${window.location.origin}${start.signedUrl.startsWith('/') ? '' : '/'}${start.signedUrl}`;

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url, true);
    if (start.contentType) xhr.setRequestHeader('Content-Type', start.contentType);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error('Upload failed — the connection dropped.'));
    xhr.send(file);
  });
}

export async function deleteUploadedTrack(trackId, accessToken) {
  const res = await fetch('/api/tracks/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ id: trackId }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Could not delete that track (${res.status})`);
  return body.quota || null;
}
