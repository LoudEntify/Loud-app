'use client';

// lib/scheduling.js
// ─────────────────────────────────────────────────────────────
// Show scheduling + the BROADCAST WINDOW rule.
//
// The rule, stated once: LiveKit is touched ONLY between the window
// opening and the show ending. Outside it the artist's whole rig runs
// locally (Kit Check) with no token minted and no connection made. That
// is a cost decision as much as a product one -- LiveKit bills on
// connected participants and published minutes, so an artist warming up
// for an hour should cost nothing.
//
// Everything here is pure functions over a `show` row plus a clock, so
// it can be unit-reasoned and reused by the dashboard, the countdown
// overlay and Kit Check without any of them re-deriving the rule.
// ─────────────────────────────────────────────────────────────

import { getSupabase } from './supabaseClient';

// How early the window opens. Matches SOUNDCHECK_WINDOW_MS in
// lib/showState.js deliberately -- two different numbers for "how early
// can I start" would be a bug generator.
export const WINDOW_OPENS_BEFORE_MS = 30 * 60 * 1000;

// How long after the slated time the window stays open if the artist
// never explicitly ends the show. A window that never shuts is a
// LiveKit bill that never stops.
export const DEFAULT_WINDOW_LENGTH_MS = 3 * 60 * 60 * 1000;

// Reminder offsets, in minutes before the slated time.
export const REMINDER_OFFSETS_MIN = [24 * 60, 4 * 60, 60, 30];

export function windowOpensAt(show) {
  if (!show?.slated_at) return null;
  return new Date(show.slated_at).getTime() - WINDOW_OPENS_BEFORE_MS;
}

export function windowClosesAt(show) {
  if (!show?.slated_at) return null;
  if (show.ends_at) return new Date(show.ends_at).getTime();
  return new Date(show.slated_at).getTime() + DEFAULT_WINDOW_LENGTH_MS;
}

/**
 * Is this show's broadcast window open right now? This is the ONLY
 * question that should gate a LiveKit connection.
 */
export function isWindowOpen(show, now = Date.now()) {
  if (!show || show.state === 'ended') return false;
  const opens = windowOpensAt(show);
  const closes = windowClosesAt(show);
  if (opens === null) return false;
  return now >= opens && now < closes;
}

/** The next show whose window has not already closed. */
export function nextUpcomingShow(shows, now = Date.now()) {
  return (shows || [])
    .filter((s) => s.state !== 'ended' && windowClosesAt(s) > now)
    .sort((a, b) => new Date(a.slated_at) - new Date(b.slated_at))[0] || null;
}

export function msUntilWindow(show, now = Date.now()) {
  const opens = windowOpensAt(show);
  return opens === null ? null : opens - now;
}

/** "in 2h 14m" / "in 3 days" / "now" — for dashboard copy. */
export function humanCountdown(ms) {
  if (ms === null) return '';
  if (ms <= 0) return 'now';
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `in ${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `in ${hours}h ${mins % 60}m`;
  const days = Math.floor(hours / 24);
  return `in ${days} day${days === 1 ? '' : 's'}`;
}

/**
 * Generate any show reminders that are now DUE and not yet recorded.
 *
 * There is no cron in this stack and no server job runner, so reminders
 * are generated lazily by the owner's own session whenever they open the
 * app. The consequence is honest and worth knowing: a reminder appears
 * the next time the artist opens Loudentify after it becomes due, not at
 * the exact minute. The dedupe_key unique index is what makes running
 * this on every page load safe.
 *
 * Push/email delivery is NOT wired -- see DECISIONS.md.
 */
export async function syncShowReminders(userId, shows, now = Date.now()) {
  if (!userId || !shows?.length) return { inserted: 0 };

  const rows = [];
  for (const show of shows) {
    if (show.state === 'ended') continue;
    const slated = new Date(show.slated_at).getTime();
    if (Number.isNaN(slated)) continue;

    for (const offset of REMINDER_OFFSETS_MIN) {
      const dueAt = slated - offset * 60000;
      // Due, and the show hasn't already started.
      if (now < dueAt || now >= slated) continue;
      rows.push({
        user_id: userId,
        kind: 'show_reminder',
        body: `${labelFor(offset)} until ${show.title || 'your show'}.`,
        href: '/dashboard',
        dedupe_key: `show:${show.id}:reminder:${offset}`,
      });
    }
  }

  if (!rows.length) return { inserted: 0 };

  // upsert with ignoreDuplicates: re-running this is the normal case,
  // not an error case.
  const { error } = await getSupabase()
    .from('notifications')
    .upsert(rows, { onConflict: 'user_id,dedupe_key', ignoreDuplicates: true });

  return { inserted: error ? 0 : rows.length, error };
}

function labelFor(offsetMin) {
  if (offsetMin >= 1440) return `${offsetMin / 1440} day`;
  if (offsetMin >= 60) return `${offsetMin / 60} hours`;
  return `${offsetMin} minutes`;
}
