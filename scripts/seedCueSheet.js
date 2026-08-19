// scripts/seedCueSheet.js
// ─────────────────────────────────────────────────────────────
// Cue-Sheet Director, Phase 1 (CD-1). Hand-written seed for the
// end-to-end spine proof -- run manually:
//
//   node scripts/seedCueSheet.js
//
// Written as a plain ES module (not run through Next's build pipeline,
// unlike everything under lib/app), so it deliberately does NOT import
// lib/supabaseAdmin.js -- that module's own doc comment scopes it to
// "app/api/ route handlers" and pulls in 'server-only', which has
// nothing to guard here. This script builds its own minimal
// service-role client with the same two env vars instead, and reuses
// lib/cueSheetValidation.js (plain, dependency-free ESM) so a
// hand-authored cue row is validated with the exact same rules
// cueDirector applies defensively at read time.
//
// Deletes any existing sheet for the same (show_id, slot) first, so
// re-running this while iterating on cue timings doesn't accumulate
// duplicate rows.
// ─────────────────────────────────────────────────────────────

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { validateCueSheet, isValidFallbackBehaviour } from '../lib/cueSheetValidation.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// No dotenv dependency in this project -- load .env.local by hand if
// present, same file `next dev` itself reads, without overriding
// anything already set in the actual environment.
function loadEnvLocal() {
  const envPath = join(__dirname, '..', '.env.local');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadEnvLocal();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('[seedCueSheet] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (checked process.env and .env.local)');
  process.exit(1);
}

// ─── The hand-written sheet ────────────────────────────────────
// pilot-room, slot 'a' -- the main-performer identifier convention
// confirmed in app/api/token/route.js (requestedContestant 'a'|'b')
// and components/LiveDemo.jsx (slot: role, role derived from the
// 'contestant-a-'/'contestant-b-' identity prefix). 5 cues across 52s,
// three distinct slot_roles (wide/main/side), one pan cue to exercise
// the motion.direction path.
const SHOW_ID = 'pilot-room';
const SLOT = 'a';
const TRACK_LABEL = 'phase-1 spine proof (any file -- content is irrelevant, only timing matters)';
const FALLBACK_BEHAVIOUR = 'default_wide';
const RAW_CUES = [
  { timestamp_ms: 0, shot_type: 'wide', slot_role: 'wide' },
  { timestamp_ms: 12_000, shot_type: 'mediumCU', slot_role: 'main' },
  { timestamp_ms: 26_000, shot_type: 'closeUp', slot_role: 'main' },
  { timestamp_ms: 40_000, shot_type: 'pan', slot_role: 'main', motion: { direction: 'left' } },
  { timestamp_ms: 52_000, shot_type: 'bRoll', slot_role: 'side' },
];

async function main() {
  if (!isValidFallbackBehaviour(FALLBACK_BEHAVIOUR)) {
    console.error(`[seedCueSheet] Invalid fallback_behaviour "${FALLBACK_BEHAVIOUR}"`);
    process.exit(1);
  }

  const { cues, errors } = validateCueSheet(RAW_CUES);
  if (errors.length > 0) {
    console.error('[seedCueSheet] Validation failed:');
    errors.forEach((e) => console.error(`  - ${e}`));
    process.exit(1);
  }

  console.log('[seedCueSheet] Normalized cues:');
  console.log(JSON.stringify(cues, null, 2));

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const { error: deleteError, count } = await supabase
    .from('cue_sheets')
    .delete({ count: 'exact' })
    .eq('show_id', SHOW_ID)
    .eq('slot', SLOT);
  if (deleteError) {
    console.error('[seedCueSheet] Failed to clear existing sheet(s):', deleteError);
    process.exit(1);
  }
  if (count) console.log(`[seedCueSheet] Cleared ${count} existing sheet(s) for ${SHOW_ID}/${SLOT}`);

  const { data, error } = await supabase
    .from('cue_sheets')
    .insert({
      show_id: SHOW_ID,
      slot: SLOT,
      track_label: TRACK_LABEL,
      fallback_behaviour: FALLBACK_BEHAVIOUR,
      cues,
    })
    .select('id')
    .single();

  if (error) {
    console.error('[seedCueSheet] Insert failed:', error);
    process.exit(1);
  }

  console.log(`\n[seedCueSheet] Inserted cue_sheets.id = ${data.id}`);
  console.log(`Load the preview as the main performer with ?cueSheet=${data.id}`);
}

main();
