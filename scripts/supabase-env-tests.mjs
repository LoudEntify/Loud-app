#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/supabase-env-tests.mjs -- pure-function tests for the build-time
// Supabase environment resolution in lib/supabaseBuildEnv.cjs (used by
// next.config.js). No Vercel, no network, no process.env: every case
// passes its own env object in.
//
// Two things are under test:
//   1. the override: STAGING_* wins over NEXT_PUBLIC_* only on the Vercel
//      Preview build of the `staging` branch, and nowhere else;
//   2. the guard: preview or staging builds that would point anywhere
//      but the staging project fail loudly; production never guards.
import { resolveSupabaseBuildEnv, isStagingPreviewBuild, guardApplies, STAGING_PROJECT_REF } from '../lib/supabaseBuildEnv.cjs';

let fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail += 1;
  console.log(`${ok ? 'PASS  ' : '**FAIL** '}${name}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
};
const throws = (name, fn, mustMention = []) => {
  let err = null;
  try { fn(); } catch (e) { err = e; }
  const ok = !!err && mustMention.every((s) => String(err.message).includes(s));
  if (!ok) fail += 1;
  console.log(`${ok ? 'PASS  ' : '**FAIL** '}${name}  ${err ? `threw: ${String(err.message).slice(0, 110)}…` : 'did not throw'}`);
};

const STAGING_URL = `https://${STAGING_PROJECT_REF}.supabase.co`;
const STAGING_KEY = 'sb_publishable_staging_key';
const PILOT_URL = 'https://pilotpilotpilotpilot.supabase.co';
const PILOT_KEY = 'pilot-anon-key';
const PROD_URL = 'https://prodprodprodprodprod.supabase.co';

// The pilot's NEXT_PUBLIC_* values, which Vercel applies to every Preview.
const pilotPublic = { NEXT_PUBLIC_SUPABASE_URL: PILOT_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: PILOT_KEY };
// The branch-scoped staging Preview variables.
const stagingVars = { STAGING_SUPABASE_URL: STAGING_URL, STAGING_SUPABASE_PUBLISHABLE_KEY: STAGING_KEY };

console.log('── override: staging preview wins over the pilot values ──');
{
  const env = { VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'staging', ...pilotPublic, ...stagingVars };
  const r = resolveSupabaseBuildEnv(env);
  eq('isStagingPreviewBuild', isStagingPreviewBuild(env), true);
  eq('override flag set', r.override, true);
  eq('url comes from STAGING_SUPABASE_URL', r.url, STAGING_URL);
  eq('anon key comes from STAGING_SUPABASE_PUBLISHABLE_KEY', r.anonKey, STAGING_KEY);
  eq('next.config env block carries the staging values', r.env, {
    NEXT_PUBLIC_SUPABASE_URL: STAGING_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: STAGING_KEY,
  });
  eq('input env is not mutated', env.NEXT_PUBLIC_SUPABASE_URL, PILOT_URL);
}
{
  // Even with no pilot values present at all, staging preview still resolves.
  const r = resolveSupabaseBuildEnv({ VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'staging', ...stagingVars });
  eq('staging preview works without any NEXT_PUBLIC_* set', r.env.NEXT_PUBLIC_SUPABASE_URL, STAGING_URL);
}

console.log('\n── no override anywhere else: behaviour exactly as today ──');
const untouched = (name, env) => {
  const r = resolveSupabaseBuildEnv(env);
  eq(`${name}: no override`, r.override, false);
  eq(`${name}: env block is empty`, r.env, {});
  eq(`${name}: url is NEXT_PUBLIC_SUPABASE_URL`, r.url, env.NEXT_PUBLIC_SUPABASE_URL);
  eq(`${name}: anon key is NEXT_PUBLIC_SUPABASE_ANON_KEY`, r.anonKey, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
};
untouched('production', { VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_REF: 'main', NEXT_PUBLIC_SUPABASE_URL: PROD_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: 'prod-key', ...stagingVars });
untouched('local (no Vercel vars)', { ...pilotPublic, ...stagingVars });
untouched('local, nothing set at all', {});
untouched('GitHub Actions CI (no Vercel vars, no Supabase vars)', { CI: 'true', GITHUB_REF_NAME: 'staging' });
untouched('another preview branch pointing at staging', { VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'feat/thing', NEXT_PUBLIC_SUPABASE_URL: STAGING_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: 'k', ...stagingVars });
untouched('development env on staging branch (not preview)', { VERCEL_ENV: 'development', VERCEL_GIT_COMMIT_REF: 'staging', NEXT_PUBLIC_SUPABASE_URL: STAGING_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: 'k', ...stagingVars });
eq('isStagingPreviewBuild false for a feature-branch preview', isStagingPreviewBuild({ VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'feat/thing' }), false);
eq('isStagingPreviewBuild false for production', isStagingPreviewBuild({ VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_REF: 'staging' }), false);
eq('isStagingPreviewBuild false with no Vercel vars', isStagingPreviewBuild({}), false);

console.log('\n── guard: when it applies ──');
eq('applies to a staging preview', guardApplies({ VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'staging' }), true);
eq('applies to any other preview branch', guardApplies({ VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'feat/thing' }), true);
eq('applies to the staging branch whatever VERCEL_ENV says (non-production)', guardApplies({ VERCEL_ENV: 'development', VERCEL_GIT_COMMIT_REF: 'staging' }), true);
eq('applies to the staging branch with VERCEL_ENV unset', guardApplies({ VERCEL_GIT_COMMIT_REF: 'staging' }), true);
eq('never applies to production', guardApplies({ VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_REF: 'main' }), false);
eq('never applies to production even on a branch named staging', guardApplies({ VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_REF: 'staging' }), false);
eq('does not apply locally (no Vercel vars)', guardApplies({}), false);
eq('does not apply in GitHub Actions (no Vercel vars)', guardApplies({ CI: 'true', GITHUB_REF_NAME: 'staging' }), false);

console.log('\n── guard: fails the build when the URL is wrong ──');
throws(
  'staging preview with STAGING_SUPABASE_URL pointing at the pilot project',
  () => resolveSupabaseBuildEnv({ VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'staging', ...pilotPublic, STAGING_SUPABASE_URL: PILOT_URL, STAGING_SUPABASE_PUBLISHABLE_KEY: 'x' }),
  ['Refusing to build', STAGING_PROJECT_REF, 'STAGING_SUPABASE_URL', PILOT_URL]
);
throws(
  'staging preview with STAGING_SUPABASE_URL missing (pilot NEXT_PUBLIC_* must NOT be used as a fallback)',
  () => resolveSupabaseBuildEnv({ VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'staging', ...pilotPublic }),
  ['Refusing to build', 'STAGING_SUPABASE_URL', '(not set)']
);
throws(
  'feature-branch preview still on the pilot NEXT_PUBLIC_SUPABASE_URL',
  () => resolveSupabaseBuildEnv({ VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'feat/thing', ...pilotPublic, ...stagingVars }),
  ['Refusing to build', 'NEXT_PUBLIC_SUPABASE_URL', PILOT_URL]
);
throws(
  'preview with no Supabase URL at all',
  () => resolveSupabaseBuildEnv({ VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'feat/thing' }),
  ['Refusing to build', '(not set)']
);
throws(
  'staging branch, VERCEL_ENV unset, pointing at the pilot',
  () => resolveSupabaseBuildEnv({ VERCEL_GIT_COMMIT_REF: 'staging', ...pilotPublic }),
  ['Refusing to build', PILOT_URL]
);
throws(
  'message tells Korey where to fix it',
  () => resolveSupabaseBuildEnv({ VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'staging', ...pilotPublic }),
  ['Environment Variables', 'docs/NEEDS_KOREY.md']
);

console.log('\n── guard: passes when the URL is right, never runs in production ──');
eq('staging preview on the staging project builds', resolveSupabaseBuildEnv({ VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'staging', ...pilotPublic, ...stagingVars }).url, STAGING_URL);
eq('feature-branch preview whose NEXT_PUBLIC_SUPABASE_URL is the staging project builds', resolveSupabaseBuildEnv({ VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'feat/thing', NEXT_PUBLIC_SUPABASE_URL: STAGING_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: 'k' }).url, STAGING_URL);
eq('production on the production project builds (guard off)', resolveSupabaseBuildEnv({ VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_REF: 'main', NEXT_PUBLIC_SUPABASE_URL: PROD_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: 'k' }).url, PROD_URL);
eq('production with no Supabase URL at all still builds (guard off, as today)', resolveSupabaseBuildEnv({ VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_REF: 'main' }).url, undefined);
eq('local with the pilot URL builds (guard off, as today)', resolveSupabaseBuildEnv({ ...pilotPublic }).url, PILOT_URL);

console.log(`\n${fail === 0 ? 'ALL PASS' : `${fail} FAILED`}`);
process.exit(fail === 0 ? 0 : 1);
