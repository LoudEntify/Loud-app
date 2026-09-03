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

// ── THE TOTAL IS NOT DECLARED HERE ANY MORE ───────────────────
// It is shared with backing tracks (docs/mvp2_01_backing_tracks.sql),
// which upload into the same bucket and spend the same 500MB. Declaring
// it in both places would be the precise mistake this file's header
// records — a UI promising one number against a server enforcing
// another — so it has exactly one definition, in lib/mediaQuota.js, and
// is re-exported here so existing importers do not have to move.
export { MAX_TOTAL_BYTES, megabytes } from './mediaQuota';
import { SHARED_BUCKET } from './mediaQuota';

export const BROLL_BUCKET = SHARED_BUCKET;

export const MAX_CLIP_BYTES = 100 * 1024 * 1024;   // 100MB per clip

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
