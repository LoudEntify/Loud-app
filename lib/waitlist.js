// lib/waitlist.js
// ─────────────────────────────────────────────────────────────
// Shared constants and validation for the pre-launch waitlist, used by
// BOTH the client form (components/Waitlist.jsx) and the server route
// (app/api/waitlist/route.js). Keeping them in one place means the
// browser and the server agree on the rules, and the server never trusts
// the browser's copy -- it re-runs every check here itself.
//
// PRD: Accounts & Identity (pre-launch recruitment)
// S&I: Database, Rate limiting, Auth
// ─────────────────────────────────────────────────────────────

import { GENRES } from './genres';

export const ROLES = ['artist', 'viewer'];

// The consent record is versioned so that, if the notice ever changes,
// every stored row says exactly which wording that person agreed to.
// Bump this string whenever CONSENT_NOTICE below changes.
export const CONSENT_VERSION = '2026-11-06.v1';

// The exact wording shown next to the tick box. Stored by version, and
// reproduced here so the server can record which text was in force.
export const CONSENT_NOTICE =
  'I agree that Loudentify (a business in formation) may store the details ' +
  'I provide and contact me by email about its January 2027 launch and ' +
  'waitlist. I understand my details are kept private, are never shown ' +
  'publicly, and that I can withdraw at any time by replying to any email ' +
  'or contacting privacy@loudentify.app. Lawful basis: consent (UK GDPR).';

export const MAX = {
  email: 254, // RFC 5321 maximum
  name: 80,
  city: 80,
};

// Deliberately strict-but-simple. Not a full RFC validator (those reject
// valid addresses and accept invalid ones); this rejects the obviously
// malformed and caps length, and a real address is confirmed by the
// launch email actually arriving, not by a regex.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normaliseEmail(value) {
  return String(value || '').trim().toLowerCase();
}

export function isValidEmail(value) {
  const v = normaliseEmail(value);
  return v.length > 0 && v.length <= MAX.email && EMAIL_RE.test(v);
}

export function boundedString(value, max) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
}

export function isValidGenre(value) {
  return typeof value === 'string' && GENRES.includes(value);
}

// Validates and NORMALISES a submission. Returns { ok, row, error }.
// `row` is the exact, cleaned shape to store -- the route never writes
// anything the browser sent, only what this function returns.
export function validateSignup(input = {}) {
  const role = typeof input.role === 'string' ? input.role.trim() : '';
  if (!ROLES.includes(role)) return { ok: false, error: 'Choose artist or viewer.' };

  if (!isValidEmail(input.email)) return { ok: false, error: 'Enter a valid email address.' };
  const email = normaliseEmail(input.email);

  const name = boundedString(input.name, MAX.name);
  if (!name) return { ok: false, error: 'Enter your name.' };

  // Consent is mandatory and must be an explicit true. A missing or
  // falsey consent is a hard refusal -- no row is ever stored without it.
  if (input.consent !== true) return { ok: false, error: 'Please tick the consent box to continue.' };

  const row = {
    role,
    email,
    name,
    city: null,
    genre: null,
    consent: true,
    consent_version: CONSENT_VERSION,
    source: boundedString(input.source || 'landing', 40),
  };

  // City and genre are collected for artists only (they are what make the
  // waitlist useful as evidence: named, by city and by genre). A viewer
  // row carries neither.
  if (role === 'artist') {
    const city = boundedString(input.city, MAX.city);
    if (!city) return { ok: false, error: 'Enter your city.' };
    row.city = city;

    if (!isValidGenre(input.genre)) return { ok: false, error: 'Choose a genre from the list.' };
    row.genre = input.genre;
  }

  return { ok: true, row };
}
