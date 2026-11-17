
/**
 * Loudentify — Waitlist Utilities
 * Shared validation and consent text.
 */

import { GENRES } from './genres';

// Increment whenever the consent wording materially changes.
export const CONSENT_VERSION = 'waitlist-2026-11-09-v1';

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

export function validateSignup(payload) {
  const fail = (error) => ({ ok: false, error });
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return fail('Invalid request.');
  }
  if (!['artist', 'viewer'].includes(payload.role)) {
    return fail('Please choose artist or viewer.');
  }
  if (!isValidEmail(payload.email)) return fail('Please enter a valid email address.');
  const name = typeof payload.name === 'string' ? payload.name.trim() : '';
  if (!name || name.length > 120) return fail('Please enter a name of up to 120 characters.');
  if (payload.ageConfirmed !== true) return fail('Please confirm that you are 18 or over.');
  if (payload.consent !== true) return fail('Please agree to receive early access and launch updates.');
  if (payload.consentVersion !== CONSENT_VERSION) {
    return fail('Please refresh this page and review the current consent notice.');
  }
  const artist = payload.role === 'artist';
  const city = typeof payload.city === 'string' ? payload.city.trim() : '';
  if (artist && (!city || city.length > 120)) {
    return fail('Please enter a city of up to 120 characters.');
  }
  if (artist && !GENRES.includes(payload.genre)) return fail('Please choose a genre.');
  return {
    ok: true,
    row: {
      role: payload.role,
      email: payload.email.trim().toLowerCase(),
      name,
      city: artist ? city : null,
      genre: artist ? payload.genre : null,
      consent: true,
      consent_version: CONSENT_VERSION,
      consent_at: new Date().toISOString(),
      source: 'landing',
    },
  };
}
