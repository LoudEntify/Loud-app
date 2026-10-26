// lib/passwordReset.js — the rules behind "forgot password", kept away
// from the screens so both the web and the native app obey the same ones
// and so they can be tested without a browser.
//
// The one judgement worth stating: the answer to "send me a link" is the
// same whether or not that email has an account. Telling a stranger which
// addresses are registered hands them a list of our users, and a person
// who mistypes their own address is no worse off for the vaguer wording.
//
// PRD: sign-up and account. S&I: Auth.

export const MIN_PASSWORD = 8;            // matches lib/signupRules.js
export const RESET_LINK_VALID_MINUTES = 60;

/** Is this something we can send a link to? Deliberately loose: the mail server is the real judge. */
export function validateResetRequest(email) {
  const address = String(email ?? '').trim();
  if (!address) return { ok: false, error: 'Type the email you signed up with.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) return { ok: false, error: 'That does not look like an email address.' };
  return { ok: true, email: address.toLowerCase(), error: null };
}

/** What the screen says once a link has been asked for: never whether the account exists. */
export const RESET_SENT_MESSAGE = `If that email has an account, the link is on its way. It works for one hour.`;

/** The new password, and the second box that catches a typo before it locks someone out. */
export function validateNewPassword(password, confirm) {
  const p = String(password ?? '');
  if (p.length < MIN_PASSWORD) return { ok: false, error: `Use at least ${MIN_PASSWORD} characters.` };
  if (confirm !== undefined && p !== String(confirm ?? '')) return { ok: false, error: 'The two passwords do not match.' };
  return { ok: true, error: null };
}

/**
 * Turn whatever came back from the auth provider into one line a person can
 * act on. An unknown error keeps its own words rather than being flattened,
 * because a reset that fails silently is worse than a clumsy sentence.
 */
export function resetErrorMessage(error) {
  const text = String(error?.message || error || '');
  if (!text) return null;
  if (/expired|invalid|not found|token/i.test(text)) return 'That link has expired. Ask for a new one and it will land in a moment.';
  if (/same.*password|should be different/i.test(text)) return 'That is already your password. Choose a different one.';
  if (/rate|too many/i.test(text)) return 'Too many tries just now. Wait a minute and ask again.';
  return text;
}

/** Where the emailed link should come back to, given the site's own origin. */
export const resetRedirectTo = (origin) => (origin ? `${String(origin).replace(/\/$/, '')}/reset-password` : undefined);
