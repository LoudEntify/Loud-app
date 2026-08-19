// lib/trackHash.js
// ─────────────────────────────────────────────────────────────
// Cue-Sheet Director (CD-3). Backing tracks have no server-side
// existence -- lib/audioProcessing.js's loadBackingTrack decodes a file
// picked straight from the artist's device, never uploaded, never given
// an id (see that file's own note). A cue sheet still needs something
// stable to key on so it's recognized the next time "this track" loads,
// across sessions, filenames, and shows -- a content hash of the raw
// file bytes is the only thing that's actually stable given that.
//
// Client-only (crypto.subtle requires a secure context -- true for both
// the deployed HTTPS site and localhost).
// ─────────────────────────────────────────────────────────────

export async function computeTrackHash(file) {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
