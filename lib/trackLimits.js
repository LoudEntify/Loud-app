// lib/trackLimits.js
// ─────────────────────────────────────────────────────────────
// Backing-track upload numbers and its one path convention, mirroring
// lib/brollLimits.js exactly. Same shape on purpose: two media kinds
// sharing one bucket and one quota should not have two different ideas
// about how a path is built or where the security boundary is.
//
// PRD: Director Experience / Live Show (backing track)
// S&I: Stateless hosting (shared storage)
//
// The TOTAL is not here — it is shared with b-roll and lives in
// lib/mediaQuota.js. Only the per-file ceiling is track-specific.
// ─────────────────────────────────────────────────────────────

import { SHARED_BUCKET } from './mediaQuota';

export const TRACK_BUCKET = SHARED_BUCKET;

// ── WHY 30MB AND NOT B-ROLL'S 100 ─────────────────────────────
// 100MB is a video number. A backing track is a mixed stereo song: ~10MB
// as a 320kbps MP3 for five minutes, ~50MB as uncompressed WAV. 30MB
// admits every realistic compressed master and a short lossless one,
// while keeping a single artist from spending a fifth of the shared
// allowance on one file by accident.
//
// It is a ceiling, not a recommendation, and it is enforced twice: once
// against the browser's declared size so an over-limit file is refused
// before the transfer, and once at registration against the size
// STORAGE reports. Only the second is trusted.
export const MAX_TRACK_BYTES = 30 * 1024 * 1024;

// Deliberately permissive. Browsers disagree about what they report for
// the same file — audio/mpeg vs audio/mp3, audio/x-m4a vs audio/mp4 —
// and a strict allowlist rejects real files for cosmetic reasons. The
// decisive test is not the label anyway: decodeAudioData either decodes
// the bytes or it does not, and that happens client-side before any
// upload starts.
export function looksLikeAudio(contentType) {
  return typeof contentType === 'string' && contentType.startsWith('audio/');
}

/**
 * Where a track lives in the bucket.
 *
 * THE USER ID SEGMENT IS THE SECURITY BOUNDARY, identically to
 * brollObjectPath. The path is built server-side from the verified
 * session and never accepted from a client, so a signed upload URL can
 * only ever write into the folder of the account that asked for one.
 * Registration re-checks the prefix for the same reason: it is the one
 * thing that stops a path from one account being registered by another.
 */
export function trackObjectPath(userId, filename) {
  const safe = String(filename || 'track.mp3').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120);
  return `tracks/${userId}/${Date.now()}-${safe}`;
}

export function isOwnTrackPath(path, userId) {
  return typeof path === 'string' && path.startsWith(`tracks/${userId}/`);
}

/** Strip the extension for a default title, without mangling a dotless name. */
export function titleFromFilename(filename) {
  const base = String(filename || 'Untitled track').replace(/\.[^.]+$/, '');
  return base.trim() || 'Untitled track';
}

// The identity format, mirrored from app/api/cue-sheets/route.js so the
// routes here refuse anything cue_sheets could not key on. Same regex,
// same reason: a hash that does not match this shape does not break
// loudly, it silently stops cue sheets matching.
export const SHA256_RE = /^[0-9a-f]{64}$/;
