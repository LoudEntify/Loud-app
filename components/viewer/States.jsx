'use client';
// components/viewer/States.jsx — the five states, built once
// (design/StatesPatterns.dc.html). Loading: grey shapes in the layout the
// real content takes, switching to the error state after 10 s with nothing
// back. Empty: say what is not here and the one action that fills it.
// Error: plain words and a way forward, never "something went wrong".
// Offline: a bar across the top, not a screen that blocks everything.
import { useEffect, useState } from 'react';
import { Wifi, Warn, Music } from './Icons';

export function Skeleton({ w = '100%', h = 16, r = 12, style }) {
  return <span className="v-skel" aria-hidden="true" style={{ display: 'block', width: w, height: h, borderRadius: r, ...style }} />;
}

export function SkeletonList({ rows = 3, dark = false }) {
  return (
    <div role="status" aria-label="Loading" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="v-row" style={{ gap: 12 }}>
          <Skeleton w={64} h={64} />
          <div className="v-col" style={{ flex: 1 }}><Skeleton w="60%" h={18} /><Skeleton w="40%" h={14} /></div>
        </div>
      ))}
      <span className="v-sr-only">Loading{dark ? '' : ''}</span>
    </div>
  );
}

/** After `timeoutMs` with `loading` still true, calls onTimeout (switch to the error state). */
export function useLoadingTimeout(loading, onTimeout, timeoutMs = 10000) {
  useEffect(() => {
    if (!loading) return undefined;
    const t = setTimeout(onTimeout, timeoutMs);
    return () => clearTimeout(t);
  }, [loading, onTimeout, timeoutMs]);
}

export function Empty({ title, body, action, onAction, actionHref, icon }) {
  const Icon = icon || Music;
  return (
    <div className="v-empty" role="status">
      <span className="v-icon-btn" style={{ background: 'rgba(1,22,39,0.08)' }}><Icon /></span>
      <span className="v-empty-title">{title}</span>
      {body && <span className="v-muted" style={{ fontSize: 15 }}>{body}</span>}
      {action && (actionHref ? <a className="v-btn v-btn-teal" href={actionHref} style={{ marginTop: 6 }}>{action}</a> : <button className="v-btn v-btn-teal" onClick={onAction} style={{ marginTop: 6 }}>{action}</button>)}
    </div>
  );
}

export function ErrorState({ title, body, retry, onRetry, backHref = '/discover', backLabel = 'Back to Discover' }) {
  return (
    <div className="v-error" role="alert">
      <span style={{ color: 'var(--red)', display: 'flex', paddingTop: 2 }}><Warn /></span>
      <div className="v-col" style={{ gap: 6, flex: 1 }}>
        <span style={{ fontSize: 18, fontWeight: 700 }}>{title}</span>
        {body && <span style={{ fontSize: 15 }}>{body}</span>}
        <span className="v-row" style={{ marginTop: 4, flexWrap: 'wrap' }}>
          {retry !== false && <button className="v-btn v-btn-teal" onClick={onRetry}>Try again</button>}
          {backHref && <a className="v-btn v-btn-ghost-light" href={backHref}>{backLabel}</a>}
        </span>
      </div>
    </div>
  );
}

export function useOnline() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    setOnline(typeof navigator === 'undefined' ? true : navigator.onLine);
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); };
  }, []);
  return online;
}

export function OfflineBar() {
  const online = useOnline();
  if (online) return null;
  return (
    <div className="v-offline-bar" role="status" aria-live="polite" data-testid="offline-bar">
      <Wifi /> No connection. Trying to reconnect.
    </div>
  );
}
