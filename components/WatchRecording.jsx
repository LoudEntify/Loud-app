'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import EmptyState from './EmptyState';
import { getSession } from '../lib/supabaseAuth';

const INK = '#011627';
const PORCELAIN = '#fdfffc';

// The page a shared link lands on. Playback still goes through the
// signed-URL route -- the recordings bucket is private and stays that
// way, so "public" means "listed and shareable", never "the file is on
// the open internet".
export default function WatchRecording({ recording, recordingId }) {
  const [url, setUrl] = useState(null);
  const [state, setState] = useState('loading'); // loading | ready | needsAuth | error

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!recording) { setState('error'); return; }
      const session = await getSession();
      if (cancelled) return;
      if (!session) { setState('needsAuth'); return; }
      try {
        const res = await fetch(`/api/recordings/${recordingId}/url`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (!res.ok) { setState('error'); return; }
        const body = await res.json();
        if (cancelled) return;
        setUrl(body.url);
        setState('ready');
      } catch {
        if (!cancelled) setState('error');
      }
    })();
    return () => { cancelled = true; };
  }, [recording, recordingId]);

  return (
    <div style={{ minHeight: '100vh', background: PORCELAIN, color: INK, padding: '28px 24px 60px', boxSizing: 'border-box' }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <Link href="/discover" style={{ fontSize: 11, letterSpacing: '0.08em', color: '#2ec4b6', textDecoration: 'none' }}>← LOUDENTIFY</Link>

        {!recording && (
          <div style={{ marginTop: 22 }}>
            <EmptyState
              title="This recording isn't available"
              body="It may have been made private, or the link may be wrong."
              action="BROWSE SHOWS"
              actionHref="/discover"
            />
          </div>
        )}

        {recording && (
          <>
            <div style={{ fontSize: 22, fontWeight: 700, marginTop: 16 }}>{recording.title}</div>
            <div style={{ fontSize: 11, color: 'rgba(1,22,39,0.5)', marginTop: 4 }}>
              {new Date(recording.recorded_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}
            </div>

            <div style={{ marginTop: 16, background: INK, aspectRatio: '9 / 16', maxHeight: 620, overflow: 'hidden', clipPath: 'polygon(12px 0,100% 0,100% 100%,0 100%,0 12px)' }}>
              {state === 'ready' && url && (
                // eslint-disable-next-line jsx-a11y/media-has-caption
                <video controls src={url} style={{ width: '100%', height: '100%', objectFit: 'contain', background: INK }} />
              )}
              {state !== 'ready' && (
                <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(253,255,252,0.5)', fontSize: 12, textAlign: 'center', padding: 24 }}>
                  {state === 'loading' && 'Loading…'}
                  {state === 'needsAuth' && 'Log in to watch this recording.'}
                  {state === 'error' && 'This recording could not be loaded.'}
                </div>
              )}
            </div>

            {state === 'needsAuth' && (
              <div style={{ marginTop: 14 }}>
                <EmptyState
                  compact
                  title="Watching needs an account"
                  body="Loudentify shows are for signed-in members."
                  action="LOG IN OR SIGN UP"
                  actionHref={`/auth?next=${encodeURIComponent(`/watch/${recordingId}`)}`}
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
