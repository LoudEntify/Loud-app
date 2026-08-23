// lib/verifyArtistAuth.js
// ─────────────────────────────────────────────────────────────
// Server-side artist-auth check for API routes. Reads a
// `Authorization: Bearer <access_token>` header (the session token
// lib/supabaseAuth.js's client already holds after signIn/signUp),
// verifies it via the service-role client (the only client trusted to
// resolve an arbitrary JWT to its user, same 'server-only' guard as
// lib/supabaseAdmin.js itself), then confirms the matching profiles row
// has role:'artist' -- auth alone only proves WHO the caller is;
// membership in profiles with role:'artist' is what proves they're
// allowed to claim a performer slot.
//
// Returns { user, profile } on success, or { error, status } on
// failure -- callers return that directly as the route's response body/
// status, matching the plain-NextResponse style every route in app/api/
// already uses, rather than this throwing.
// ─────────────────────────────────────────────────────────────

import 'server-only';
import { getSupabaseAdmin } from './supabaseAdmin';

export async function verifyArtistAuth(request) {
  const authHeader = request.headers.get('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return { error: 'Missing Authorization header', status: 401 };
  }

  const admin = getSupabaseAdmin();
  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData?.user) {
    return { error: 'Invalid or expired session', status: 401 };
  }

  const { data: profile, error: profileErr } = await admin
    .from('profiles')
    .select('*')
    .eq('id', userData.user.id)
    .maybeSingle();
  if (profileErr || !profile) {
    return { error: 'No profile found for this account', status: 403 };
  }
  if (profile.role !== 'artist') {
    return { error: 'This action requires an artist account', status: 403 };
  }

  return { user: userData.user, profile };
}

// Session-only verification: proves WHO is asking, without requiring an
// artist role.
//
// Needed because the viewer -> artist upgrade is, by definition, made by
// someone who is not yet an artist -- verifyArtistAuth would 403 the
// exact request that is supposed to make them one. Kept in this file
// rather than a new one so both checks are read together and nobody
// reaches for the wrong one by accident.
export async function verifySession(request) {
  const authHeader = request.headers.get('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return { error: 'Missing Authorization header', status: 401 };
  }

  const admin = getSupabaseAdmin();
  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData?.user) {
    return { error: 'Invalid or expired session', status: 401 };
  }

  const { data: profile } = await admin
    .from('profiles')
    .select('*')
    .eq('id', userData.user.id)
    .maybeSingle();

  return { user: userData.user, profile: profile || null };
}
