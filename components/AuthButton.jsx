'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { SignOut, SignIn } from '@phosphor-icons/react';
import { getSession, signOut, onAuthStateChange } from '../lib/supabaseAuth';

const INK = '#011627';
const TEAL = '#2ec4b6';

// Log in / log out, on the profile pages.
//
// `signOut()` has existed in lib/supabaseAuth.js since auth landed, but
// nothing in the UI ever called it -- which is why a signed-in session
// was a one-way door. This is that missing call site.
//
// Two things it does beyond calling signOut():
//
//   1. Clears the legacy account-type flag in localStorage. Sidebar and
//      AccountSettings still read it, so leaving it behind means the nav
//      keeps insisting you are an artist after you have logged out.
//   2. Sends you to /auth even if the network call fails. A session that
//      cannot be revoked server-side (deleted user, expired token, no
//      connection) must still let you OUT of the app locally -- being
//      stuck signed in as an account that no longer exists is exactly
//      the trap this is fixing.
export default function AuthButton({ compact = false }) {
  const router = useRouter();
  const [session, setSession] = useState(undefined); // undefined = unknown
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = await getSession();
      if (!cancelled) setSession(s);
    })();
    const unsub = onAuthStateChange((_event, s) => {
      if (!cancelled) setSession(s);
    });
    return () => { cancelled = true; unsub?.(); };
  }, []);

  async function handleSignOut() {
    setBusy(true);
    try {
      await signOut();
    } catch {
      // Deliberately swallowed -- see note 2 above. Local sign-out still
      // has to happen.
    }
    try {
      window.localStorage?.removeItem('loudentify:accountType');
      window.localStorage?.removeItem('accountType');
    } catch {
      // private mode / storage disabled
    }
    setBusy(false);
    router.replace('/auth');
    router.refresh();
  }

  if (session === undefined) return null; // don't flash the wrong verb

  const label = session ? 'LOG OUT' : 'LOG IN';
  const Icon = session ? SignOut : SignIn;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      {session?.user?.email && !compact && (
        <span style={{ fontSize: 10.5, color: 'rgba(1,22,39,0.45)' }}>
          Signed in as {session.user.email}
        </span>
      )}
      <button
        type="button"
        onClick={session ? handleSignOut : () => router.push('/auth')}
        disabled={busy}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: compact ? '7px 12px' : '9px 14px',
          fontSize: 10.5,
          fontWeight: 700,
          letterSpacing: '0.08em',
          color: session ? INK : TEAL,
          background: 'transparent',
          border: `1px solid ${session ? 'rgba(1,22,39,0.25)' : TEAL}`,
          borderRadius: 999,
          cursor: busy ? 'default' : 'pointer',
          opacity: busy ? 0.6 : 1,
        }}
      >
        <Icon size={13} weight="bold" />
        {busy ? 'SIGNING OUT…' : label}
      </button>
    </div>
  );
}
