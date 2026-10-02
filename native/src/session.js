// native/src/session.js — Supabase Auth on the phone: sessions persisted in
// AsyncStorage, the same email/password flow as the web (Apple/Google
// sign-in arrive with the providers in NEEDS_KOREY). Tokens stay in the
// app's storage; the web app's routes are called with the bearer token.
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config';

let client = null;
// True when the build carries Supabase values (EXPO_PUBLIC_SUPABASE_URL and
// EXPO_PUBLIC_SUPABASE_ANON_KEY, or app.json extra). Without them the app
// still opens and browses as a guest instead of dying on the first screen.
export const AUTH_CONFIGURED = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
export function supabase() {
  if (!AUTH_CONFIGURED) throw new Error('Supabase is not configured for this build: set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY (native/README.md).');
  if (!client) client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { storage: AsyncStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false } });
  return client;
}

export function useSession() {
  const [state, setState] = useState({ session: undefined, profile: undefined });
  useEffect(() => {
    if (!AUTH_CONFIGURED) { setState({ session: null, profile: null }); return undefined; }
    const sb = supabase();
    const load = async (session) => {
      const profile = session?.user ? (await sb.from('profiles').select('*').eq('id', session.user.id).maybeSingle()).data : null;
      setState({ session: session || null, profile });
    };
    sb.auth.getSession().then(({ data }) => load(data.session));
    const { data } = sb.auth.onAuthStateChange((_e, session) => load(session));
    return () => data.subscription.unsubscribe();
  }, []);
  return { ...state, loading: state.session === undefined, accessToken: state.session?.access_token || null };
}
