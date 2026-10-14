'use client';

import { useCallback, useEffect, useState } from 'react';

const INK = '#011627';
const TEAL = '#2ec4b6';
const RED = '#e71d36';
const CHAMFER = 'polygon(10px 0,100% 0,100% 100%,0 100%,0 10px)';
const sectionLabel = { fontSize: 10.5, letterSpacing: '0.12em', color: 'rgba(1,22,39,0.55)' };
const card = { marginTop: 12, border: '1px solid rgba(1,22,39,0.1)', clipPath: CHAMFER, padding: '14px 15px' };
const muted = { fontSize: 12, color: 'rgba(1,22,39,0.55)', lineHeight: 1.55 };
const btn = { padding: '11px 15px', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', border: 'none', borderRadius: 0, cursor: 'pointer', minHeight: 44 };
const tealBtn = { ...btn, color: TEAL, background: 'rgba(46,196,182,0.12)' };
const ghostBtn = { ...btn, color: 'rgba(1,22,39,0.65)', background: 'transparent', border: '1px solid rgba(1,22,39,0.2)' };
const dangerBtn = { ...btn, color: '#fdfffc', background: RED };

// The YouTube section of Settings, artist accounts only.
//
// The privacy policy (/privacy, "Loudentify and YouTube") promises that an
// artist can disconnect YouTube in Settings at any time and that we then
// delete the tokens. Until this section existed the only Connect and
// Disconnect buttons were on the onboarding checklist, which an artist
// who finished (or never started) onboarding has no reason to revisit.
//
// Everything here goes through the same three routes onboarding uses
// (status, connect, disconnect): there is one connection store
// (identity.youtube_connections), one OAuth flow, and one disconnect that
// revokes with Google, deletes the tokens and wipes the stream keys
// (lib/youtube/disconnect.js). This file is the buttons and the words.
//
// States: loading, not connected, connected (channel, live streaming
// yes/no/not checked yet), disconnecting (two-step), error, and the
// "came back from Google" result passed in from the page URL.
export default function YouTubeSettings({ session, result = null }) {
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState(null);           // 'google' | 'mock'
  const [conn, setConn] = useState(null);           // the status route's `connection`, or null
  const [busy, setBusy] = useState('');             // '' | 'connect' | 'disconnect'
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(result === 'connected' ? 'YouTube connected.' : '');

  const call = useCallback(async (path, init = {}) => {
    const res = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}`, ...(init.headers || {}) } });
    let body = null; try { body = await res.json(); } catch { body = null; }
    return { ok: res.ok, status: res.status, body };
  }, [session]);

  const load = useCallback(async () => {
    setError('');
    const r = await call('/api/artist/youtube/status');
    if (!r.ok) { setError(r.body?.error || 'Could not read the YouTube connection.'); setLoading(false); return; }
    setMode(r.body?.mode || null);
    setConn(r.body?.connection?.connected ? r.body.connection : null);
    setLoading(false);
  }, [call]);

  useEffect(() => { load(); }, [load]);

  async function connect() {
    setError(''); setNotice(''); setBusy('connect');
    const r = await call('/api/artist/youtube/connect', { method: 'POST', body: JSON.stringify({ returnTo: 'settings' }) });
    if (!r.ok) { setError(r.body?.error || 'Could not start the connection.'); setBusy(''); return; }
    if (r.body?.url) { window.location.href = r.body.url; return; } // Google's consent screen; the callback brings us back here
    setBusy(''); setNotice('YouTube connected.'); await load();
  }

  async function disconnect() {
    setError(''); setNotice(''); setBusy('disconnect');
    const r = await call('/api/artist/youtube/disconnect', { method: 'POST' });
    setBusy(''); setConfirming(false);
    if (!r.ok) { setError(r.body?.error || 'Could not disconnect. Try again.'); return; }
    setNotice(r.body?.revoked === false
      ? 'Disconnected. Your tokens are deleted here; Google did not confirm the revoke, so also remove Loudentify at myaccount.google.com/permissions.'
      : 'Disconnected. Your tokens and stream keys are deleted.');
    await load();
  }

  const live = conn?.live_enabled === true ? 'Live streaming enabled' : conn?.live_enabled === false ? 'Live streaming not enabled on this channel yet' : 'Live streaming not checked yet';
  // The status route records Google's last refusal to refresh (the weekly expiry under testing mode, or access removed at Google).
  const broken = Boolean(conn?.last_refresh_error);

  return (
    <div style={{ marginTop: 28 }} data-testid="youtube-settings">
      <span style={sectionLabel}>YOUTUBE</span>
      <div style={card}>
        {loading ? (
          <div style={{ fontSize: 13, color: INK }}>Checking your YouTube connection…</div>
        ) : conn ? (
          <>
            <div style={{ fontSize: 13, color: INK }}>
              Connected: <strong>{conn.channel_title || conn.channel_id}</strong>
            </div>
            <div style={{ ...muted, marginTop: 3, color: conn.live_enabled === false ? RED : 'rgba(1,22,39,0.55)' }}>{live}</div>
            {broken && <div style={{ ...muted, marginTop: 3, color: RED }}>The connection has stopped working (Google refused to refresh it). Reconnect to carry on streaming.</div>}
            {result === 'error' && <div style={{ ...muted, marginTop: 6, color: RED }}>Google sent us back without a channel. Try Reconnect.</div>}
            {!confirming ? (
              <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                <button type="button" style={tealBtn} disabled={!!busy} onClick={connect} data-testid="youtube-reconnect">{busy === 'connect' ? 'OPENING GOOGLE…' : 'RECONNECT'}</button>
                <button type="button" style={ghostBtn} disabled={!!busy} onClick={() => setConfirming(true)} data-testid="youtube-disconnect">DISCONNECT</button>
              </div>
            ) : (
              <div style={{ marginTop: 12, border: '1px solid rgba(231,29,54,0.4)', clipPath: CHAMFER, padding: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: INK }}>Disconnect YouTube?</div>
                <ul style={{ margin: '10px 0 0', paddingLeft: 18, fontSize: 12, color: 'rgba(1,22,39,0.65)', lineHeight: 1.7 }}>
                  <li>Loudentify&rsquo;s access to your channel is <strong>revoked with Google</strong> and the stored tokens and stream keys are <strong>deleted</strong>.</li>
                  <li>Shows you have booked <strong>cannot go live</strong> until you connect again.</li>
                  <li>Anything already on your YouTube channel <strong>stays there</strong>; remove it on YouTube if you want it gone.</li>
                </ul>
                <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                  <button type="button" style={{ ...dangerBtn, opacity: busy ? 0.6 : 1 }} disabled={!!busy} onClick={disconnect} data-testid="youtube-disconnect-confirm">{busy === 'disconnect' ? 'DISCONNECTING…' : 'YES, DISCONNECT'}</button>
                  <button type="button" style={ghostBtn} disabled={!!busy} onClick={() => setConfirming(false)}>KEEP IT</button>
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            <div style={{ fontSize: 13, color: INK }}>Not connected</div>
            <div style={{ ...muted, marginTop: 3 }}>Your shows go out on your own YouTube channel. We ask Google for the smallest permission that lets us create and end a broadcast.</div>
            {result === 'error' && <div style={{ ...muted, marginTop: 6, color: RED }}>Google sent us back without a channel. Try again.</div>}
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button type="button" style={tealBtn} disabled={!!busy} onClick={connect} data-testid="youtube-connect">{busy === 'connect' ? 'OPENING GOOGLE…' : 'CONNECT YOUTUBE'}</button>
            </div>
          </>
        )}
        {error && <div style={{ fontSize: 12, color: RED, marginTop: 10 }}>{error}</div>}
        {notice && <div style={{ fontSize: 12, color: TEAL, marginTop: 10 }}>{notice}</div>}
        <div style={{ ...muted, marginTop: 12, fontSize: 11.5 }}>
          {mode === 'mock'
            ? 'This environment has no Google credentials, so Connect links a mock channel that behaves like a real one.'
            : 'While Loudentify is in Google’s testing mode, this connection expires after seven days and needs reconnecting; it will stay connected once Google has verified the app.'}
        </div>
      </div>
    </div>
  );
}
