// Read-only check: never inserts a signup or prints credentials/personal data.
import nextEnv from '@next/env';
import { createClient } from '@supabase/supabase-js';

nextEnv.loadEnvConfig(process.cwd());

async function check() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const missing = [
    !url && 'NEXT_PUBLIC_SUPABASE_URL',
    !key && 'SUPABASE_SERVICE_ROLE_KEY',
  ].filter(Boolean);
  if (missing.length) {
    throw new Error(`Set ${missing.join(' and ')} in .env.local (and in your hosting environment).`);
  }
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error, status } = await client.from('waitlist_signups')
    .select('id,role,email,name,city,genre,consent,consent_version,consent_at,source,created_at')
    .limit(0);
  if (error) {
    if (['PGRST205', '42P01', '42703', 'PGRST204'].includes(error.code)) {
      throw new Error('Waitlist schema is missing or incompatible. Run docs/waitlist_migration.sql in Supabase.');
    }
    if (status === 401 || status === 403) {
      throw new Error('Supabase rejected the server key. Check that the URL and service-role key belong to the same project.');
    }
    throw new Error(`Supabase connection failed (HTTP ${status}, code ${error.code || 'network error'}). Check project availability and network access.`);
  }
  console.log('Waitlist table and expected columns are reachable with the configured server key. No rows were read or written.');
  console.log('Submit the form and verify its row in Supabase to confirm write access.');
}

check().catch(error => {
  console.error(`Waitlist check failed: ${error.message}`);
  process.exitCode = 1;
});
