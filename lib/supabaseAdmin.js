// lib/supabaseAdmin.js
// ─────────────────────────────────────────────────────────────
// Service-role Supabase client -- the FIRST service-role usage in this
// codebase (lib/supabaseClient.js's getSupabase() is anon-key-only and
// is called from client components). This one reads
// SUPABASE_SERVICE_ROLE_KEY (deliberately NOT prefixed NEXT_PUBLIC_ --
// that prefix means "inlined into the client bundle," the exact
// opposite of what a service-role key needs), same server-only
// convention as LIVEKIT_API_SECRET in app/api/token/route.js.
//
// The 'server-only' import throws a build error if this module is ever
// pulled into a client bundle. app/api/ routes get that guarantee for
// free from Next.js's own routing; a plain lib/ file does not, so this
// is the explicit guard for this one. Only import this from app/api/
// route handlers.
//
// Bypasses RLS entirely -- this is the only client that may ever touch
// show_slots (which has zero RLS policies at all: no anon key, of any
// permission, can read or write that table -- see MULTI_PERFORMER_SPEC.md
// section 1). Every table this client touches must be designed assuming
// it has unrestricted read/write access.
//
// PRD Scaling & Infrastructure: Database, Auth
// ─────────────────────────────────────────────────────────────

import 'server-only';
import { createClient } from '@supabase/supabase-js';

let client = null;

export function getSupabaseAdmin() {
  if (!client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceRoleKey) {
      throw new Error('Server missing SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_URL');
    }
    client = createClient(url, serviceRoleKey, {
      auth: { persistSession: false },
    });
  }
  return client;
}
