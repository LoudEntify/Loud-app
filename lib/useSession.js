'use client';
// lib/useSession.js — the signed-in person, if any, and their profile.
// One subscription to Supabase auth state shared by every screen.
import { useEffect, useState } from 'react';
import { getSupabase } from './supabaseClient';

let cache = { session: undefined, profile: undefined };
const listeners = new Set();
function emit() { for (const l of listeners) l(cache); }

async function loadProfile(session) {
  if (!session?.user) return null;
  const { data } = await getSupabase().from('profiles').select('*').eq('id', session.user.id).maybeSingle();
  return data || null;
}

let started = false;
function start() {
  if (started || typeof window === 'undefined') return;
  started = true;
  const supabase = getSupabase();
  supabase.auth.getSession().then(async ({ data }) => {
    cache = { session: data.session || null, profile: await loadProfile(data.session) };
    emit();
  });
  supabase.auth.onAuthStateChange(async (_event, session) => {
    cache = { session: session || null, profile: await loadProfile(session) };
    emit();
  });
}

export function useSession() {
  const [state, setState] = useState(cache);
  useEffect(() => {
    start();
    listeners.add(setState);
    setState(cache);
    return () => listeners.delete(setState);
  }, []);
  return { session: state.session, profile: state.profile, loading: state.session === undefined, accessToken: state.session?.access_token || null };
}

export async function refreshProfile() {
  const { data } = await getSupabase().auth.getSession();
  cache = { session: data.session || null, profile: await loadProfile(data.session) };
  emit();
  return cache.profile;
}
