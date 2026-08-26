'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Trash, UploadSimple } from '@phosphor-icons/react';
import EmptyState from './EmptyState';
import { getSupabase } from '../lib/supabaseClient';
import { getSession } from '../lib/supabaseAuth';
import { MAX_CLIP_BYTES, MAX_TOTAL_BYTES, megabytes as mb } from '../lib/brollLimits';
import { uploadBrollClip } from '../lib/brollUpload';

const INK = '#011627';
const TEAL = '#2ec4b6';
const RED = '#e71d36';

// B-roll: the artist's own clip library, cuttable during a show.
//
// Caps are enforced server-side AND stated up front, because a 500MB
// ceiling discovered at the end of a 400MB upload is a worse experience
// than one shown before you pick the file. The numbers themselves live
// in lib/brollLimits.js so this file and the routes cannot promise
// different things.
//
// UPLOADS GO STRAIGHT TO STORAGE. The bytes do not pass through a
// serverless function — see lib/brollUpload.js and
// app/api/broll/upload-url for why the version that did hung forever on
// anything larger than a few megabytes.

export default function BRollLibrary() {
  const [session, setSession] = useState(null);
  const [clips, setClips] = useState(null);
  const [busy, setBusy] = useState(false);
  // null when idle, 0-100 while uploading. Real bytes-transferred
  // progress from XHR -- the thing the old fetch-based upload could not
  // produce at all.
  const [progress, setProgress] = useState(null);
  const abortRef = useRef(null);
  const [pendingBytes, setPendingBytes] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const fileRef = useRef(null);

  const load = useCallback(async (userId) => {
    const { data, error: err } = await getSupabase()
      .from('broll_clips')
      .select('*')
      .eq('artist_id', userId)
      .order('created_at', { ascending: false });
    setClips(err ? [] : (data || []));
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = await getSession();
      if (cancelled) return;
      setSession(s);
      if (s?.user) await load(s.user.id);
      else setClips([]);
    })();
    return () => { cancelled = true; };
  }, [load]);

  const usedBytes = (clips || []).reduce((sum, c) => sum + (c.size_bytes || 0), 0);
  const remainingBytes = Math.max(0, MAX_TOTAL_BYTES - usedBytes);

  async function handleFile(e) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file after an error
    if (!file || !session?.user) return;

    setError('');
    setNotice('');

    // Type/size/quota checks live in uploadBrollClip so the same rules
    // apply however it is called, and so this component cannot drift
    // from them. It fails fast, before any transfer starts.

    setPendingBytes(file.size);
    setBusy(true);
    setProgress(0);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const result = await uploadBrollClip({
        file,
        accessToken: session.access_token,
        usedBytes,
        onProgress: setProgress,
        signal: controller.signal,
      });
      if (!result.ok) {
        // Cancelling is a thing the artist did, not a failure to report
        // back at them.
        if (!result.aborted) setError(result.error || 'Upload failed.');
        return;
      }
      setNotice('Clip uploaded — muted, and ready to cue.');
      await load(session.user.id);
    } finally {
      abortRef.current = null;
      setBusy(false);
      setProgress(null);
    }
  }

  async function remove(clip) {
    setError('');
    setBusy(true);
    try {
      const res = await fetch('/api/broll/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ id: clip.id }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body.error || 'Could not delete that clip.'); return; }
      await load(session.user.id);
    } finally {
      setBusy(false);
    }
  }

  if (!session) {
    return <EmptyState compact title="Sign in to manage B-roll" action="LOG IN" actionHref="/auth" />;
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10.5, letterSpacing: '0.12em', color: 'rgba(1,22,39,0.55)' }}>B-ROLL</span>
        <span style={{ fontSize: 10, color: 'rgba(1,22,39,0.45)' }}>
          {mb(usedBytes)}MB of {mb(MAX_TOTAL_BYTES)}MB used
        </span>
      </div>

      {/* Quota bar -- turns orange past 80% so the ceiling is visible
          before it is hit, not at the moment it blocks an upload. */}
      <div style={{ height: 4, background: 'rgba(1,22,39,0.08)', marginTop: 8, borderRadius: 999, overflow: 'hidden' }}>
        <div
          style={{
            width: `${Math.min(100, (usedBytes / MAX_TOTAL_BYTES) * 100)}%`,
            height: '100%',
            background: usedBytes / MAX_TOTAL_BYTES > 0.8 ? '#ff9f1c' : TEAL,
          }}
        />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '10px 14px', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em',
            color: TEAL, background: 'transparent', border: `1px solid ${TEAL}`,
            cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1,
          }}
        >
          <UploadSimple size={14} weight="bold" />
          {busy ? (progress === null ? 'STARTING…' : `${progress}%`) : 'UPLOAD CLIP'}
        </button>
        {busy && (
          <button
            type="button"
            onClick={() => abortRef.current?.abort()}
            style={{
              padding: '10px 12px', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em',
              color: 'rgba(1,22,39,0.6)', background: 'transparent',
              border: '1px solid rgba(1,22,39,0.2)', cursor: 'pointer',
            }}
          >
            CANCEL
          </button>
        )}
        <span style={{ fontSize: 10, color: 'rgba(1,22,39,0.45)' }}>
          Max {mb(MAX_CLIP_BYTES)}MB per clip. Clips are muted on upload.
        </span>
        <input ref={fileRef} type="file" accept="video/*" onChange={handleFile} style={{ display: 'none' }} />
      </div>

      {/* Real progress, not a spinner. The bar only reaches 100 after the
          clip has been REGISTERED, not merely uploaded -- a full bar for
          a clip that then failed to save would be the same lie the old
          "WORKING…" told, just faster. */}
      {busy && (
        <div style={{ marginTop: 10 }}>
          <div style={{ height: 5, background: 'rgba(1,22,39,0.08)', borderRadius: 999, overflow: 'hidden' }}>
            <div
              style={{
                width: `${progress ?? 0}%`,
                height: '100%',
                background: TEAL,
                transition: 'width 160ms linear',
              }}
            />
          </div>
          <div style={{ fontSize: 10, color: 'rgba(1,22,39,0.45)', marginTop: 5 }}>
            {progress !== null && progress >= 99
              ? 'Saving to your library…'
              : `Uploading ${mb(pendingBytes)}MB — you can leave this tab open and carry on.`}
          </div>
        </div>
      )}

      {error && <div style={{ fontSize: 12, color: RED, marginTop: 10 }}>{error}</div>}
      {notice && <div style={{ fontSize: 12, color: TEAL, marginTop: 10 }}>{notice}</div>}

      <div style={{ marginTop: 14 }}>
        {clips === null && <div style={{ fontSize: 12, color: 'rgba(1,22,39,0.4)' }}>Loading…</div>}

        {clips !== null && clips.length === 0 && (
          <EmptyState
            compact
            title="No clips yet"
            body="Upload short video clips to cut to during a show — intros, visuals, anything that isn't a camera."
          />
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10 }}>
          {(clips || []).map((clip) => (
            <div key={clip.id} style={{ border: '1px solid rgba(1,22,39,0.1)', clipPath: 'polygon(8px 0,100% 0,100% 100%,0 100%,0 8px)', padding: 10 }}>
              <div style={{ height: 70, background: 'rgba(1,22,39,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, letterSpacing: '0.1em', color: 'rgba(1,22,39,0.35)' }}>
                CLIP
              </div>
              <div style={{ fontSize: 12, color: INK, marginTop: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{clip.title}</div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
                <span style={{ fontSize: 9.5, color: 'rgba(1,22,39,0.4)' }}>{mb(clip.size_bytes || 0)}MB · MUTED</span>
                <button
                  type="button"
                  onClick={() => remove(clip)}
                  disabled={busy}
                  aria-label={`Delete ${clip.title}`}
                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: RED, padding: 2 }}
                >
                  <Trash size={13} weight="bold" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
