
/**
 * Loudentify — Waitlist Utilities
 * Shared validation and consent text.
 */

export const CONSENT_NOTICE =
  "By joining the waitlist, you agree to receive updates about Loudentify, including early access and launch announcements. You can unsubscribe at any time.";

export function isValidEmail(email) {
  if (typeof email !== "string") {
    return false;
  }

  const normalized = email.trim();

  if (!normalized || normalized.length > 254) {
    return false;
  }

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized);
}
