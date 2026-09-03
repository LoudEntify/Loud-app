// lib/trackHash.js
// ─────────────────────────────────────────────────────────────
// Cue-Sheet Director (CD-3). A cue sheet needs something stable to key
// on so it is recognised the next time "this track" loads, across
// sessions, filenames, shows -- and now devices.
//
// ── WHY A CONTENT HASH, ORIGINALLY ────────────────────────────
// Backing tracks had NO server-side existence: loadBackingTrack decoded
// a file picked straight from the artist's device, never uploaded,
// never given an id. A content hash of the raw bytes was the only
// stable identity such a file could have.
//
// ── WHY IT IS STILL A CONTENT HASH, NOW THAT UPLOADS EXIST ────
// MVP round 2 added uploaded tracks (docs/mvp2_01_backing_tracks.sql),
// which DO have a server-side id. The hash did not become redundant --
// it became the thing that makes the two kinds interchangeable. A file
// picked locally and the same file uploaded produce the same digest, so
// one cue sheet matches both, and an artist who uploads a track they
// have been cueing against locally keeps every cue.
//
// That is a property this function must not break. It is verified
// rather than assumed: File and Blob hash identically here (File IS a
// Blob), the digest is lowercase 64-char hex, filename and MIME type do
// not affect it, and arbitrary non-audio bytes hash fine -- which is
// what proves nothing in this path decodes or re-encodes. If this
// function is ever changed, that is the property to re-test.
//
// Client-only (crypto.subtle requires a secure context -- true for both
// the deployed HTTPS site and localhost).
// ─────────────────────────────────────────────────────────────

export async function computeTrackHash(file) {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
