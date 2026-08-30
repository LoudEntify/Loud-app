'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { computeTrackHash } from '../lib/trackHash';
import { megabytes } from '../lib/mediaQuota';
import { MAX_TRACK_BYTES } from '../lib/trackLimits';
import {
  listUploadedTracks, uploadTrack, deleteUploadedTrack,
} from '../lib/uploadedTracks';

// components/BackingTrackLibrary.jsx
// ─────────────────────────────────────────────────────────────
// The artist's uploaded backing tracks.
//
// PRD: Director Experience / Live Show (backing track)
// S&I: Stateless hosting (shared storage), Database
//
// ── A SEPARATE SURFACE, ON PURPOSE ────────────────────────────
// Backing tracks and b-roll share a bucket and share one 500MB
// allowance, and that is where the sharing stops. They are not one
// media list: a b-roll clip is something you CUT TO mid-performance, a
// backing track is what you PERFORM ALONG WITH. Merging them would put
// two things with different verbs and different failure modes behind
// one browse-and-pick, and the artist reaching for one under pressure
// would have to filter past the other.
//
// So: shared storage underneath, distinct surfaces above. The quota is
// the one place they meet, and it is shown as a single number with a
// breakdown precisely so the sharing is legible rather than surprising
// — an artist who cannot upload a track needs to find out here that
// their clips are what filled the space.
// ─────────────────────────────────────────────────────────────

const TEAL = '#2ec4b6';
const RED = '#e71d36';

function QuotaBar({ quota }) {
  if (!quota) return null;
  const pct = (n) => `${Math.min(100, (n / quota.limit) * 100)}%`;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', height: 6, borderRadius: 3, overflow: 'hidden', background: '#1a1a19' }}>
        {/* Two segments, one bar. The artist has ONE allowance; showing
            two separate meters would imply two budgets. */}
        <div style={{ width: pct(quota.tracks), background: TEAL }} title="Backing tracks" />
        <div style={{ width: pct(quota.broll), background: '#5a5a55' }} title="B-roll clips" />
      </div>
      <span style={{ fontSize: 10.5, color: '#888780' }}>
        {megabytes(quota.used)}MB of {Math.round(quota.limit / 1048576)}MB used
        {' · '}<span style={{ color: TEAL }}>tracks {megabytes(quota.tracks)}MB</span>
        {' · '}clips {megabytes(quota.broll)}MB
      </span>
    </div>
  );
}

export default function BackingTrackLibrary({ artistAccessToken, onPickTrack, loadedHash = null }) {
  const [tracks, setTracks] = useState([]);
  const [quota, setQuota] = useState(null);
  const [notMigrated, setNotMigrated] = useState(false);
  const [busy, setBusy] = useState('');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);
  const cancelledRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!artistAccessToken) return;
    const r = await listUploadedTracks(artistAccessToken);
    if (cancelledRef.current) return;
    setTracks(r.tracks);
    setQuota(r.quota);
    setNotMigrated(r.notMigrated);
  }, [artistAccessToken]);

  useEffect(() => {
    cancelledRef.current = false;
    refresh();
    return () => { cancelledRef.current = true; };
  }, [refresh]);

  async function handleUpload(e) {
    const file = e.target.files?.[0];
    e.target.value = ''; // so re-picking the same file fires change again
    if (!file || !artistAccessToken) return;
    setError(null);
    setNote(null);
    setProgress(0);
    setBusy('upload');
    try {
      if (file.size > MAX_TRACK_BYTES) {
        throw new Error(`That track is ${megabytes(file.size)}MB. The limit is ${Math.round(MAX_TRACK_BYTES / 1048576)}MB per track.`);
      }
      // ── THE HASH IS COMPUTED BEFORE THE UPLOAD, FROM THE FILE ──
      // Not after, and not server-side. It is the identity every cue
      // sheet keys on, and it must be the hash of exactly the bytes
      // being sent — the same value the artist's existing cue sheets
      // were authored against when they were picking this file locally.
      const sha256 = await computeTrackHash(file);
      const { track, alreadyHave } = await uploadTrack({
        file, sha256, durationMs: null, accessToken: artistAccessToken,
        onProgress: (p) => setProgress(p),
      });
      setNote(alreadyHave
        ? `${track.title} was already in your library — nothing re-uploaded.`
        : `${track.title} uploaded.`);
      await refresh();
    } catch (err) {
      setError(String(err?.message || err));
    } finally {
      setBusy('');
      setProgress(0);
    }
  }

  async function handleDelete(track) {
    if (!artistAccessToken) return;
    setError(null);
    setNote(null);
    setBusy(`del:${track.id}`);
    try {
      const q = await deleteUploadedTrack(track.id, artistAccessToken);
      if (q) setQuota(q);
      // Cue sheets are deliberately NOT removed with the track — they
      // are keyed on the hash, so picking the same file locally still
      // finds them. Said out loud because deleting a track and silently
      // losing an evening of cue authoring would be unforgivable.
      setNote(`${track.title} removed. Its cue sheets are kept.`);
      await refresh();
    } catch (err) {
      setError(String(err?.message || err));
    } finally {
      setBusy('');
    }
  }

  if (!artistAccessToken) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <span style={{ fontSize: 11, letterSpacing: '0.1em', color: '#888780', textTransform: 'uppercase' }}>
        Your backing tracks
      </span>

      {notMigrated ? (
        <span style={{ fontSize: 11, color: '#888780' }}>
          Uploads need docs/mvp2_01_backing_tracks.sql to be run first. Picking a file
          from your device still works exactly as before.
        </span>
      ) : (
        <>
          <QuotaBar quota={quota} />

          {tracks.length === 0 && (
            <span style={{ fontSize: 11, color: '#888780' }}>
              Nothing uploaded yet. An uploaded track comes back by itself after a
              reload — a track picked from your device cannot.
            </span>
          )}

          {tracks.map((t) => {
            const isLoaded = loadedHash && loadedHash === t.sha256;
            return (
              <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button
                  type="button"
                  className="control-btn"
                  disabled={!!busy || isLoaded}
                  onClick={() => onPickTrack?.(t)}
                  style={{ flex: 1, textAlign: 'left', opacity: isLoaded ? 0.5 : 1 }}
                >
                  {t.title}
                </button>
                <span style={{ fontSize: 10.5, color: '#888780', minWidth: 52, textAlign: 'right' }}>
                  {isLoaded ? 'loaded' : `${megabytes(t.size_bytes)}MB`}
                </span>
                <button
                  type="button"
                  onClick={() => handleDelete(t)}
                  disabled={!!busy}
                  style={{
                    background: 'transparent', border: '1px solid #3a3a37', color: '#888780',
                    borderRadius: 4, fontSize: 10, padding: '3px 7px', cursor: 'pointer',
                  }}
                >
                  {busy === `del:${t.id}` ? '…' : 'REMOVE'}
                </button>
              </div>
            );
          })}

          <label style={{ display: 'inline-block' }}>
            <span className="control-btn" style={{ display: 'inline-block' }}>
              {busy === 'upload'
                ? `Uploading… ${Math.round(progress * 100)}%`
                : 'Upload a backing track'}
            </span>
            <input
              type="file" accept="audio/*" onChange={handleUpload}
              disabled={!!busy} style={{ display: 'none' }}
            />
          </label>
        </>
      )}

      {note && <span style={{ fontSize: 11, color: TEAL }}>{note}</span>}
      {error && <span style={{ fontSize: 11, color: RED }}>{error}</span>}
    </div>
  );
}
