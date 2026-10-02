// Unit tests for lib/supabaseBuildEnv.cjs, the build-time Supabase
// environment resolution used by next.config.js. No Vercel, no network,
// no process.env: every case passes its own env object in.
//
// Two things are under test:
//   1. the override: STAGING_* wins over NEXT_PUBLIC_* only on the Vercel
//      Preview build of the `staging` branch, and nowhere else;
//   2. the guard: preview or staging builds that would point anywhere but
//      the staging project fail loudly; production never guards.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { resolveSupabaseBuildEnv, isStagingPreviewBuild, guardApplies, STAGING_PROJECT_REF } from '../lib/supabaseBuildEnv.cjs';

const STAGING_URL = `https://${STAGING_PROJECT_REF}.supabase.co`;
const STAGING_KEY = 'sb_publishable_staging_key';
const PILOT_URL = 'https://pilotpilotpilotpilot.supabase.co';
const PILOT_KEY = 'pilot-anon-key';
const PROD_URL = 'https://prodprodprodprodprod.supabase.co';

// The pilot's NEXT_PUBLIC_* values, which Vercel applies to every Preview.
const pilotPublic = { NEXT_PUBLIC_SUPABASE_URL: PILOT_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: PILOT_KEY };
// The branch-scoped staging Preview variables.
const stagingVars = { STAGING_SUPABASE_URL: STAGING_URL, STAGING_SUPABASE_PUBLISHABLE_KEY: STAGING_KEY };
const stagingPreview = { VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'staging' };

describe('override: the staging preview takes STAGING_* over the pilot NEXT_PUBLIC_*', () => {
  test('STAGING_SUPABASE_URL / STAGING_SUPABASE_PUBLISHABLE_KEY become the NEXT_PUBLIC_* env', () => {
    const env = { ...stagingPreview, ...pilotPublic, ...stagingVars };
    const r = resolveSupabaseBuildEnv(env);
    assert.equal(isStagingPreviewBuild(env), true);
    assert.equal(r.override, true);
    assert.equal(r.url, STAGING_URL);
    assert.equal(r.anonKey, STAGING_KEY);
    assert.deepEqual(r.env, { NEXT_PUBLIC_SUPABASE_URL: STAGING_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: STAGING_KEY });
  });

  test('the input env object is not mutated', () => {
    const env = { ...stagingPreview, ...pilotPublic, ...stagingVars };
    resolveSupabaseBuildEnv(env);
    assert.equal(env.NEXT_PUBLIC_SUPABASE_URL, PILOT_URL);
    assert.equal(env.NEXT_PUBLIC_SUPABASE_ANON_KEY, PILOT_KEY);
  });

  test('works with no NEXT_PUBLIC_* set at all', () => {
    const r = resolveSupabaseBuildEnv({ ...stagingPreview, ...stagingVars });
    assert.equal(r.env.NEXT_PUBLIC_SUPABASE_URL, STAGING_URL);
    assert.equal(r.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, STAGING_KEY);
  });
});

describe('no override anywhere else: behaviour exactly as today', () => {
  const untouched = (name, env) => {
    test(name, () => {
      const r = resolveSupabaseBuildEnv(env);
      assert.equal(r.override, false);
      assert.deepEqual(r.env, {});
      assert.equal(r.url, env.NEXT_PUBLIC_SUPABASE_URL);
      assert.equal(r.anonKey, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    });
  };
  untouched('production, even with STAGING_* present', { VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_REF: 'main', NEXT_PUBLIC_SUPABASE_URL: PROD_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: 'prod-key', ...stagingVars });
  untouched('local (no Vercel vars), even with STAGING_* present', { ...pilotPublic, ...stagingVars });
  untouched('local with nothing set at all', {});
  untouched('GitHub Actions on the staging branch (no Vercel vars, no Supabase vars)', { CI: 'true', GITHUB_REF_NAME: 'staging' });
  untouched('another preview branch', { VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'feat/thing', NEXT_PUBLIC_SUPABASE_URL: STAGING_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: 'k', ...stagingVars });
  untouched('VERCEL_ENV=development on the staging branch', { VERCEL_ENV: 'development', VERCEL_GIT_COMMIT_REF: 'staging', NEXT_PUBLIC_SUPABASE_URL: STAGING_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: 'k', ...stagingVars });

  test('isStagingPreviewBuild needs both preview AND the staging branch', () => {
    assert.equal(isStagingPreviewBuild({ VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'feat/thing' }), false);
    assert.equal(isStagingPreviewBuild({ VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_REF: 'staging' }), false);
    assert.equal(isStagingPreviewBuild({ VERCEL_GIT_COMMIT_REF: 'staging' }), false);
    assert.equal(isStagingPreviewBuild({}), false);
  });
});

describe('guard: when it applies', () => {
  test('any Vercel preview, or any staging-branch build', () => {
    assert.equal(guardApplies(stagingPreview), true);
    assert.equal(guardApplies({ VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'feat/thing' }), true);
    assert.equal(guardApplies({ VERCEL_ENV: 'development', VERCEL_GIT_COMMIT_REF: 'staging' }), true);
    assert.equal(guardApplies({ VERCEL_GIT_COMMIT_REF: 'staging' }), true);
  });
  test('never in production, even on a branch named staging', () => {
    assert.equal(guardApplies({ VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_REF: 'main' }), false);
    assert.equal(guardApplies({ VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_REF: 'staging' }), false);
  });
  test('not locally or in GitHub Actions (no Vercel vars)', () => {
    assert.equal(guardApplies({}), false);
    assert.equal(guardApplies({ CI: 'true', GITHUB_REF_NAME: 'staging' }), false);
  });
});

describe('guard: fails the build when the resolved URL is not the staging project', () => {
  const refuses = (name, env, mustMention) => {
    test(name, () => {
      assert.throws(() => resolveSupabaseBuildEnv(env), (err) => {
        assert.match(err.message, /Refusing to build/);
        assert.match(err.message, new RegExp(STAGING_PROJECT_REF));
        for (const s of mustMention) assert.ok(err.message.includes(s), `message should mention ${JSON.stringify(s)}: ${err.message}`);
        return true;
      });
    });
  };
  refuses('staging preview with STAGING_SUPABASE_URL pointing at the pilot', { ...stagingPreview, ...pilotPublic, STAGING_SUPABASE_URL: PILOT_URL, STAGING_SUPABASE_PUBLISHABLE_KEY: 'x' }, ['STAGING_SUPABASE_URL', PILOT_URL]);
  refuses('staging preview with STAGING_SUPABASE_URL missing: the pilot NEXT_PUBLIC_* is NOT used as a fallback', { ...stagingPreview, ...pilotPublic }, ['STAGING_SUPABASE_URL', '(not set)']);
  refuses('feature-branch preview still on the pilot NEXT_PUBLIC_SUPABASE_URL', { VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'feat/thing', ...pilotPublic, ...stagingVars }, ['NEXT_PUBLIC_SUPABASE_URL', PILOT_URL]);
  refuses('preview with no Supabase URL at all', { VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'feat/thing' }, ['(not set)']);
  refuses('staging branch with VERCEL_ENV unset, pointing at the pilot', { VERCEL_GIT_COMMIT_REF: 'staging', ...pilotPublic }, [PILOT_URL]);
  refuses('the message says where on Vercel to fix it', { ...stagingPreview, ...pilotPublic }, ['Environment Variables', 'docs/NEEDS_KOREY.md']);
});

describe('guard: passes when the URL is right, and never runs in production', () => {
  test('staging preview on the staging project builds', () => {
    assert.equal(resolveSupabaseBuildEnv({ ...stagingPreview, ...pilotPublic, ...stagingVars }).url, STAGING_URL);
  });
  test('feature-branch preview whose NEXT_PUBLIC_SUPABASE_URL is the staging project builds', () => {
    assert.equal(resolveSupabaseBuildEnv({ VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'feat/thing', NEXT_PUBLIC_SUPABASE_URL: STAGING_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: 'k' }).url, STAGING_URL);
  });
  test('production on the production project builds', () => {
    assert.equal(resolveSupabaseBuildEnv({ VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_REF: 'main', NEXT_PUBLIC_SUPABASE_URL: PROD_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: 'k' }).url, PROD_URL);
  });
  test('production with no Supabase URL at all still builds, as today', () => {
    assert.equal(resolveSupabaseBuildEnv({ VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_REF: 'main' }).url, undefined);
  });
  test('local with the pilot URL builds, as today', () => {
    assert.equal(resolveSupabaseBuildEnv({ ...pilotPublic }).url, PILOT_URL);
  });
});
