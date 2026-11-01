// lib/siteUrl.js — where this deployment lives, as one answer.
//
// Four places needed the site's own address and each read
// NEXT_PUBLIC_SITE_URL, which Vercel rightly flags: the NEXT_PUBLIC_ prefix
// ships a value to the browser, and every one of these reads happens on the
// server (a route handler and two server components). The address is not a
// secret — it is in the address bar — but a prefix that promises the browser
// something nothing in the browser uses is just a misleading label.
//
// So the private `SITE_URL` wins, and the public one is still read so a
// deployment that has only the old variable keeps working. Both unset falls
// back to production, which is what every one of these callers did before.
const PRODUCTION = 'https://loudentify.app';

/** The origin this deployment serves from, with no trailing slash. */
export function siteUrl() {
  const raw = process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || PRODUCTION;
  return String(raw).trim().replace(/\/+$/, '');
}

/**
 * The same answer, but empty when neither variable is set.
 *
 * The YouTube redirect needs this distinction: with no site URL configured
 * it falls back to the request's own origin, which is what local
 * development wants. Falling back to production there would send a
 * developer's consent screen to the live site.
 */
export function siteUrlIfSet() {
  const raw = process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || '';
  return String(raw).trim().replace(/\/+$/, '');
}
