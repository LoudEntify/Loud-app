'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import EmptyState from './EmptyState';
import { getSession } from '../lib/supabaseAuth';

const INK = '#011627';
const PORCELAIN = '#fdfffc';
const TEAL = '#2ec4b6';

// The versus invite acceptance screen.
//
// Readable logged-out on purpose -- you should be able to see who is
// asking and what for BEFORE deciding to make an account. Accepting is
// what requires the account, because accepting is what binds the slot to
// a person.
export default function AcceptInvite({ token }) {
  const router = useRouter();
  const [invite, setInvite] = useState(undefined); // undefined = loading, null = invalid
  const [session, setSession] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = await getSession();
      if (!cancelled) setSession(s);
      try {
        const res = await fetch(`/api/performer/invite?token=${encodeURIComponent(token)}`);
        if (cancelled) return;
        if (!res.ok) { setInvite(null); return; }
        setInvite(await res.json());
      } catch {
        if (!cancelled) setInvite(null);
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  async function accept() {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/performer/join-show', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ show_id: invite.showId, invite_token: token }),
      });
      const body = await res.json();
      if (!res.ok) { setError(body.error || 'Could not accept this invite.'); return; }
      // The slot is now bound to this account, so the live page can let
      // them in by account alone -- no token to carry across the redirect.
      router.push(`/live?show=${invite.showId}`);
    } finally {
      setBusy(false);
    }
  }

  if (invite === undefined) {
    return <div style={{ padding: 40, fontSize: 12, color: 'rgba(1,22,39,0.4)' }}>Loading…</div>;
  }

  return (
    <div style={{ minHeight: '100vh', background: PORCELAIN, color: INK, padding: '40px 24px', boxSizing: 'border-box' }}>
      <div style={{ maxWidth: 460, margin: '0 auto' }}>
        <Link href="/discover" style={{ fontSize: 11, letterSpacing: '0.08em', color: TEAL, textDecoration: 'none' }}>LOUDENTIFY</Link>

        {!invite && (
          <div style={{ marginTop: 24 }}>
            <EmptyState
              title="This invite is no longer valid"
              body="It may have already been accepted, or replaced by a newer one. Ask whoever sent it for a fresh link."
              action="BROWSE SHOWS"
              actionHref="/discover"
            />
          </div>
        )}

        {invite && (
          <>
            <div style={{ fontSize: 10, letterSpacing: '0.14em', color: 'rgba(1,22,39,0.5)', marginTop: 26 }}>YOU&apos;RE INVITED TO PERFORM</div>
            <div style={{ fontSize: 24, fontWeight: 700, marginTop: 8, lineHeight: 1.2 }}>
              {invite.title || 'Untitled show'}
            </div>
            <div style={{ fontSize: 12.5, color: 'rgba(1,22,39,0.6)', marginTop: 8, lineHeight: 1.6 }}>
              {invite.hostName ? <>Hosted by <strong style={{ color: INK }}>{invite.hostName}</strong>. </> : null}
              {new Date(invite.slatedAt).toLocaleString(undefined, { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })}.
              {' '}You&apos;d be taking <strong style={{ color: INK }}>slot B</strong> in a versus show.
            </div>

            {error && <div style={{ fontSize: 12, color: '#e71d36', marginTop: 14 }}>{error}</div>}

            {session ? (
              <button
                type="button"
                onClick={accept}
                disabled={busy}
                style={{ marginTop: 22, width: '100%', padding: '15px 0', fontSize: 12, fontWeight: 700, letterSpacing: '0.1em', color: PORCELAIN, background: 'linear-gradient(90deg,#2ec4b6,#ff9f1c)', border: 'none', cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}
              >
                {busy ? 'ACCEPTING…' : 'ACCEPT AND TAKE SLOT B'}
              </button>
            ) : (
              <div style={{ marginTop: 22 }}>
                <EmptyState
                  title="Log in to accept"
                  body="Your slot gets tied to your account, so you can rejoin from any device if you drop out mid-show."
                  action="LOG IN OR SIGN UP"
                  actionHref={`/auth?next=${encodeURIComponent(`/join/${token}`)}`}
                />
              </div>
            )}

            <div style={{ fontSize: 10.5, color: 'rgba(1,22,39,0.4)', marginTop: 16, lineHeight: 1.5 }}>
              This link works once. Once you accept, it stops working for anyone else.
            </div>
          </>
        )}
      </div>
    </div>
  );
}
