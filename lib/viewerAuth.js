// lib/viewerAuth.js — session helpers for the viewer routes.
// optionalSession: a bearer token is used if present, otherwise the caller
// is a guest. requireSession: the same, but 401 without one.
import 'server-only';
import { getSupabaseAdmin } from './supabaseAdmin';

export async function optionalSession(request) {
  const h = request.headers.get('authorization') || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return { user: null, profile: null };
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) return { user: null, profile: null };
  const { data: profile } = await admin.from('profiles').select('*').eq('id', data.user.id).maybeSingle();
  return { user: data.user, profile: profile || null };
}

export async function requireSession(request) {
  const s = await optionalSession(request);
  if (!s.user) return { ...s, error: 'Sign in to do that.', status: 401 };
  if (s.profile?.deactivated_at) return { ...s, error: 'This account is closed.', status: 403 };
  return s;
}
