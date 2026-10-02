// lib/schedule.js — booking rules, pure and shared by the form and the route.
// docs/CLAUDE.md §5: "Shows are booked at least 30 minutes ahead. No
// unscheduled go-live." PRD 115: lengths from 10 minutes to over an hour.
export const MIN_LEAD_MS = 30 * 60_000;
export const LENGTH_OPTIONS = [15, 30, 45, 60, 90];
export const MIN_MINUTES = 15;   // the existing shows_duration_sane check (15–180)
export const MAX_MINUTES = 180;
export const SLOTS_PER_MONTH = 12;

export function earliestStart(nowMs = Date.now()) {
  const t = nowMs + MIN_LEAD_MS;
  return Math.ceil(t / 300_000) * 300_000; // next 5-minute mark
}

export function validateBooking(input, { nowMs = Date.now() } = {}) {
  const errors = {};
  const mode = input.mode === 'versus' ? 'versus' : input.mode === 'solo' ? 'solo' : null;
  if (!mode) errors.mode = 'Solo or Versus.';
  const start = Date.parse(input.startAt || '');
  if (!Number.isFinite(start)) errors.startAt = 'Choose a date and time.';
  else if (start - nowMs < MIN_LEAD_MS) errors.startAt = 'The earliest start is 30 minutes from now.';
  else if (start - nowMs > 90 * 86400_000) errors.startAt = 'Shows can be booked up to 90 days ahead.';
  const minutes = Number(input.minutes);
  if (!Number.isInteger(minutes) || minutes < MIN_MINUTES || minutes > MAX_MINUTES) errors.minutes = `Between ${MIN_MINUTES} minutes and 3 hours.`;
  const title = String(input.title || '').trim();
  if (!title) errors.title = 'Give your show a name.';
  if (title.length > 80) errors.title = 'Keep the title under 80 characters.';
  const genre = String(input.genre || '').trim() || null;
  if (mode === 'versus' && !input.inviteeId && !input.inviteeUsername) errors.invitee = 'Pick the artist to invite.';
  const ok = Object.keys(errors).length === 0;
  return { ok, errors, values: ok ? { mode, startAt: new Date(start).toISOString(), minutes, title, genre, description: String(input.description || '').trim().slice(0, 500) || null, placeId: input.placeId || null, inviteeId: input.inviteeId || null, inviteeUsername: input.inviteeUsername || null, coverUrl: input.coverUrl || null } : null };
}

/** The reminders still in the future for a show (24h, 4h, 1h, 30m). */
export function reminderOffsetsDue(startAtMs, nowMs = Date.now()) {
  return [1440, 240, 60, 30].filter((m) => startAtMs - m * 60_000 > nowMs);
}
