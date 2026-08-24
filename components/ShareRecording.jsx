'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { InstagramLogo, FacebookLogo, XLogo, LinkSimple } from '@phosphor-icons/react';
import EmptyState from './EmptyState';
import { getSupabase } from '../lib/supabaseClient';
import { getSession } from '../lib/supabaseAuth';

const INK = '#011627';
const PORCELAIN = '#fdfffc';
const TEAL = '#2ec4b6';

export const MAX_CLIP_SECONDS = 90;

function fmt(sec) {
  if (!Number.isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Share a recording — whole, today; as a ≤90s clip once the trim job
// exists.
//
// Sharing REQUIRES the recording to be public, and says so, because a
// share link to a private recording is a link that 404s for everyone the
// artist sends it to. The toggle is right here rather than sending them
// back to the dashboard to find it.
const socialBtn = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '9px 13px',
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.06em',
  color: INK,
  background: 'transparent',
  border: '1px solid rgba(1,22,39,0.2)',
  textDecoration: 'none',
};

export default function ShareRecording({ recordingId }) {
  const videoRef = useRef(null);
  const [session, setSession] = useState(null);
  const [recording, setRecording] = useState(undefined); // undefined = loading
  const [url, setUrl] = useState(null);
  const [duration, setDuration] = useState(0);
  const [inPoint, setInPoint] = useState(0);
  const [outPoint, setOutPoint] = useState(MAX_CLIP_SECONDS);
  const [copied, setCopied] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = await getSession();
      if (cancelled) return;
      setSession(s);
      if (!s?.user) { setRecording(null); return; }

      const { data } = await getSupabase()
        .from('recordings')
        .select('*')
        .eq('id', recordingId)
        .maybeSingle();
      if (cancelled) return;
      setRecording(data || null);
      if (!data) return;

      try {
        const res = await fetch(`/api/recordings/${recordingId}/url`, {
          headers: { Authorization: `Bearer ${s.access_token}` },
        });
        if (res.ok) {
          const body = await res.json();
          if (!cancelled) setUrl(body.url);
        }
      } catch {
        // player just stays empty; the share links still work
      }
    })();
    return () => { cancelled = true; };
  }, [recordingId]);

  async function setVisibility(next) {
    await getSupabase().from('recordings').update({ visibility: next }).eq('id', recordingId);
    setRecording((r) => (r ? { ...r, visibility: next } : r));
  }

  const shareUrl = typeof window !== 'undefined' ? `${window.location.origin}/watch/${recordingId}` : '';
  const isPublic = recording?.visibility === 'public';
  const clipLength = Math.max(0, outPoint - inPoint);

  function copy(text, label) {
    navigator.clipboard?.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(''), 2000);
  }

  if (recording === undefined) {
    return <div style={{ padding: 40, fontSize: 12, color: 'rgba(1,22,39,0.4)' }}>Loading…</div>;
  }
  if (!session) {
    return <div style={{ padding: 40 }}><EmptyState title="Sign in to share" action="LOG IN" actionHref="/auth" /></div>;
  }
  if (!recording) {
    return <div style={{ padding: 40 }}><EmptyState title="Recording not found" body="It may have been deleted." action="BACK TO STUDIO" actionHref="/dashboard" /></div>;
  }

  return (
    <div style={{ minHeight: '100vh', background: PORCELAIN, color: INK, padding: '28px 24px 60px', boxSizing: 'border-box' }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <Link href="/dashboard" style={{ fontSize: 11, letterSpacing: '0.08em', color: TEAL, textDecoration: 'none' }}>← BACK TO STUDIO</Link>
        <div style={{ fontSize: 22, fontWeight: 700, marginTop: 14 }}>Share “{recording.title}”</div>

        {/* Player */}
        <div style={{ marginTop: 16, background: INK, aspectRatio: '9 / 16', maxHeight: 520, overflow: 'hidden', clipPath: 'polygon(12px 0,100% 0,100% 100%,0 100%,0 12px)' }}>
          {url ? (
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <video
              ref={videoRef}
              controls
              src={url}
              onLoadedMetadata={(e) => {
                const d = e.currentTarget.duration;
                setDuration(d);
                setOutPoint(Math.min(MAX_CLIP_SECONDS, d));
              }}
              style={{ width: '100%', height: '100%', objectFit: 'contain', background: INK }}
            />
          ) : (
            <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(253,255,252,0.4)', fontSize: 12 }}>Loading video…</div>
          )}
        </div>

        {/* ── Visibility ─────────────────────────────────────── */}
        <div style={{ marginTop: 18, border: '1px solid rgba(1,22,39,0.12)', clipPath: 'polygon(10px 0,100% 0,100% 100%,0 100%,0 10px)', padding: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>{isPublic ? 'This recording is public' : 'This recording is private'}</div>
          <div style={{ fontSize: 12, color: 'rgba(1,22,39,0.55)', marginTop: 5, lineHeight: 1.5 }}>
            {isPublic
              ? 'Anyone with the link can find it. They still need a Loudentify account to watch.'
              : 'A share link will not work until this is public — everyone you send it to would hit a dead end.'}
          </div>
          <button
            type="button"
            onClick={() => setVisibility(isPublic ? 'private' : 'public')}
            style={{ marginTop: 10, padding: '9px 14px', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', color: isPublic ? 'rgba(1,22,39,0.6)' : TEAL, background: 'transparent', border: `1px solid ${isPublic ? 'rgba(1,22,39,0.2)' : TEAL}`, cursor: 'pointer' }}
          >
            {isPublic ? 'MAKE PRIVATE' : 'MAKE PUBLIC TO SHARE'}
          </button>
        </div>

        {/* ── Share the whole recording ──────────────────────── */}
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 10.5, letterSpacing: '0.12em', color: 'rgba(1,22,39,0.55)' }}>SHARE THE FULL SHOW</div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, border: '1px solid rgba(1,22,39,0.15)', padding: '10px 12px', clipPath: 'polygon(8px 0,100% 0,100% 100%,0 100%,0 8px)' }}>
            <LinkSimple size={14} color="rgba(1,22,39,0.5)" />
            <span style={{ flex: 1, fontSize: 11.5, color: 'rgba(1,22,39,0.7)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{shareUrl}</span>
            <button type="button" onClick={() => copy(shareUrl, 'link')} style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', color: TEAL, background: 'none', border: 'none', cursor: 'pointer' }}>
              {copied === 'link' ? 'COPIED' : 'COPY'}
            </button>
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <a
              href={`https://twitter.com/intent/tweet?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(recording.title)}`}
              target="_blank"
              rel="noreferrer"
              style={socialBtn}
            >
              <XLogo size={14} weight="bold" /> X
            </a>
            <a
              href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`}
              target="_blank"
              rel="noreferrer"
              style={socialBtn}
            >
              <FacebookLogo size={14} weight="bold" /> FACEBOOK
            </a>
            {/* Instagram has no web share endpoint -- any "share to
                Instagram" button on the web is a copy-link button wearing
                a costume. This one says what it does. */}
            <button type="button" onClick={() => copy(shareUrl, 'ig')} style={{ ...socialBtn, cursor: 'pointer' }}>
              <InstagramLogo size={14} weight="bold" /> {copied === 'ig' ? 'LINK COPIED' : 'COPY FOR INSTAGRAM'}
            </button>
          </div>
        </div>

        {/* ── Clip range ─────────────────────────────────────── */}
        <div style={{ marginTop: 22, border: '1px solid rgba(1,22,39,0.12)', clipPath: 'polygon(10px 0,100% 0,100% 100%,0 100%,0 10px)', padding: 14 }}>
          <div style={{ fontSize: 10.5, letterSpacing: '0.12em', color: 'rgba(1,22,39,0.55)' }}>CLIP A MOMENT (UP TO {MAX_CLIP_SECONDS}s)</div>

          <div style={{ display: 'flex', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
            <label style={{ flex: '1 1 240px' }}>
              <div style={{ fontSize: 10, color: 'rgba(1,22,39,0.5)', marginBottom: 4 }}>START — {fmt(inPoint)}</div>
              <input
                type="range"
                min={0}
                max={Math.max(0, duration)}
                step={0.5}
                value={inPoint}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setInPoint(v);
                  // Keep the window valid and ≤90s without ever letting
                  // the handles cross.
                  setOutPoint((o) => Math.min(Math.max(o, v + 1), v + MAX_CLIP_SECONDS, duration || v + MAX_CLIP_SECONDS));
                  if (videoRef.current) videoRef.current.currentTime = v;
                }}
                style={{ width: '100%' }}
              />
            </label>

            <label style={{ flex: '1 1 240px' }}>
              <div style={{ fontSize: 10, color: 'rgba(1,22,39,0.5)', marginBottom: 4 }}>END — {fmt(outPoint)}</div>
              <input
                type="range"
                min={0}
                max={Math.max(0, duration)}
                step={0.5}
                value={outPoint}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setOutPoint(Math.max(v, inPoint + 1));
                  setInPoint((i) => Math.max(i, v - MAX_CLIP_SECONDS));
                  if (videoRef.current) videoRef.current.currentTime = v;
                }}
                style={{ width: '100%' }}
              />
            </label>
          </div>

          <div style={{ fontSize: 11.5, color: 'rgba(1,22,39,0.6)', marginTop: 8 }}>
            Selected: <strong style={{ color: INK }}>{fmt(clipLength)}</strong> of {fmt(duration)}
          </div>

          <div style={{ marginTop: 12, fontSize: 11.5, color: 'rgba(1,22,39,0.55)', lineHeight: 1.55, borderTop: '1px dashed rgba(1,22,39,0.15)', paddingTop: 12 }}>
            <strong style={{ color: INK }}>Clip export isn&apos;t switched on yet.</strong>{' '}
            Cutting the video server-side needs a background job runner that doesn&apos;t exist in this stack. Rather than ship a
            button that appears to work and silently does nothing, the range picker is here and wired, and the export is the
            next piece. The full show is fully shareable today.
          </div>
        </div>
      </div>
    </div>
  );
}

