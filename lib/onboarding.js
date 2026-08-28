'use client';

// lib/onboarding.js
// ─────────────────────────────────────────────────────────────
// First-run state for both roles.
//
// THREE RULES, and every design choice here follows from them:
//
//   SKIPPABLE   — every step has a way past it, and the way past is a
//                 real control with a plain label, not a small grey
//                 "maybe later" hidden in a corner. A person who does
//                 not want to upload a photo at 11pm should not have to
//                 hunt for permission to say so.
//   RESUMABLE   — progress is recorded per step, so closing the tab
//                 costs nothing. Coming back lands on the first step
//                 that is neither done nor skipped, not back at step one.
//   NEVER BLOCKING — nothing in the app is gated on finishing this.
//                 Onboarding is a route you can leave at any moment, and
//                 the prompt to come back is a dismissible line, never a
//                 modal over the thing you actually came to do.
//
// STORAGE, AND WHY IT IS BELT-AND-BRACES
// ──────────────────────────────────────
// The real store is `profiles.onboarding` (jsonb), so progress follows
// the account across devices. That column arrives with
// docs/overnight2_02_profiles.sql, which is run by hand.
//
// Until it is run, every write to it fails with PostgREST's
// unknown-column error. Rather than let that break a brand-new account's
// very first minute in the product, a failed write falls back to
// localStorage, keyed by user id. The flow is then fully usable — just
// per-device rather than per-account — and it upgrades itself silently
// the first time a write to the real column succeeds.
//
// That fallback is deliberate and is NOT a pattern to copy for anything
// that matters. It is right here precisely because onboarding progress
// is the lowest-stakes data in the product: the worst case of losing it
// is being offered a setup step twice.
// ─────────────────────────────────────────────────────────────

import { getSupabase } from './supabaseClient';

export const ONBOARDING_VERSION = 1;

// The steps, in order, per role. `key` is what gets written to the
// completed/skipped lists — never the index, so inserting a step later
// cannot silently reinterpret existing progress.
export const ARTIST_STEPS = [
  {
    key: 'identity',
    title: 'Put a face to the name',
    blurb: 'A photo, a line about what you do, and the genres you play. This is what a fan sees before they have ever heard you.',
  },
  {
    key: 'schedule',
    title: 'Pick a date for your first show',
    blurb: 'A show is a time and a title. Everything else — the room, the recording, the reminders — is built off that one decision.',
  },
  {
    key: 'kitcheck',
    title: 'Meet Kit Check',
    blurb: 'Where you set up your cameras and sound before anyone is watching, and where the show starts from.',
  },
];

export const VIEWER_STEPS = [
  {
    key: 'genres',
    title: 'What do you listen to?',
    blurb: 'Pick as many as you like. It shapes what turns up first on Discover.',
  },
  {
    key: 'follow',
    title: 'Follow a few artists',
    blurb: 'You will get a nudge when they go live, and their shows come to the top of your feed.',
  },
  {
    key: 'discover',
    title: 'That is it',
    blurb: 'Discover is where live shows and artists live. Nothing else needs setting up.',
  },
];

export function stepsFor(role) {
  return role === 'artist' ? ARTIST_STEPS : VIEWER_STEPS;
}

function emptyState(role) {
  return { v: ONBOARDING_VERSION, role: role || null, completed: [], skipped: [], done: false };
}

function localKey(userId) {
  return `loudentify.onboarding.${userId}`;
}

function readLocal(userId) {
  try {
    const raw = window.localStorage.getItem(localKey(userId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeLocal(userId, state) {
  try {
    window.localStorage.setItem(localKey(userId), JSON.stringify(state));
  } catch {
    // Private browsing, a full quota, a locked-down device. Onboarding
    // still works within this page load; it just won't be remembered.
  }
}

function isMissingColumn(error) {
  if (!error) return false;
  if (error.code === '42703' || error.code === 'PGRST204') return true;
  const msg = String(error.message || '').toLowerCase();
  return msg.includes('column') && (msg.includes('does not exist') || msg.includes('schema cache'));
}

// Once per tab: has this database got the `onboarding` column yet?
//
// Without this, EVERY page load fires a select for a column that does
// not exist and takes a 400 back. It was always handled -- the fallback
// below is the whole point -- but it is a doomed request repeated
// forever, on every navigation, for every signed-in user, because the
// nudge lives in PageShell.
//
// Found by the smoke check: the 400 shows up as a console error, which
// made the run's error count nondeterministic depending on whether the
// request landed before or after the marker appeared. A check whose
// result depends on a race is a check nobody will trust.
//
// sessionStorage, not a module variable: the answer is a property of the
// DATABASE, so it holds across navigations within a tab, and a new tab
// after the migration re-asks rather than being stuck on a stale no.
const COLUMN_MISSING_KEY = 'loudentify.onboarding.columnMissing';

function columnKnownMissing() {
  try { return window.sessionStorage.getItem(COLUMN_MISSING_KEY) === '1'; } catch { return false; }
}
function rememberColumnMissing() {
  try { window.sessionStorage.setItem(COLUMN_MISSING_KEY, '1'); } catch { /* fine */ }
}

/**
 * Current state for a user. Never throws, never returns null — an
 * unreadable store is indistinguishable from "hasn't started", which is
 * the correct thing to show.
 */
export async function loadOnboarding(userId, role) {
  if (!userId) return emptyState(role);
  if (columnKnownMissing()) return readLocal(userId) || emptyState(role);
  try {
    const { data, error } = await getSupabase()
      .from('profiles')
      .select('onboarding')
      .eq('id', userId)
      .maybeSingle();
    if (!error && data && data.onboarding && typeof data.onboarding === 'object') {
      return { ...emptyState(role), ...data.onboarding, role: data.onboarding.role || role || null };
    }
    if (error && isMissingColumn(error)) {
      rememberColumnMissing();
    } else if (error) {
      // A real failure (network, RLS) -- NOT remembered, because it can
      // clear on its own and a transient blip must not switch this to
      // local storage for the rest of the session.
      console.warn('[onboarding] profile read failed, using local progress', error.message);
    }
  } catch {
    // same
  }
  return readLocal(userId) || emptyState(role);
}

async function persist(userId, state) {
  writeLocal(userId, state); // always, so a later DB failure can't lose it
  try {
    if (columnKnownMissing()) return { persisted: false };
    const { error } = await getSupabase()
      .from('profiles')
      .update({ onboarding: state })
      .eq('id', userId);
    if (error && isMissingColumn(error)) rememberColumnMissing();
    else if (error) console.warn('[onboarding] progress not saved to the profile', error.message);
    return { persisted: !error };
  } catch {
    return { persisted: false };
  }
}

export async function markStep(userId, state, stepKey, outcome /* 'completed' | 'skipped' */) {
  const next = {
    ...emptyState(state?.role),
    ...state,
    completed: (state?.completed || []).filter((k) => k !== stepKey),
    skipped: (state?.skipped || []).filter((k) => k !== stepKey),
  };
  if (outcome === 'completed') next.completed = [...next.completed, stepKey];
  if (outcome === 'skipped') next.skipped = [...next.skipped, stepKey];
  await persist(userId, next);
  return next;
}

export async function finishOnboarding(userId, state) {
  const next = { ...emptyState(state?.role), ...state, done: true, completedAt: new Date().toISOString() };
  await persist(userId, next);
  return next;
}

/**
 * First step that is neither done nor skipped, or null when there is
 * nothing left. Resumption is this function and nothing else.
 */
export function nextStepIndex(state, steps) {
  const seen = new Set([...(state?.completed || []), ...(state?.skipped || [])]);
  const idx = steps.findIndex((s) => !seen.has(s.key));
  return idx === -1 ? null : idx;
}

/**
 * Should we be nudging this account to come back and finish?
 *
 * A skipped step is an answer, not a gap — someone who skipped the photo
 * step has told us they do not want to upload a photo, and asking again
 * is nagging. So the nudge only appears when there is a step they have
 * neither done nor deliberately passed on.
 */
export function hasUnfinishedOnboarding(state, role) {
  if (!state || state.done) return false;
  return nextStepIndex(state, stepsFor(role)) !== null;
}

export function homeFor(role, userId) {
  return role === 'artist' && userId ? `/artist/${userId}` : '/discover';
}
