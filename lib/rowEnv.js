// lib/rowEnv.js
// ─────────────────────────────────────────────────────────────
// Which deployment wrote this row.
//
// PRD: — · S&I: Database, Observability
// ─────────────────────────────────────────────────────────────
//
// Production and preview share one Supabase project, on purpose: two
// databases means every migration runs twice and they drift the first
// time one run is skipped. So a device test on a preview URL writes real
// rows into real pilot tables, and the 21st's analysis has to be able to
// tell them apart.
//
// One column, `env`, on every pilot table (docs/pilot2_env_stamp.sql).
// This is the only place its value is produced. Building the string by
// hand at a call site is the one way this breaks: the column has no
// CHECK constraint — a live-show write must never fail over a metadata
// label — so a stray value is stored happily and then silently excluded
// from the pilot's numbers.

// Vercel sets VERCEL_ENV to exactly one of these on every deployment.
// Absent means a local `next dev`, which is development.
const KNOWN = new Set(['production', 'preview', 'development']);

/**
 * The value to write into a pilot table's `env` column.
 *
 * Normalised rather than passed through. VERCEL_ENV is Vercel's to
 * change, and an unrecognised value would land in the database as a
 * label nothing filters on — so anything unexpected is reported as
 * 'development', which is the honest answer ("not a deployment we
 * recognise") and keeps the row out of the pilot's counts.
 *
 * Note the asymmetry this preserves. The column defaults to
 * 'production', so a write path that forgets to call this counts as
 * real; a write path that calls it can only ever be excluded on
 * purpose. Inflated numbers are recoverable, lost ones are not.
 */
export function rowEnv() {
  const v = process.env.VERCEL_ENV;
  if (v && KNOWN.has(v)) return v;
  return 'development';
}

/**
 * Convenience for the common shape: spread into a row literal.
 *
 *   await admin.from('viewer_sessions').insert({ ...envStamp(), show_id, viewer_id });
 *
 * Exists so the stamp is one token at the call site. A stamp that is
 * tedious to add is a stamp somebody leaves out of the sixth write path.
 */
export function envStamp() {
  return { env: rowEnv() };
}

/**
 * True on the real production deployment.
 *
 * For guards that are about the DEPLOYMENT, not about a row — e.g.
 * refusing to run a destructive sweep from a preview. Deliberately a
 * separate export from rowEnv() so that reading a call site tells you
 * which of the two questions is being asked.
 */
export function isProductionDeployment() {
  return rowEnv() === 'production';
}
