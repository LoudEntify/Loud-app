// lib/brollLimits.js
// ─────────────────────────────────────────────────────────────
// B-roll's numbers and its one path convention, in a single module both
// the browser and the server import.
//
// Deliberately dependency-free (no 'server-only', no supabase import) so
// the client can render an accurate limit and the routes can enforce the
// same one. The previous version had these constants declared twice —
// once in `components/BRollLibrary.jsx` and once in the upload route —
// which is how a UI ends up promising 100MB against a server that
// enforces something else.
// ─────────────────────────────────────────────────────────────

export const BROLL_BUCKET = process.env.LIVEKIT_S3_BUCKET || 'recordings';

export const MAX_CLIP_BYTES = 100 * 1024 * 1024;   // 100MB per clip
export const MAX_TOTAL_BYTES = 500 * 1024 * 1024;  // 500MB per artist

export function megabytes(bytes) {
  return Math.round(((Number(bytes) || 0) / 1048576) * 10) / 10;
}

/**
 * Where a clip lives in the bucket.
 *
 * THE USER ID SEGMENT IS THE SECURITY BOUNDARY. The path is built
 * server-side from the verified session and never accepted from a
 * client, so a signed upload URL can only ever write into the folder of
 * the account that asked for one. Registration re-checks the prefix for
 * the same reason: it is the one thing that stops a path from one
 * account being registered by another.
 */
export function brollObjectPath(userId, filename) {
  const safe = String(filename || 'clip.mp4').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120);
  return `broll/${userId}/${Date.now()}-${safe}`;
}

export function isOwnBrollPath(path, userId) {
  return typeof path === 'string' && path.startsWith(`broll/${userId}/`);
}

/** Strip the extension for a default title, without mangling a dotless name. */
export function titleFromFilename(filename) {
  const base = String(filename || 'Untitled clip').replace(/\.[^.]+$/, '');
  return base.trim() || 'Untitled clip';
}
