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
// role/displayName are captured in auth.users.user_metadata at signUp()
// time (Supabase's own `options.data`), not just passed straight into a
// profiles insert -- this is what makes ensureProfile() below work
// identically whether the Supabase project requires email confirmation
// or not. With confirmation OFF, signUp() returns a session immediately
// and the profile is created inline. With confirmation ON, signUp()
// returns no session (profiles_insert_own's RLS check needs auth.uid(),
// which needs a session), so profile creation is deferred to the first
// real signIn() after the user confirms -- ensureProfile() there reads
// the same metadata back off the now-authenticated user object. One code
// path covers both.
//
// genres is NOT collected at signup (product decision, fold-in round) --
// every account starts with genres: [] and picks from lib/genres.js's
// fixed list later via Settings (components/GenreSelect.jsx), since
// signup never had a real multi-select UI and free-typing a genre at
// signup would have been the one place the "no free-typing outside the
// list" rule didn't actually hold.
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

  // Overnight round: signup now collects full_name / username /
  // date_of_birth / country as well. Those columns arrive with
  // docs/profile_fields_migration.sql, which is run by hand -- so this
  // attempts the full row first and falls back to the original column
  // set if the migration hasn't been applied yet. Without the fallback
  // the whole signup would 400 on an unmigrated database and the
  // preview would be unusable until the SQL was run.
  const base = {
    id: user.id,
    role: meta.role,
    display_name: meta.display_name,
    genres: Array.isArray(meta.genres) ? meta.genres : [],
  };
  const extended = {
    ...base,
    full_name: meta.full_name ?? null,
    username: meta.username ?? null,
    date_of_birth: meta.date_of_birth ?? null,
    country: meta.country ?? null,
  };

  let { data, error } = await supabase.from('profiles').insert(extended).select().single();
  if (error && isMissingColumnError(error)) {
    console.warn('[auth] profiles is missing the new signup columns -- run docs/profile_fields_migration.sql. Falling back to base fields.');
    ({ data, error } = await supabase.from('profiles').insert(base).select().single());
  }
  return { profile: data, error };
}

// PostgREST reports an unknown column as 42703; the message check is a
// belt-and-braces fallback for older/newer error shapes.
function isMissingColumnError(error) {
  if (!error) return false;
  if (error.code === '42703' || error.code === 'PGRST204') return true;
  const msg = String(error.message || '').toLowerCase();
  return msg.includes('column') && (msg.includes('does not exist') || msg.includes('schema cache'));
}

/**
 * Is this handle free? Best-effort: a race between check and insert is
 * still caught by the unique index, which is the real guarantee. Returns
 * true (available) if the column doesn't exist yet, so pre-migration
 * signups aren't blocked by a check that cannot mean anything.
 */
export async function isUsernameAvailable(username) {
  const handle = normaliseUsername(username);
  if (!handle) return false;
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('profiles')
    .select('id')
    .eq('username', handle)
    .maybeSingle();
  if (error) return !isMissingColumnError(error) ? false : true;
  return !data;
}

export function normaliseUsername(raw) {
  return String(raw || '').trim().toLowerCase();
}

export const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;

/** Null when valid, else a human-readable reason. */
export function validateUsername(raw) {
  const handle = normaliseUsername(raw);
  if (!handle) return 'Pick a username.';
  if (!USERNAME_PATTERN.test(handle)) {
    return '3-20 characters, lowercase letters, numbers and underscores only.';
  }
  return null;
}

export async function signUp({ email, password, role, displayName, fullName, username, dateOfBirth, country, genres }) {
  const supabase = getSupabase();
  // Everything extra rides in user_metadata so ensureProfile() can build
  // the row on first sign-in too (the email-confirmation path never
  // reaches ensureProfile at signup time).
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        role,
        display_name: displayName,
        full_name: fullName || null,
        username: username ? normaliseUsername(username) : null,
        date_of_birth: dateOfBirth || null,
        country: country || null,
        genres: Array.isArray(genres) ? genres : [],
      },
    },
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

  // Fixed, extensionless path -- Day 2 test sitting, Finding 4's "orphaned
  // strays" note: the previous path included the uploaded file's own
  // extension (photo.jpg, photo.png, ...), so upsert:true only overwrote a
  // re-upload of the SAME format; a different format on retry silently
  // left the old object behind instead of replacing it. content-type is
  // stored as upload metadata (contentType below), so the path itself
  // never needs an extension for the file to render correctly.
  const path = `${userId}/avatar`;
  const { error: uploadErr } = await supabase.storage
    .from('avatars')
    .upload(path, file, { upsert: true, cacheControl: '3600', contentType: file.type });
  if (uploadErr) return { error: uploadErr };

  const { data: publicData } = supabase.storage.from('avatars').getPublicUrl(path);
  // Cache-bust -- the storage path is now stable across re-uploads by
  // design (the fix above), so the public URL string would otherwise be
  // byte-identical after a fresh upload and a browser could keep showing
  // a cached old image.
  return { url: `${publicData.publicUrl}?v=${Date.now()}` };
}
