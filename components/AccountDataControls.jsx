'use client';

import { useCallback, useEffect, useState } from 'react';
import { getSupabase } from '../lib/supabaseClient';

const INK = '#011627';
const TEAL = '#2ec4b6';
const RED = '#e71d36';

const CHAMFER = 'polygon(10px 0,100% 0,100% 100%,0 100%,0 10px)';
const sectionLabel = { fontSize: 10.5, letterSpacing: '0.12em', color: 'rgba(1,22,39,0.55)' };
const card = { marginTop: 12, border: '1px solid rgba(1,22,39,0.1)', clipPath: CHAMFER, padding: '14px 15px' };
const ghost = {
  padding: '11px 15px', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em',
  color: 'rgba(1,22,39,0.65)', background: 'transparent', border: '1px solid rgba(1,22,39,0.2)',
  borderRadius: 0, cursor: 'pointer',
};
const tealBtn = {
  padding: '11px 15px', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em',
  color: TEAL, background: 'rgba(46,196,182,0.12)', border: 'none', borderRadius: 0, cursor: 'pointer',
};
const dangerBtn = {
  padding: '11px 15px', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em',
  color: '#fdfffc', background: RED, border: 'none', borderRadius: 0, cursor: 'pointer',
};
const input = {
  border: '1px solid rgba(1,22,39,0.15)', background: 'transparent', padding: '11px 12px',
  fontSize: 13, color: INK, outline: 'none', fontFamily: 'inherit',
};

// The three account-control sections: your data, your sessions, and
// closing the account.
//
// Kept out of AccountSettings.jsx as its own component because these are
// the highest-consequence controls in the product and they deserve to be
// read together, in one file, rather than found three screens apart in a
// 400-line settings form.
//
// The copy here is doing real work and is not decorative. "Close my
// account" means something different on every platform, and the only way
// a person can make an informed decision is to be told exactly what
// happens BEFORE they decide — including the parts they may not like
// (the ledger is kept; the name is held). Stating that plainly costs us a
// few people who wanted a hard delete, and saves every one of them the
// experience of finding out afterwards.

export default function AccountDataControls({ session, profile }) {
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState('');
  const [exportNotice, setExportNotice] = useState('');

  const [sessionsBusy, setSessionsBusy] = useState(false);
  const [sessionsError, setSessionsError] = useState('');

  const [closureAvailable, setClosureAvailable] = useState(null); // null = unknown
  const [closureReasonUnavailable, setClosureReasonUnavailable] = useState(null);
  const [closing, setClosing] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [closeReason, setCloseReason] = useState('');
  const [closeBusy, setCloseBusy] = useState(false);
  const [closeError, setCloseError] = useState('');
  const [closed, setClosed] = useState(null);

  const token = session?.access_token;

  // Asked, not assumed. Closure touches five things and a partial close is
  // the one outcome that must not be reachable, so the server tells us up
  // front whether it can complete — and if it cannot, the section says so
  // instead of offering a button that half-works.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/account/close', { headers: { Authorization: `Bearer ${token}` } });
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        setClosureAvailable(!!body.available);
        setClosureReasonUnavailable(body.reason || null);
      } catch {
        if (!cancelled) setClosureAvailable(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  const requestExport = useCallback(async () => {
    setExportError('');
    setExportNotice('');
    setExportBusy(true);
    try {
      const res = await fetch('/api/account/export', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setExportError(
          body.retryAt
            ? `${body.error} You can request it again after ${new Date(body.retryAt).toLocaleString()}.`
            : body.error || 'Could not build your export.'
        );
        return;
      }
      // Downloaded from a blob rather than navigated to, because the
      // request needs an Authorization header and a plain <a download>
      // cannot send one.
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `loudentify-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoked on the next tick — the click has already started the
      // download by then, and holding the object URL keeps the whole
      // export in memory for as long as the tab is open.
      setTimeout(() => URL.revokeObjectURL(url), 0);
      setExportNotice('Downloaded. Open it in any text editor — it is plain JSON.');
    } catch {
      setExportError('Could not build your export.');
    } finally {
      setExportBusy(false);
    }
  }, [token]);

  const logOutEverywhere = useCallback(async () => {
    setSessionsError('');
    setSessionsBusy(true);
    try {
      // scope:'global' revokes every refresh token this account holds,
      // on every device, not just this browser's. It is the real thing,
      // which is why it is offered as its own control rather than folded
      // into the ordinary log-out.
      const { error } = await getSupabase().auth.signOut({ scope: 'global' });
      if (error) { setSessionsError(error.message || 'Could not sign out everywhere.'); return; }
      window.location.href = '/auth';
    } catch {
      setSessionsError('Could not sign out everywhere.');
    } finally {
      setSessionsBusy(false);
    }
  }, []);

  const closeAccount = useCallback(async () => {
    setCloseError('');
    setCloseBusy(true);
    try {
      const res = await fetch('/api/account/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ confirm: confirmText, reason: closeReason }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setCloseError(body.error || 'Could not close your account.'); return; }
      setClosed(body);
      // Sign out locally too. The account is banned server-side, but the
      // access token in this tab is still valid until it expires, and
      // leaving someone sitting in a session for an account they just
      // closed is a confusing few minutes.
      try { await getSupabase().auth.signOut({ scope: 'global' }); } catch { /* already effectively over */ }
    } catch {
      setCloseError('Could not close your account.');
    } finally {
      setCloseBusy(false);
    }
  }, [token, confirmText, closeReason]);

  if (closed) {
    return (
      <div style={{ marginTop: 28 }}>
        <span style={sectionLabel}>ACCOUNT CLOSED</span>
        <div style={{ ...card, borderColor: 'rgba(231,29,54,0.4)' }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>Your account is closed.</div>
          <ul style={{ margin: '10px 0 0', paddingLeft: 18, fontSize: 12, color: 'rgba(1,22,39,0.65)', lineHeight: 1.7 }}>
            <li>{closed.summary?.recordings_made_private ?? 0} recording(s) made private.</li>
            <li>{closed.summary?.shows_cancelled ?? 0} upcoming show(s) cancelled, {closed.summary?.slot_holders_notified ?? 0} performer(s) told.</li>
            <li>{closed.summary?.ledger_rows_retained ?? 0} wallet transaction(s) kept, exactly as they were.</li>
            <li>{closed.loginDisabled ? 'Login is disabled.' : 'Login could not be disabled automatically — contact support.'}</li>
          </ul>
          <div style={{ fontSize: 11.5, color: 'rgba(1,22,39,0.55)', marginTop: 10, lineHeight: 1.55 }}>
            Nothing has been deleted. If you want the account back, contact support — reopening it is a
            single reversal of each step above.
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* ── 2a · Your data ────────────────────────────────── */}
      <div style={{ marginTop: 28 }}>
        <span style={sectionLabel}>YOUR DATA</span>
        <div style={card}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>Request a copy of everything</div>
          <div style={{ fontSize: 11.5, color: 'rgba(1,22,39,0.55)', marginTop: 6, lineHeight: 1.55 }}>
            One JSON file with your profile, your shows, your recordings and B-roll (listed with their
            details, not the video itself), your wallet history, your notifications and who you follow.
            It downloads straight to this device — we do not email it anywhere.
          </div>
          <div style={{ fontSize: 10.5, color: 'rgba(1,22,39,0.42)', marginTop: 6 }}>
            Up to three times a day.
          </div>
          {exportError && <div style={{ fontSize: 12, color: RED, marginTop: 8 }}>{exportError}</div>}
          {exportNotice && <div style={{ fontSize: 12, color: TEAL, marginTop: 8 }}>{exportNotice}</div>}
          <button type="button" onClick={requestExport} disabled={exportBusy || !token} style={{ ...tealBtn, marginTop: 12, opacity: exportBusy ? 0.6 : 1 }}>
            {exportBusy ? 'BUILDING…' : 'REQUEST MY DATA'}
          </button>
        </div>
      </div>

      {/* ── 2c · Sessions ─────────────────────────────────── */}
      <div style={{ marginTop: 28 }}>
        <span style={sectionLabel}>SECURITY</span>
        <div style={card}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>Log out everywhere</div>
          <div style={{ fontSize: 11.5, color: 'rgba(1,22,39,0.55)', marginTop: 6, lineHeight: 1.55 }}>
            Signs this account out of every browser and phone it is logged into, including this one.
            Use it if you have logged in somewhere you no longer control.
          </div>
          {sessionsError && <div style={{ fontSize: 12, color: RED, marginTop: 8 }}>{sessionsError}</div>}
          <button type="button" onClick={logOutEverywhere} disabled={sessionsBusy} style={{ ...ghost, marginTop: 12 }}>
            {sessionsBusy ? 'SIGNING OUT…' : 'LOG OUT ON ALL DEVICES'}
          </button>
        </div>
      </div>

      {/* ── 2b · Closing the account ──────────────────────── */}
      <div style={{ marginTop: 28 }}>
        <span style={sectionLabel}>CLOSING YOUR ACCOUNT</span>

        {closureAvailable === false ? (
          <div style={card}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>Not available yet</div>
            <div style={{ fontSize: 11.5, color: 'rgba(1,22,39,0.55)', marginTop: 6, lineHeight: 1.55 }}>
              {closureReasonUnavailable === 'not_yet_migrated'
                ? 'Closing an account needs a pending database update. Rather than half-close an account — cancelling your shows but leaving your login working — this stays switched off until it can do the whole job.'
                : 'This is temporarily unavailable. Nothing about your account has changed.'}
            </div>
          </div>
        ) : !closing ? (
          <div style={card}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>Close my account</div>
            <div style={{ fontSize: 11.5, color: 'rgba(1,22,39,0.55)', marginTop: 6, lineHeight: 1.55 }}>
              Your login is disabled and your profile disappears from the platform. It is not a deletion,
              and the next screen says exactly what is kept and why.
            </div>
            <button type="button" onClick={() => setClosing(true)} disabled={closureAvailable === null} style={{ ...ghost, marginTop: 12, color: RED, borderColor: 'rgba(231,29,54,0.35)' }}>
              CLOSE MY ACCOUNT
            </button>
          </div>
        ) : (
          <div style={{ ...card, borderColor: 'rgba(231,29,54,0.4)' }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>Close your account?</div>

            <div style={{ fontSize: 10.5, letterSpacing: '0.08em', color: 'rgba(1,22,39,0.45)', marginTop: 12, fontWeight: 700 }}>WHAT HAPPENS</div>
            <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 12, color: 'rgba(1,22,39,0.65)', lineHeight: 1.75 }}>
              <li>You <strong>cannot log in</strong> any more.</li>
              <li>Your profile is <strong>hidden</strong> from Discover, search and every artist page.</li>
              <li>Your recordings become <strong>private</strong>. They are not deleted.</li>
              <li>Any <strong>upcoming shows are cancelled</strong>, and anyone holding a slot in one is told.</li>
            </ul>

            <div style={{ fontSize: 10.5, letterSpacing: '0.08em', color: 'rgba(1,22,39,0.45)', marginTop: 14, fontWeight: 700 }}>WHAT IS KEPT, AND WHY</div>
            <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 12, color: 'rgba(1,22,39,0.65)', lineHeight: 1.75 }}>
              <li>
                <strong>Your wallet history stays, in full.</strong> Money that moved, moved. A financial
                record that can be deleted is not a financial record — and it is the part you are most
                likely to need again.
              </li>
              <li>
                <strong>{profile?.role === 'artist' ? 'Your stage name' : 'Your username'} stays held.</strong>{' '}
                Releasing it would let someone else take it and be mistaken for you.
              </li>
              <li><strong>Your recordings and B-roll are not destroyed</strong> — only made private.</li>
            </ul>

            <div style={{ fontSize: 11.5, color: 'rgba(1,22,39,0.6)', marginTop: 12, lineHeight: 1.55 }}>
              <strong>This is a deactivation, not a deletion.</strong> If you want everything permanently
              erased instead, contact support and say so — that is a different request and we will treat
              it as one.
            </div>

            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 9.5, letterSpacing: '0.08em', color: 'rgba(1,22,39,0.5)', fontWeight: 700, marginBottom: 4 }}>
                WHY ARE YOU LEAVING? (OPTIONAL)
              </div>
              <textarea
                value={closeReason}
                onChange={(e) => setCloseReason(e.target.value)}
                rows={2}
                placeholder="It genuinely helps, and nobody will reply unless you ask them to."
                style={{ ...input, width: '100%', boxSizing: 'border-box', resize: 'vertical' }}
              />
            </div>

            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 9.5, letterSpacing: '0.08em', color: 'rgba(1,22,39,0.5)', fontWeight: 700, marginBottom: 4 }}>
                TYPE <strong style={{ color: RED }}>CLOSE</strong> TO CONFIRM
              </div>
              <input
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value.toUpperCase())}
                placeholder="CLOSE"
                autoCapitalize="characters"
                autoCorrect="off"
                style={{ ...input, width: 180, letterSpacing: '0.14em' }}
              />
            </div>

            {closeError && <div style={{ fontSize: 12, color: RED, marginTop: 10 }}>{closeError}</div>}

            <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={closeAccount}
                disabled={closeBusy || confirmText !== 'CLOSE'}
                style={{ ...dangerBtn, opacity: closeBusy || confirmText !== 'CLOSE' ? 0.5 : 1, cursor: confirmText === 'CLOSE' && !closeBusy ? 'pointer' : 'default' }}
              >
                {closeBusy ? 'CLOSING…' : 'CLOSE MY ACCOUNT'}
              </button>
              <button type="button" onClick={() => { setClosing(false); setCloseError(''); setConfirmText(''); }} style={ghost}>
                KEEP MY ACCOUNT
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
