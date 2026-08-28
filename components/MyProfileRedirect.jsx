'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import FanProfile from './FanProfile';
import EmptyState from './EmptyState';
import { getSession, getProfile } from '../lib/supabaseAuth';

// "My profile" resolver, behind both /profile and /dashboard.
//
// The dashboard is not a destination any more -- an artist's console
// lives on their own profile. So both old routes resolve HERE and then
// send you to the right place:
//   artist  -> /artist/{their id}, which renders in owner mode
//   viewer  -> the viewer profile, in place (no artist page exists to
//              send them to, and inventing one would be a lie)
//
// `replace`, not `push`: /dashboard should not sit in history as a
// separate page you can go "back" to.
export default function MyProfileRedirect() {
  const router = useRouter();
  const [state, setState] = useState('checking'); // checking | viewer | anon

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const session = await getSession();
      if (cancelled) return;
      if (!session?.user) { setState('anon'); return; }
      const { profile } = await getProfile(session.user.id);
      if (cancelled) return;
      if (profile?.role === 'artist') {
        router.replace(`/artist/${session.user.id}`);
        return;
      }
      setState('viewer');
    })();
    return () => { cancelled = true; };
  }, [router]);

  if (state === 'viewer') return <FanProfile />;
  if (state === 'anon') {
    return (
      <div style={{ padding: 40 }}>
        <EmptyState title="Sign in to see your profile" action="LOG IN" actionHref="/auth" />
      </div>
    );
  }
  return <div style={{ padding: 40, fontSize: 12, color: 'rgba(1,22,39,0.4)' }}>Loading…</div>;
}
