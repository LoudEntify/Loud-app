// lib/supabaseBuildEnv.cjs
// ─────────────────────────────────────────────────────────────
// Build-time Supabase environment resolution for next.config.js.
//
// Why this exists: Vercel refuses to store NEXT_PUBLIC_* variables as
// secrets, and the frozen pilot's NEXT_PUBLIC_SUPABASE_URL /
// NEXT_PUBLIC_SUPABASE_ANON_KEY still apply to every Preview deploy.
// The staging deploy (Vercel Preview, git branch `staging`) carries its
// own branch-scoped Preview variables instead:
//
//   STAGING_SUPABASE_URL              -> becomes NEXT_PUBLIC_SUPABASE_URL
//   STAGING_SUPABASE_PUBLISHABLE_KEY  -> becomes NEXT_PUBLIC_SUPABASE_ANON_KEY
//
// Those must win over the pilot values on that one deploy, and ONLY on
// that one deploy. Production, local `next dev`/`next build`, GitHub
// Actions CI and every other preview branch see exactly the behaviour
// they had before this file existed: no `env` override at all.
//
// Guard: on any Vercel Preview build, or any build of the `staging`
// branch, the resolved Supabase URL must point at the staging project
// (ref htepkxumrwtpbkahdric) or the build fails loudly. The guard never
// runs for VERCEL_ENV=production. It also never runs where Vercel's
// system variables are absent (local, CI), because it cannot tell
// which environment it is in there.
//
// This is plain CommonJS (no `import`), because next.config.js is
// CommonJS and is executed by Node directly, before any transpiling.
// Deliberately pure: everything comes from the `env` argument so the
// tests in scripts/supabase-env-tests.mjs can exercise every path
// without touching process.env.
//
// PRD Scaling & Infrastructure: Stateless hosting, Database
// ─────────────────────────────────────────────────────────────

const STAGING_PROJECT_REF = 'htepkxumrwtpbkahdric';

/**
 * Is this build the Vercel Preview deploy of the `staging` branch?
 * Only then do the STAGING_* variables override the NEXT_PUBLIC_* ones.
 */
function isStagingPreviewBuild(env) {
  return env.VERCEL_ENV === 'preview' && env.VERCEL_GIT_COMMIT_REF === 'staging';
}

/**
 * Should the "must be the staging project" guard run for this build?
 * Any Vercel Preview, or any build of the `staging` branch -- but never
 * production, which has its own project and its own keys.
 */
function guardApplies(env) {
  if (env.VERCEL_ENV === 'production') return false;
  return env.VERCEL_ENV === 'preview' || env.VERCEL_GIT_COMMIT_REF === 'staging';
}

/**
 * Resolve the Supabase URL + anon key this build should use.
 *
 * Returns { override, url, anonKey, env }:
 *   override  true only for the staging Preview build
 *   url       the URL the build will use (after any override)
 *   anonKey   the anon/publishable key the build will use
 *   env       the object to spread into next.config's `env` key --
 *             {} when nothing is overridden, so the config stays
 *             byte-for-byte what it was before in every other case
 *
 * Throws (and therefore fails `next build`) when the guard applies and
 * the resolved URL is not the staging project.
 */
function resolveSupabaseBuildEnv(env = process.env) {
  const override = isStagingPreviewBuild(env);

  const url = override ? env.STAGING_SUPABASE_URL : env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = override ? env.STAGING_SUPABASE_PUBLISHABLE_KEY : env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (guardApplies(env) && !String(url || '').includes(STAGING_PROJECT_REF)) {
    const source = override ? 'STAGING_SUPABASE_URL' : 'NEXT_PUBLIC_SUPABASE_URL';
    const shown = url ? `"${url}"` : '(not set)';
    throw new Error(
      `[supabaseBuildEnv] Refusing to build: this is a ${describeBuild(env)} build, ` +
        `so the Supabase URL must be the staging project (ref ${STAGING_PROJECT_REF}), ` +
        `but ${source} resolved to ${shown}. ` +
        'Staging previews must never point at the pilot or production project. ' +
        'Fix: in Vercel -> Project Settings -> Environment Variables, make sure ' +
        'STAGING_SUPABASE_URL and STAGING_SUPABASE_PUBLISHABLE_KEY exist for the ' +
        'Preview environment, scoped to the `staging` branch, and that ' +
        '"Automatically expose System Environment Variables" is on. ' +
        'See docs/NEEDS_KOREY.md.'
    );
  }

  const configEnv = override
    ? { NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey }
    : {};

  return { override, url, anonKey, env: configEnv };
}

function describeBuild(env) {
  const parts = [];
  if (env.VERCEL_ENV) parts.push(`VERCEL_ENV=${env.VERCEL_ENV}`);
  if (env.VERCEL_GIT_COMMIT_REF) parts.push(`branch=${env.VERCEL_GIT_COMMIT_REF}`);
  return parts.length ? parts.join(', ') : 'Vercel';
}

module.exports = {
  STAGING_PROJECT_REF,
  isStagingPreviewBuild,
  guardApplies,
  resolveSupabaseBuildEnv,
};
