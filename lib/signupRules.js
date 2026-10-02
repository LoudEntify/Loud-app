// lib/signupRules.js
// ─────────────────────────────────────────────────────────────
// Sign-up validation shared by the sheet (client) and the route (server).
//
// PRD rows 91, 92: one page; Apple, Google or email; watch or perform;
// name; username or stage name; date of birth; location; Terms accepted in
// one line. "Date of birth is the gate. Under-18s see a kind stop screen
// and the date of birth is not stored."
//
// No DOM, no network: tests/signup.test.mjs covers the edges (leap days,
// the birthday itself, a date in the future, a 2-digit year).
// ─────────────────────────────────────────────────────────────

export const MIN_AGE = 18;
export const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;
export const ROLES = ['viewer', 'artist'];
export const TERMS_VERSION = '2026-10-draft';

export function normaliseUsername(raw) {
  return String(raw || '').trim().toLowerCase().replace(/^@/, '');
}

export function validateUsername(raw) {
  const u = normaliseUsername(raw);
  if (!u) return 'Pick a username.';
  if (!USERNAME_PATTERN.test(u)) return '3 to 20 characters: lowercase letters, numbers and underscores.';
  return null;
}

/** "DD / MM / YYYY", "DD/MM/YYYY", "YYYY-MM-DD" -> ISO date string, or null. */
export function parseDateOfBirth(raw) {
  const s = String(raw || '').trim();
  let y, m, d;
  let mm = s.match(/^(\d{1,2})\s*[\/.\-\s]\s*(\d{1,2})\s*[\/.\-\s]\s*(\d{4})$/);
  if (mm) { d = +mm[1]; m = +mm[2]; y = +mm[3]; }
  else {
    mm = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!mm) return null;
    y = +mm[1]; m = +mm[2]; d = +mm[3];
  }
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

/** Age in whole years on `today` (ISO date or Date). */
export function ageOn(isoDob, today = new Date()) {
  const t = typeof today === 'string' ? new Date(today + 'T00:00:00Z') : today;
  const [y, m, d] = isoDob.split('-').map(Number);
  let age = t.getUTCFullYear() - y;
  const beforeBirthday = t.getUTCMonth() + 1 < m || (t.getUTCMonth() + 1 === m && t.getUTCDate() < d);
  if (beforeBirthday) age -= 1;
  return age;
}

/**
 * Validate the whole form. Returns { ok, errors, values }.
 * `values.dateOfBirth` is only present when the person is 18 or over — an
 * under-18 date never leaves this function, so it can never be stored.
 */
export function validateSignup(input, { today = new Date() } = {}) {
  const errors = {};
  const role = ROLES.includes(input.role) ? input.role : null;
  if (!role) errors.role = 'Choose watch or perform.';
  const firstName = String(input.firstName || '').trim();
  const lastName = String(input.lastName || '').trim();
  if (!firstName) errors.firstName = 'Your first name.';
  if (firstName.length > 60 || lastName.length > 60) errors.name = 'That name is too long.';
  const uErr = validateUsername(input.username);
  if (uErr) errors.username = uErr;
  const email = String(input.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = 'A real email address.';
  const password = String(input.password || '');
  if (password.length < 8) errors.password = 'At least 8 characters.';
  const dob = parseDateOfBirth(input.dateOfBirth);
  let underage = false;
  if (!dob) errors.dateOfBirth = 'Date of birth as DD / MM / YYYY.';
  else {
    const age = ageOn(dob, today);
    if (age < 0 || age > 120) errors.dateOfBirth = 'That date cannot be right.';
    else if (age < MIN_AGE) underage = true;
  }
  const country = String(input.country || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) errors.country = 'Pick a country.';
  const city = String(input.city || '').trim().slice(0, 80);
  if (!input.acceptTerms) errors.acceptTerms = 'You need to accept the Terms and Community Guidelines.';
  const ok = Object.keys(errors).length === 0 && !underage;
  const values = ok ? {
    role, firstName, lastName, fullName: `${firstName} ${lastName}`.trim(),
    username: normaliseUsername(input.username), email, password, dateOfBirth: dob, country, city: city || null,
    displayName: role === 'artist' ? String(input.stageName || firstName).trim().slice(0, 60) : firstName,
    trainingDataOptOut: role === 'artist' ? Boolean(input.trainingDataOptOut) : null,
  } : null;
  return { ok, underage, errors, values };
}
