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

// Accounts & Identity Day 2 -- profile editing for both roles. Goes
// straight through the anon client under RLS (profiles_update_own from Day
// 1 already permits this for an authenticated user editing their own row)
// -- no API route needed, same reasoning as ensureProfile()'s insert above.
export async function updateProfile(fields) {
  const supabase = getSupabase();
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user?.id;
  if (!userId) return { error: new Error('Not signed in') };

  const { data, error } = await supabase
    .from('profiles')
    .update(fields)
    .eq('id', userId)
    .select()
    .single();
  return { profile: data, error };
}

// Artist-only photo upload to the public `avatars` bucket (docs/
// recordings_migration.sql), path-scoped to the uploader's own folder --
// enforced both here (client-side check before even attempting) and by the
// bucket's own owner-write storage policy (the real trust boundary; this
// check is just fast, friendly feedback).
const MAX_AVATAR_BYTES = 5 * 1024 * 1024; // 5MB

export async function uploadAvatar(file) {
  if (file.size > MAX_AVATAR_BYTES) {
    return { error: new Error('Image must be under 5MB') };
  }

  const supabase = getSupabase();
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user?.id;
  if (!userId) return { error: new Error('Not signed in') };

  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const path = `${userId}/photo.${ext}`;
  const { error: uploadErr } = await supabase.storage
    .from('avatars')
    .upload(path, file, { upsert: true, cacheControl: '3600' });
  if (uploadErr) return { error: uploadErr };

  const { data: publicData } = supabase.storage.from('avatars').getPublicUrl(path);
  return { url: publicData.publicUrl };
}
