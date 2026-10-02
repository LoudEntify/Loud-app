const { resolveSupabaseBuildEnv } = require('./lib/supabaseBuildEnv.cjs');

// Staging deploys on Vercel (Preview, branch `staging`) get their Supabase
// URL/anon key from the branch-scoped STAGING_SUPABASE_URL /
// STAGING_SUPABASE_PUBLISHABLE_KEY variables, overriding the pilot's
// NEXT_PUBLIC_* values that Vercel also applies to Preview. Everywhere
// else `supabase.env` is {} and the config is exactly what it was before.
// This throws -- failing the build on purpose -- if a preview or staging
// build would point anywhere but the staging project. See
// lib/supabaseBuildEnv.cjs.
const supabase = resolveSupabaseBuildEnv(process.env);

if (supabase.override) {
  // Keep the build process's own environment consistent with what the
  // bundles will be compiled against, so anything that reads process.env
  // during the build (route handlers evaluated at build time, scripts
  // run with the same env) sees the staging values too.
  process.env.NEXT_PUBLIC_SUPABASE_URL = supabase.url;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = supabase.anonKey;
  console.log(
    `[next.config] staging preview build: NEXT_PUBLIC_SUPABASE_URL/ANON_KEY taken from STAGING_SUPABASE_URL/STAGING_SUPABASE_PUBLISHABLE_KEY (${supabase.url})`
  );
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    optimizePackageImports: ['@phosphor-icons/react'],
  },
  ...(supabase.override ? { env: supabase.env } : {}),
};

module.exports = nextConfig;
