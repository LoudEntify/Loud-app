// Getting an uploaded backing track onto the phone and into the show.
//
// The last piece of the phone being a position an artist can perform
// from. The console can drive a loaded track (#62) and the mixer can put
// it into the broadcast (#58); nothing could put a track there.
//
// ── WHY IT DOWNLOADS ──────────────────────────────────────────
// The native mixer decodes a local file, because the samples have to be
// mixed into the published audio and a streaming player hands over
// none (see LoudBackingTrack.kt). So an uploaded track is fetched to a
// cache file first. A backing track is capped at 30MB
// (lib/trackLimits.js), which a phone can hold.
//
// ── THE IDENTITY CHECK IS THE POINT ───────────────────────────
// The downloaded bytes are hashed and compared with the hash on the
// row. That is not belt-and-braces: a cue sheet is a list of times, and
// times only mean anything against one recording, so playing a file
// that is not the one the sheet was written against puts every cue in
// the wrong place (lib/audio/tracks.js trackIdentityOk). The check is
// here, at the only moment both hashes exist.
import * as FileSystem from 'expo-file-system';
import { trackIdentityOk, describeIdentity } from '@loud/lib/audio/tracks.js';
import { api } from './api';
import { sha256OfFile } from './upload';

/** Where fetched tracks live. One file per track id, so re-cueing the same track re-uses it. */
const cacheDir = () => `${FileSystem.cacheDirectory}backing-tracks/`;
const cachePathFor = (id) => `${cacheDir()}${id}`;

/**
 * Fetch a track and return the local path, with its identity checked.
 *
 * Returns `{ ok, path, reason }`. A refusal carries the sentence to
 * show, never a bare false: an artist whose track will not load needs
 * to know whether to pick a different file or to re-upload this one.
 */
export async function fetchTrack({ id, rowHash, accessToken, onProgress }) {
  if (!id) return { ok: false, reason: 'No track was chosen.' };

  const path = cachePathFor(id);

  // Already here from a previous cue? Re-verify rather than trust the
  // cache: a half-written file from an interrupted download would
  // otherwise be played as if it were the track.
  const existing = await FileSystem.getInfoAsync(path).catch(() => ({ exists: false }));
  if (existing?.exists) {
    const cachedHash = await sha256OfFile(path).catch(() => null);
    const ident = trackIdentityOk({ rowHash, fileHash: cachedHash });
    if (ident.ok) return { ok: true, path, reason: null, cached: true };
    // Wrong or unreadable: delete it rather than leave it to be found
    // again, and fall through to a fresh download.
    await FileSystem.deleteAsync(path, { idempotent: true }).catch(() => {});
  }

  const signed = await api(`/api/tracks/url?id=${encodeURIComponent(id)}`, { accessToken });
  if (!signed.ok) {
    return { ok: false, reason: signed.data?.error || 'We could not reach that track.' };
  }
  const url = signed.data?.url;
  if (!url) return { ok: false, reason: 'That track has no file behind it.' };

  await FileSystem.makeDirectoryAsync(cacheDir(), { intermediates: true }).catch(() => {});

  // Downloaded to a temporary name and moved into place only once it is
  // whole, so an interrupted download cannot leave a file that looks
  // like a cached track.
  const partial = `${path}.part`;
  try {
    const task = FileSystem.createDownloadResumable(url, partial, {}, (p) => {
      if (onProgress && p.totalBytesExpectedToWrite > 0) {
        onProgress(p.totalBytesWritten / p.totalBytesExpectedToWrite);
      }
    });
    const done = await task.downloadAsync();
    if (!done?.uri) return { ok: false, reason: 'The download did not finish.' };

    const fileHash = await sha256OfFile(partial).catch(() => null);
    const ident = trackIdentityOk({ rowHash, fileHash });
    if (!ident.ok) {
      await FileSystem.deleteAsync(partial, { idempotent: true }).catch(() => {});
      return { ok: false, reason: describeIdentity(ident) };
    }

    await FileSystem.moveAsync({ from: partial, to: path });
    return { ok: true, path, reason: null, cached: false };
  } catch (e) {
    await FileSystem.deleteAsync(partial, { idempotent: true }).catch(() => {});
    return { ok: false, reason: e?.message || 'We could not fetch that track.' };
  }
}

/** Forget every cached track. For a sign-out: another account's tracks are not this account's. */
export async function clearTrackCache() {
  await FileSystem.deleteAsync(cacheDir(), { idempotent: true }).catch(() => {});
}
