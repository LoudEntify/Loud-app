#!/usr/bin/env node
/* eslint-disable no-console */

// scripts/smoke-bootstrap.mjs
// ─────────────────────────────────────────────────────────────
// Creates (or removes) the dedicated test account the smoke check signs
// in as. Run ONCE per database.
//
//   node scripts/smoke-bootstrap.mjs          create
//   node scripts/smoke-bootstrap.mjs --delete remove it again
//
// ── ⚠️ THIS IS THE ONE THING HERE THAT WRITES TO THE DATABASE ──
// It creates a single row in `auth.users`, via the Supabase Admin API,
// with `email_confirm: true`.
//
// It is flagged this loudly because the standing boundary is that I do
// not touch the database. Three things about why this is the exception
// and why it is narrow:
//
//   1. It is a TEST FIXTURE, not a verification shortcut. Every actual
//      check still goes through the app: the real login form, the real
//      pages, a real browser. Nothing reads the database to decide
//      whether a page worked.
//   2. It is not a schema change. No column, no table, no policy — the
//      migration boundary is untouched.
//   3. The obvious alternative does not work here: signing up through
//      the form returns
//      `500 {"code":"unexpected_failure","message":"Error sending
//      confirmation email"}` on this project, because email confirmation
//      is ON and SMTP is not configured. `email_confirm: true` is
//      precisely the documented way around that for a seeded account.
//
// If you would rather it did not exist: `--delete` removes it, or turn
// off email confirmation for the preview project and the normal signup
// path works with no admin call at all.
//
// The account is deliberately obvious in any list of artists — nobody
// should ever mistake it for a real person and message it.
// ─────────────────────────────────────────────────────────────

import { createClient } from '@supabase/supabase-js';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const EMAIL = process.env.SMOKE_EMAIL || '';
const PASSWORD = process.env.SMOKE_PASSWORD || '';
const HANDLE = process.env.SMOKE_HANDLE || 'loud_smoke_test';
const DELETE = process.argv.includes('--delete');

if (!URL || !SERVICE_KEY || !EMAIL || !PASSWORD) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SMOKE_EMAIL / SMOKE_PASSWORD.');
  console.error('See docs/SMOKE_TEST.md.');
  process.exit(2);
}

const admin = createClient(URL, SERVICE_KEY, { auth: { persistSession: false } });

async function findUser() {
  // listUsers is paged; the fixture is created once and early, so one
  // page is plenty and this avoids paging logic nobody will maintain.
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw error;
  return (data?.users || []).find((u) => (u.email || '').toLowerCase() === EMAIL.toLowerCase()) || null;
}

const existing = await findUser();

if (DELETE) {
  if (!existing) { console.log(`Nothing to delete — no user with ${EMAIL}.`); process.exit(0); }
  // The profiles row has ON DELETE CASCADE from auth.users, so removing
  // the auth user takes the profile with it.
  const { error } = await admin.auth.admin.deleteUser(existing.id);
  if (error) { console.error('Delete failed:', error.message); process.exit(1); }
  console.log(`✔ Deleted the smoke test account (${EMAIL}) and its profile.`);
  process.exit(0);
}

let userId = existing?.id;

if (existing) {
  console.log(`• Auth user already exists (${EMAIL}) — reusing it.`);
} else {
  const { data, error } = await admin.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    // The whole reason for the admin call. Without it the account can
    // never sign in on a project whose SMTP is not configured.
    email_confirm: true,
    // The SAME metadata shape signUp() writes (lib/supabaseAuth.js), so
    // ensureProfile() builds the profile row on first sign-in exactly as
    // it would for a real account. A fixture that skipped this would be
    // testing a profile shape the app never produces.
    user_metadata: {
      role: 'artist',
      display_name: 'Smoke Test',
      full_name: 'Smoke Test',
      username: HANDLE,
      date_of_birth: '1990-01-01',
      country: 'GB',
      genres: [],
    },
  });
  if (error) { console.error('Create failed:', error.message); process.exit(1); }
  userId = data.user.id;
  console.log(`✔ Created auth user ${EMAIL}`);
}

// ensureProfile() runs on first sign-in and would create this anyway.
// Doing it here means the very first smoke run has a console to load
// rather than spending its first navigation creating a profile.
const { data: profile } = await admin.from('profiles').select('id, role').eq('id', userId).maybeSingle();
if (!profile) {
  const { error } = await admin.from('profiles').insert({
    id: userId,
    role: 'artist',
    display_name: 'Smoke Test',
    full_name: 'Smoke Test',
    username: HANDLE,
    date_of_birth: '1990-01-01',
    country: 'GB',
    genres: [],
  });
  if (error) console.warn('  profile insert warning:', error.message, '(first sign-in will create it)');
  else console.log('✔ Created its profiles row (role: artist)');
} else {
  console.log(`• Profile already present (role: ${profile.role}).`);
}

console.log(`\nUser id: ${userId}`);
console.log('Now run:  npm run smoke');
