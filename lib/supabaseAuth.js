// lib/supabaseAuth.js
// ─────────────────────────────────────────────────────────────
// Real Supabase Auth (email+password), replacing lib/mockAccount.js's
// localStorage-only role flag for the two flows that actually create an
// identity: components/Auth.jsx (the general /auth page) and the new
// artist branch inside components/LiveDemo.jsx's gate step.
//
// Built on the existing anon-key singleton (lib/supabaseClient.js's
// getSupabase()) -- it already exposes .auth, and its default
// persistSession:true is exactly what a browser session needs. No new
// client, no @supabase/ssr: this app has no SSR data-fetching against
// Supabase to sync cookies for, so the plain browser client is enough.
//
// role/displayName/genre are captured in auth.users.user_metadata at
// signUp() time (Supabase's own `options.data`), not just passed
// straight into a profiles insert -- this is what makes ensureProfile()
// below work identically whether the Supabase project requires email
// confirmation or not. With confirmation OFF, signUp() returns a
// session immediately and the profile is created inline. With
// confirmation ON, signUp() returns no session (profiles_insert_own's
// RLS check needs auth.uid(), which needs a session), so profile
// creation is deferred to the first real signIn() after the user
// confirms -- ensureProfile() there reads the same metadata back off
// the now-authenticated user object. One code path covers both.
// ─────────────────────────────────────────────────────────────

import { getSupabase } from './supabaseClient';

export async function getProfile(userId) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();
  return { profile: data, error };
}

// Creates the profiles row for `user` if one doesn't exist yet. Safe to
// call on every sign-in/sign-up -- a no-op once the row exists.
export async function ensureProfile(user) {
  if (!user) return { profile: null, error: new Error('No user') };

  const existing = await getProfile(user.id);
  if (existing.profile || existing.error) return existing;

  const meta = user.user_metadata || {};
  if (!meta.role) {
    // Shouldn't happen for an account created via signUp() below --
    // guards against a stray auth.users row with no metadata rather
    // than throwing.
    return { profile: null, error: null };
  }

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('profiles')
    .insert({
      id: user.id,
      role: meta.role,
      display_name: meta.display_name,
      genre: meta.genre || null,
    })
    .select()
    .single();
  return { profile: data, error };
}

export async function signUp({ email, password, role, displayName, genre }) {
  const supabase = getSupabase();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { role, display_name: displayName, genre: genre || null } },
  });
  if (error) return { error };

  if (!data.session) {
    return { data, needsEmailConfirmation: true };
  }

  const { profile, error: profileError } = await ensureProfile(data.user);
  return { data, profile, error: profileError };
}

export async function signIn({ email, password }) {
  const supabase = getSupabase();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error };

  const { profile, error: profileError } = await ensureProfile(data.user);
  return { data, profile, error: profileError };
}

export async function signOut() {
  const supabase = getSupabase();
  return supabase.auth.signOut();
}

export async function getSession() {
  const supabase = getSupabase();
  const { data } = await supabase.auth.getSession();
  return data.session;
}

// Returns an unsubscribe function, same shape as lib/mockAccount.js's
// onAccountTypeChange -- callers (e.g. Sidebar.jsx, if it adopts real
// auth later) can swap one for the other without changing call sites.
export function onAuthStateChange(callback) {
  const supabase = getSupabase();
  const { data } = supabase.auth.onAuthStateChange((event, session) => callback(event, session));
  return () => data.subscription.unsubscribe();
}
