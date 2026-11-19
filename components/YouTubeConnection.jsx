'use client';

import { useEffect, useState } from 'react';

const INK = '#011627';
const RED = '#e71d36';

export default function YouTubeConnection({ accessToken, compact = false }) {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [readiness, setReadiness] = useState(null);
  const [readinessBusy, setReadinessBusy] = useState(false);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    fetch('/api/youtube/connection', { headers: { Authorization: `Bearer ${accessToken}` } })
      .then(async (response) => ({ ok: response.ok, body: await response.json().catch(() => ({})) }))
      .then(({ ok, body }) => {
        if (cancelled) return;
        if (!ok) setError(body.error || 'Could not check YouTube connection.');
        setStatus(ok ? body : { enabled: false, connected: false });
      })
      .catch(() => { if (!cancelled) { setError('Could not check YouTube connection.'); setStatus({ enabled: false }); } });
    return () => { cancelled = true; };
  }, [accessToken]);

  async function loadReadiness(force = false) {
    if (!accessToken) return;
    setReadinessBusy(true);
    try {
      const response = await fetch(`/api/youtube/readiness${force ? '?refresh=1' : ''}`, { headers: { Authorization: `Bearer ${accessToken}` } });
      const body = await response.json().catch(() => ({}));
      if (!response.ok && !body.status) throw new Error(body.error || 'Could not check YouTube readiness.');
      setReadiness(body);
      if (body.status === 'AUTH_REQUIRED') setStatus((current) => ({ ...current, connected: false, authorizationRequired: true }));
    } catch (cause) {
      setReadiness({ status: 'ERROR', summary: cause.message || 'Could not check YouTube readiness.', activationSteps: [] });
    } finally {
      setReadinessBusy(false);
    }
  }

  useEffect(() => {
    if (status?.connected) loadReadiness();
    // accessToken is stable for this mounted account surface; status is
    // deliberately narrowed to the connected bit to avoid a fetch loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.connected]);

  if (status === null) return null;
  if (!status.enabled) return null; // incomplete feature stays behind its server flag

  async function connect() {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/youtube/connect', { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.authorizationUrl) throw new Error(body.error || 'Could not begin YouTube connection.');
      window.location.assign(body.authorizationUrl);
    } catch (cause) {
      setError(cause.message || 'Could not begin YouTube connection.');
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/youtube/connection', { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Could not disconnect YouTube.');
      setStatus({ ...status, connected: false, channel: null });
      setReadiness(null);
      setConfirmDisconnect(false);
    } catch (cause) {
      setError(cause.message || 'Could not disconnect YouTube.');
    } finally {
      setBusy(false);
    }
  }

  if (compact) {
    const readinessTone = readiness?.status === 'READY' ? '#8de1d5' : readiness?.status === 'ACTION_REQUIRED' ? '#ffbf69' : readiness?.status === 'AUTH_REQUIRED' ? '#ff7b86' : '#9fb5c3';
    return (
      <section style={{ gridColumn: '1 / -1', padding: 24, border: '1px solid #ffffff18', borderRadius: 14, background: 'linear-gradient(140deg, #13272d80, #101a24)', color: '#f8fafc' }} aria-labelledby="dashboard-youtube-title">
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.16em', color: '#ff7b86' }}>BROADCAST DESTINATION</span>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 20, marginTop: 10, flexWrap: 'wrap' }}>
          <div>
            <h2 id="dashboard-youtube-title" style={{ margin: 0, fontSize: 22 }}>YouTube Live</h2>
            <p style={{ margin: '6px 0 0', color: '#9fb5c3', fontSize: 12, lineHeight: 1.6 }}>{status.connected ? `Connected to ${status.channel?.title || 'your channel'}.` : status.authorizationRequired ? 'Your YouTube authorization expired or was revoked. Reconnect to continue.' : 'Connect the channel you own before preparing a YouTube broadcast.'}</p>
            {status.connected && (
              <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ border: `1px solid ${readinessTone}66`, borderRadius: 999, color: readinessTone, padding: '3px 8px', fontSize: 8.5, fontWeight: 700, letterSpacing: '.08em' }}>{readinessBusy && !readiness ? 'CHECKING' : readiness?.status || 'UNKNOWN'}</span>
                <span style={{ color: '#9fb5c3', fontSize: 10.5 }}>{readiness?.summary || 'Checking YouTube broadcast readiness…'}</span>
              </div>
            )}
          </div>
          {status.connected ? <a href="/settings" style={{ color: '#8de1d5', fontSize: 11, textDecoration: 'none' }}>Manage connection →</a> : <button type="button" onClick={connect} disabled={busy} style={{ border: 0, background: RED, color: '#fff', padding: '11px 15px', fontSize: 10.5, fontWeight: 700, cursor: busy ? 'wait' : 'pointer' }}>{busy ? 'CONNECTING…' : status.authorizationRequired ? 'RECONNECT YOUTUBE' : 'CONNECT YOUTUBE'}</button>}
        </div>
        {error && <p role="alert" style={{ margin: '10px 0 0', color: '#ff7b86', fontSize: 11.5 }}>{error}</p>}
      </section>
    );
  }

  return (
    <section style={{ marginTop: 28 }} aria-labelledby="youtube-connection-title">
      <span style={{ fontSize: 10.5, letterSpacing: '0.12em', color: 'rgba(1,22,39,0.55)' }}>BROADCAST DESTINATION</span>
      <div style={{ marginTop: 12, border: '1px solid rgba(1,22,39,0.12)', padding: '16px 17px', clipPath: 'polygon(10px 0,100% 0,100% 100%,0 100%,0 10px)' }}>
        <div id="youtube-connection-title" style={{ fontSize: 14, fontWeight: 700, color: INK }}>YouTube Live</div>
        {status.connected ? (
          <>
            <p style={{ margin: '7px 0 0', fontSize: 12, color: 'rgba(1,22,39,0.62)', lineHeight: 1.6 }}>
              Connected to <strong>{status.channel?.title || 'your YouTube channel'}</strong>. Loudentify will use this artist-owned channel only when you explicitly prepare a YouTube broadcast.
            </p>
            {!confirmDisconnect ? (
              <button type="button" onClick={() => setConfirmDisconnect(true)} disabled={busy} style={{ marginTop: 12, border: '1px solid rgba(231,29,54,0.35)', background: 'transparent', color: RED, padding: '9px 12px', fontSize: 10, fontWeight: 700, cursor: 'pointer' }}>DISCONNECT YOUTUBE</button>
            ) : (
              <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11.5, color: 'rgba(1,22,39,0.65)' }}>Revoke Loudentify&apos;s YouTube access?</span>
                <button type="button" onClick={() => setConfirmDisconnect(false)} disabled={busy} style={{ border: 0, background: 'transparent', fontSize: 10, fontWeight: 700, cursor: 'pointer' }}>KEEP CONNECTED</button>
                <button type="button" onClick={disconnect} disabled={busy} style={{ border: 0, background: RED, color: '#fff', padding: '8px 11px', fontSize: 10, fontWeight: 700, cursor: 'pointer' }}>{busy ? 'REVOKING…' : 'YES, REVOKE'}</button>
              </div>
            )}
          </>
        ) : (
          <>
            <p style={{ margin: '7px 0 0', fontSize: 12, color: 'rgba(1,22,39,0.62)', lineHeight: 1.6 }}>Connect the YouTube channel you own. Google credentials and ingestion keys remain on the server and are never sent to this browser.</p>
            <button type="button" onClick={connect} disabled={busy} style={{ marginTop: 12, border: 0, background: RED, color: '#fff', padding: '10px 14px', fontSize: 10.5, fontWeight: 700, cursor: busy ? 'wait' : 'pointer' }}>{busy ? 'CONNECTING…' : status.authorizationRequired ? 'RECONNECT YOUTUBE' : 'CONNECT YOUTUBE'}</button>
          </>
        )}
        {error && <p role="alert" style={{ margin: '10px 0 0', color: RED, fontSize: 11.5 }}>{error}</p>}
        {status.connected && (
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid rgba(1,22,39,0.1)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <strong style={{ fontSize: 11.5 }}>Readiness: {readinessBusy && !readiness ? 'CHECKING' : readiness?.status || 'UNKNOWN'}</strong>
              <button type="button" onClick={() => loadReadiness(true)} disabled={readinessBusy} style={{ border: 0, background: 'transparent', color: INK, fontSize: 9.5, fontWeight: 700, cursor: readinessBusy ? 'wait' : 'pointer' }}>{readinessBusy ? 'CHECKING…' : 'CHECK AGAIN'}</button>
            </div>
            {readiness?.summary && <p style={{ margin: '6px 0 0', fontSize: 11.5, lineHeight: 1.6, color: 'rgba(1,22,39,0.62)' }}>{readiness.summary}</p>}
            {readiness?.activationSteps?.length > 0 && (
              <details style={{ marginTop: 8 }}>
                <summary style={{ fontSize: 10.5, fontWeight: 700, cursor: 'pointer' }}>YouTube activation steps</summary>
                <ol style={{ margin: '8px 0 0', paddingLeft: 20, color: 'rgba(1,22,39,0.62)', fontSize: 10.5, lineHeight: 1.7 }}>{readiness.activationSteps.map((step) => <li key={step}>{step}</li>)}</ol>
              </details>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
