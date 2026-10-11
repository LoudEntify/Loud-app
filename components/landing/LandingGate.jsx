'use client';
// components/landing/LandingGate.jsx — signed-in people do not need the
// landing page: they go straight to the app. Sign-in state lives only in
// the browser (lib/supabaseAuth.js: no cookies, no server session), so the
// landing renders for everyone and this replaces the URL once a session is
// found. It reads the existing session and nothing else: no profile
// query, no auth change.
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export const APP_HOME = '/discover';

export default function LandingGate() {
  const router = useRouter();
  useEffect(() => {
    let cancelled = false; let unsub = null;
    const go = (session) => { if (!cancelled && session?.user) router.replace(APP_HOME); };
    // The Supabase client is loaded here, after the page has painted, so
    // the landing's first bundle stays small for the signed-out majority.
    import('../../lib/supabaseAuth').then(({ getSession, onAuthStateChange }) => {
      if (cancelled) return;
      getSession().then(go).catch(() => {});
      unsub = onAuthStateChange((_event, session) => go(session));
    }).catch(() => {});
    return () => { cancelled = true; unsub?.(); };
  }, [router]);
  return null;
}
