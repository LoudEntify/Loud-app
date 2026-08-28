'use client';

// lib/brollUpload.js
// ─────────────────────────────────────────────────────────────
// The three-step upload, client side.
//
//   1. ask the server for a signed upload URL (small JSON)
//   2. PUT the file STRAIGHT TO STORAGE (the only big transfer, and the
//      only one the artist waits on)
//   3. ask the server to register it (small JSON)
//
// ── WHY XHR AND NOT fetch ──
// `fetch()` has no upload progress. There is no event, no stream hook,
// nothing — a 50MB upload through fetch can only ever be shown as a
// spinner, which is exactly what "WORKING…" was. `XMLHttpRequest` has
// `upload.onprogress`, so this uses it. That is the entire reason; there
// is no other advantage and no intention to use it anywhere else.
//
// ── AND WHY EVERY FAILURE PATH IS EXPLICIT ──
// The bug this replaces did not error. It hung. So each of the four ways
// this can fail — timeout, network drop, an HTTP error from storage, an
// abort — is wired to its own message, and a `timeout` is set so a stall
// becomes a stated failure at a known moment rather than an indefinite
// wait with a spinner on it.
// ─────────────────────────────────────────────────────────────

import { MAX_CLIP_BYTES, MAX_TOTAL_BYTES, megabytes } from './brollLimits';

// A 100MB clip on a slow-but-real connection (~1.5Mbps up) takes about
// nine minutes. Fifteen leaves headroom without letting a genuinely dead
// transfer sit there forever — which is the failure being fixed.
const UPLOAD_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * storage-js has returned `signedUrl` as both an absolute URL and a
 * project-relative path across versions. Normalised here rather than in
 * the route, so an upgrade that changes the shape is one line in one
 * place instead of a broken upload nobody can explain.
 */
function absoluteUploadUrl(signedUrl) {
  if (!signedUrl) return null;
  if (/^https?:\/\//i.test(signedUrl)) return signedUrl;
  const base = String(process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '');
  if (!base) return null;
  const suffix = signedUrl.startsWith('/') ? signedUrl : `/${signedUrl}`;
  // storage-js returns this relative to /storage/v1 when it is relative.
  return suffix.startsWith('/storage/v1') ? `${base}${suffix}` : `${base}/storage/v1${suffix}`;
}

function putWithProgress({ url, file, contentType, onProgress, signal }) {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url, true);
    xhr.timeout = UPLOAD_TIMEOUT_MS;
    if (contentType) xhr.setRequestHeader('Content-Type', contentType);
    // The signed URL is a one-shot write to one path; refusing to
    // overwrite means a replayed URL cannot quietly replace a clip that
    // has already been registered.
    xhr.setRequestHeader('x-upsert', 'false');

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) {
        onProgress?.(Math.min(99, Math.round((e.loaded / e.total) * 100)));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) { resolve({ ok: true }); return; }
      // Storage answers with JSON on failure; fall back to the status
      // line rather than showing an empty message.
      let detail = `HTTP ${xhr.status}`;
      try {
        const parsed = JSON.parse(xhr.responseText);
        detail = parsed.message || parsed.error || detail;
      } catch { /* keep the status line */ }
      resolve({ ok: false, error: `Storage refused the upload — ${detail}` });
    };

    xhr.onerror = () => resolve({
      ok: false,
      error: 'The connection dropped during the upload. Nothing was saved — try again.',
    });
    xhr.ontimeout = () => resolve({
      ok: false,
      error: 'The upload timed out. Check your connection, or try a shorter clip.',
    });
    xhr.onabort = () => resolve({ ok: false, error: 'Upload cancelled.', aborted: true });

    signal?.addEventListener('abort', () => xhr.abort(), { once: true });

    xhr.send(file);
  });
}

/**
 * Upload one clip.
 *
 * Returns { ok, clip } or { ok: false, error }. Never throws — every
 * caller of this is a click handler in a UI that has to say something
 * useful, and an exception there is a silent failure.
 *
 * onProgress receives 0–100. It reaches 100 only after registration, so
 * the bar completing means the clip is genuinely in the library rather
 * than merely in storage.
 */
export async function uploadBrollClip({ file, accessToken, usedBytes = 0, onProgress, signal }) {
  if (!file) return { ok: false, error: 'No file selected.' };
  if (!String(file.type || '').startsWith('video/')) {
    return { ok: false, error: 'B-roll must be a video file.' };
  }
  // Checked here purely so an obviously-too-big file fails instantly
  // instead of after a round trip. The server refuses it too, and the
  // server is what actually enforces it.
  if (file.size > MAX_CLIP_BYTES) {
    return { ok: false, error: `That clip is ${megabytes(file.size)}MB. The limit is ${megabytes(MAX_CLIP_BYTES)}MB per clip.` };
  }
  if (usedBytes + file.size > MAX_TOTAL_BYTES) {
    const left = Math.max(0, MAX_TOTAL_BYTES - usedBytes);
    return { ok: false, error: `Not enough space — ${megabytes(left)}MB left of your ${megabytes(MAX_TOTAL_BYTES)}MB. Delete a clip first.` };
  }

  onProgress?.(0);

  // ── 1. signed URL ─────────────────────────────────────────
  let minted;
  try {
    const res = await fetch('/api/broll/upload-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ filename: file.name, size: file.size, contentType: file.type }),
    });
    minted = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: minted.error || 'Could not start the upload.' };
  } catch {
    return { ok: false, error: 'Could not reach the server to start the upload.' };
  }

  const url = absoluteUploadUrl(minted.signedUrl);
  if (!url) return { ok: false, error: 'The server did not return a usable upload URL.' };

  // ── 2. the bytes, straight to storage ─────────────────────
  const put = await putWithProgress({ url, file, contentType: file.type, onProgress, signal });
  if (!put.ok) return { ok: false, error: put.error, aborted: put.aborted };

  // ── 3. register ───────────────────────────────────────────
  // Deliberately NOT at 100 yet: the file exists but the library does
  // not know about it, and showing a completed bar for a clip that then
  // fails to register would be the same class of lie as the old spinner.
  onProgress?.(99);
  try {
    const res = await fetch('/api/broll/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ path: minted.path, filename: file.name }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: body.error || 'The clip uploaded but could not be saved.' };
    onProgress?.(100);
    return { ok: true, clip: body.clip };
  } catch {
    return { ok: false, error: 'The clip uploaded but the server could not be reached to save it.' };
  }
}
