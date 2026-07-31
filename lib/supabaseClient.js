// lib/supabaseClient.js
// ─────────────────────────────────────────────────────────────
// Shared Supabase client (lazy singleton). Used by shotCommands.js
// for flywheel logging; reuse it anywhere else that needs the DB.
//
// Reads NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY
// from the environment (Vercel dashboard / .env.local) — values are
// never hardcoded here.
//
// PRD Scaling & Infrastructure: Database
// ─────────────────────────────────────────────────────────────

import { createClient } from '@supabase/supabase-js';

let client = null;

export function getSupabase() {
  if (!client) {
    client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    );
  }
  return client;
}
