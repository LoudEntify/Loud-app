'use client';

// lib/unreadCount.js
// ─────────────────────────────────────────────────────────────
// How many notifications this person has not read.
//
// PRD: Accounts & Identity (notifications)
// S&I: Database
//
// ── WHY A COUNT AND NOT A LIST ────────────────────────────────
// The badge needs a number, not fifty rows. `head: true` with an exact
// count returns the number without the payload, so a nav badge does not
// pull the entire notification history on every page load.
//
// ── ⚠️ THE BADGE AND MARK-AS-READ SHIP TOGETHER ───────────────
// Deliberately in one module, because they are one feature and shipping
// half of it is worse than shipping none.
//
// Before this, `read_at` existed on the table and nothing ever wrote to
// it — components/Notifications.jsx read it to draw a red dot per row
// and no code path ever set it. Every notification stayed unread
// forever. Add a badge to that and it counts up for the life of the
// account and never comes down: a number that can only grow is not an
// indicator, it is an accusation.
//
// So markAllRead exists here alongside the count, and the panel calls it
// on open.
//
// ── WHY THE CLIENT MAY WRITE THIS ─────────────────────────────
// notifications' RLS lets the OWNER update their own rows. Marking your
// own notification read is the definitive case of that: it is your row,
// about you, and nobody else can be affected by it. Cross-user writes
// stay impossible and stay behind the service role, which is what makes
// an invite notification something only the invite route can create.
// ─────────────────────────────────────────────────────────────

import { getSupabase } from './supabaseClient';

/**
 * Unread notifications for a user. Never throws: a badge is not worth
 * breaking a page for, and zero is the right answer to show when the
 * count cannot be fetched — an inflated badge nobody can clear is worse
 * than no badge.
 */
export async function fetchUnreadCount(userId) {
  if (!userId) return 0;
  try {
    const { count, error } = await getSupabase()
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .is('read_at', null);
    if (error) return 0;
    return count ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Mark everything currently unread as read.
 *
 * Scoped to `user_id` as well as the null check, not because RLS would
 * allow otherwise, but because a query that would be wrong without RLS
 * is a query waiting for the day somebody relaxes RLS.
 *
 * Returns how many rows it claims to have changed, so a caller can
 * update a badge without a second round trip.
 */
export async function markAllNotificationsRead(userId) {
  if (!userId) return 0;
  try {
    const { data, error } = await getSupabase()
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('user_id', userId)
      .is('read_at', null)
      .select('id');
    if (error) return 0;
    return data?.length ?? 0;
  } catch {
    return 0;
  }
}
