// Uploading a file from the phone.
//
// ── WHAT WAS MISSING ──────────────────────────────────────────
// Studio Library listed and deleted and could not upload. The board's
// "Upload B-roll" button was deliberately not drawn, because picking a
// file needed a document picker this build did not carry and a button
// that opens nothing is the thing the rebuild existed to remove. So
// every clip and every backing track had to come from the website, and
// an artist standing in a venue with a phone could not add one.
//
// ── THE SHAPE, WHICH IS THE WEB'S ─────────────────────────────
// Three steps, the same three lib/brollUpload.js uses, through the same
// routes:
//
//   1. ask the server for a signed upload URL        (small JSON)
//   2. PUT the file straight to storage              (the big transfer)
//   3. ask the server to register it                 (small JSON)
//
// The middle step never touches our server, so a 100MB clip does not go
// through a serverless function — that is why the web does it this way,
// and copying the shape means one storage layout and one set of quota
// rules rather than a second definition of "your clips".
//
// ── WHY XHR AND NOT fetch ─────────────────────────────────────
// Same reason the web gives: fetch has no upload progress event, so a
// long upload can only ever be a spinner. React Native's XMLHttpRequest
// supports upload.onprogress and takes a { uri } file object directly,
// which is also the only way to send a content:// URI without reading
// the whole file into memory first.
//
// Every failure is named. The bug the web version replaced did not
// error, it hung; a timeout turns a dead transfer into a stated failure
// at a known moment instead of a spinner nobody can explain.
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import { api } from './api';
import { API_BASE } from './config';

const UPLOAD_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * The SHA-256 of the file's BYTES, which /api/tracks/upload-url requires
 * and refuses without — its own error says "this is a client bug, not a
 * bad file", and it was: the first native uploader never sent one, so
 * every backing-track upload from the phone failed at the first call.
 *
 * The hash is the track's identity, which is what makes an uploaded
 * track the same track as the local file an artist has been cueing
 * against, so it cannot be faked or skipped.
 *
 * Read whole rather than streamed: expo-crypto has no incremental
 * digest, and a backing track is capped at 30MB (lib/trackLimits.js),
 * which a phone can hold. B-roll is capped at 100MB and its route
 * wants no hash, which is why only tracks pay this cost.
 */
export async function sha256OfFile(uri) {
  const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  const bytes = Uint8Array.from(global.atob(base64), (c) => c.charCodeAt(0));
  const buf = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const KIND = Object.freeze({
  broll: {
    api: '/api/broll',
    type: ['video/*'],
    what: 'video',
    hashed: false,
    tooBig: 'That clip is over the limit. Trim it, or upload it on the website.',
  },
  track: {
    api: '/api/tracks',
    type: ['audio/*'],
    what: 'track',
    hashed: true,
    tooBig: 'That track is over the limit. Upload it on the website.',
  },
});

/**
 * storage-js has returned signedUrl as both an absolute URL and a
 * project-relative path across versions. Normalised here rather than in
 * the route, so an upgrade that changes the shape is one line in one
 * place instead of a broken upload nobody can explain.
 */
export function absoluteUploadUrl(signedUrl, base = API_BASE) {
  if (!signedUrl) return null;
  if (/^https?:\/\//i.test(signedUrl)) return signedUrl;
  const root = String(process.env.EXPO_PUBLIC_SUPABASE_URL || base || '').replace(/\/+$/, '');
  if (!root) return null;
  return `${root}${signedUrl.startsWith('/') ? '' : '/'}${signedUrl}`;
}

/** Open the picker. Returns the chosen file, or null if they backed out. */
export async function pickFile(kind) {
  const spec = KIND[kind];
  const res = await DocumentPicker.getDocumentAsync({
    type: spec.type,
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (res.canceled) return null;
  const f = res.assets?.[0];
  if (!f?.uri) return null;
  return { uri: f.uri, name: f.name || `${kind}-${Date.now()}`, size: Number(f.size) || 0, mimeType: f.mimeType || spec.type[0] };
}

/** The PUT, with progress. Resolves on 2xx and rejects with a sentence otherwise. */
function putFile({ url, file, contentType, onProgress }) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.timeout = UPLOAD_TIMEOUT_MS;
    if (contentType) xhr.setRequestHeader('content-type', contentType);
    xhr.upload.onprogress = (e) => {
      if (onProgress && e.lengthComputable && e.total > 0) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      // Storage answers with a body worth reading; a bare status is how
      // an upload becomes unexplainable.
      else reject(new Error(`Storage refused the file (${xhr.status}). ${String(xhr.responseText || '').slice(0, 160)}`));
    };
    xhr.onerror = () => reject(new Error('The connection dropped while uploading. Try again on a better signal.'));
    xhr.ontimeout = () => reject(new Error('That upload stalled and was stopped. Try again on a better connection.'));
    xhr.onabort = () => reject(new Error('Upload cancelled.'));
    // React Native sends { uri, name, type } without reading the file
    // into memory, which is what makes a content:// URI work at all.
    xhr.send({ uri: file.uri, name: file.name, type: contentType });
  });
}

/**
 * Pick, upload, register. `onProgress(fraction)` runs during the PUT,
 * which is the only part worth showing: the two JSON calls either side
 * are instant.
 *
 * Returns { ok, clip } or { ok: false, error } — never throws, because
 * every caller is a screen and a thrown upload is a blank screen.
 */
export async function uploadFile({ kind, file, accessToken, onProgress }) {
  const spec = KIND[kind];
  if (!spec) return { ok: false, error: 'Unknown kind of file.' };
  if (!file?.uri) return { ok: false, error: 'No file was chosen.' };

  let sha256 = null;
  if (spec.hashed) {
    try {
      sha256 = await sha256OfFile(file.uri);
    } catch (e) {
      return { ok: false, error: `We could not read that file to check it: ${String(e?.message || e)}` };
    }
  }

  const signed = await api(`${spec.api}/upload-url`, {
    method: 'POST',
    accessToken,
    body: { filename: file.name, size: file.size, contentType: file.mimeType, ...(sha256 ? { sha256 } : {}) },
  });
  if (!signed.ok) return { ok: false, error: signed.data?.error || `We could not start that upload.` };

  // Same artist, same bytes: the route skips the transfer and hands back
  // the track it already has. That is a success, not a duplicate — an
  // artist re-adding a track they already own should see it appear.
  if (signed.data?.alreadyHave) return { ok: true, clip: signed.data.track || null, alreadyHave: true };

  const url = absoluteUploadUrl(signed.data?.signedUrl);
  if (!url) return { ok: false, error: 'We could not work out where to send the file.' };

  try {
    await putFile({ url, file, contentType: signed.data?.contentType || file.mimeType, onProgress });
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }

  const reg = await api(`${spec.api}/register`, {
    method: 'POST',
    accessToken,
    body: { path: signed.data?.path, filename: file.name, ...(sha256 ? { sha256 } : {}) },
  });
  // The file is in storage at this point. A failed register is a thing
  // the artist should hear about plainly rather than a silent orphan.
  if (!reg.ok) return { ok: false, error: reg.data?.error || 'The file uploaded but we could not add it to your library.' };
  return { ok: true, clip: reg.data?.clip || reg.data?.track || null };
}
