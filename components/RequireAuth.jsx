'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { getSession, onAuthStateChange } from '../lib/supabaseAuth';

const INK = '#011627';

// Route gate. The anonymous viewer path is retired -- watching a show
// now requires an account, same as performing in one.
//
// Renders NOTHING until the session is known, rather than flashing the
// gated content and then yanking it away: a half-second of someone
// else's live show before a redirect is worse than a beat of nothing.
//
// The post-login return path rides in ?next= so a shared show link
// survives the detour through the auth page.
export default function RequireAuth({ children }) {
  const router = useRouter();
  const pathname = usePathname();
  const [state, setState] = useState('checking'); // checking | authed | anon

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const session = await getSession();
      if (cancelled) return;
      setState(session ? 'authed' : 'anon');
    })();

    // Covers logging out in another tab, and the sign-in completing
    // while this component is mounted.
    const unsub = onAuthStateChange((_event, session) => {
      if (cancelled) return;
      setState(session ? 'authed' : 'anon');
    });

    return () => {
      cancelled = true;
      unsub?.();
    };
  }, []);

  useEffect(() => {
    if (state !== 'anon') return;
    const next = encodeURIComponent(pathname || '/live');
    router.replace(`/auth?next=${next}`);
  }, [state, pathname, router]);

  if (state === 'authed') return children;

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: INK,
        color: 'rgba(253,255,252,0.5)',
        fontSize: 12,
        letterSpacing: '0.08em',
      }}
    >
      {state === 'checking' ? '' : 'REDIRECTING…'}
    </div>
  );
}
