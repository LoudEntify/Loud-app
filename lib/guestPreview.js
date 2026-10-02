// lib/guestPreview.js
// ─────────────────────────────────────────────────────────────
// The 60-second guest preview.
//
// PRD row 90: "Timer counts total watching on the device across every
// video, so swiping does not reset it. A chip appears at about 50 seconds.
// At 60 seconds, or on the first react, comment, vote, follow, remind me,
// message or support tap, sign-up opens." docs/USER_JOURNEY.md: "It is a
// nudge, not a security control."
//
// Pure accounting (PreviewMeter) with no DOM, plus a thin localStorage
// wrapper. Watched time only accrues while the player reports 'playing'.
// ─────────────────────────────────────────────────────────────

export const PREVIEW_LIMIT_MS = 60_000;
export const PREVIEW_CHIP_AT_MS = 50_000;

export class PreviewMeter {
  constructor({ watchedMs = 0, now = () => Date.now() } = {}) {
    this.now = now;
    this.watchedMs = watchedMs;
    this.playingSince = null;
  }
  /** Call with the PlayerSource state on every change. */
  onPlayerState(state) {
    if (state === 'playing') { if (this.playingSince == null) this.playingSince = this.now(); }
    else this.flush();
  }
  flush() {
    if (this.playingSince != null) { this.watchedMs += this.now() - this.playingSince; this.playingSince = null; }
  }
  totalMs() { return this.watchedMs + (this.playingSince != null ? this.now() - this.playingSince : 0); }
  remainingMs() { return Math.max(0, PREVIEW_LIMIT_MS - this.totalMs()); }
  chipDue() { return this.totalMs() >= PREVIEW_CHIP_AT_MS && this.totalMs() < PREVIEW_LIMIT_MS; }
  expired() { return this.totalMs() >= PREVIEW_LIMIT_MS; }
}

const KEY = 'loudentify.guestPreviewMs';

export function loadWatchedMs() {
  try { return Number(window.localStorage.getItem(KEY)) || 0; } catch { return 0; }
}
export function saveWatchedMs(ms) {
  try { window.localStorage.setItem(KEY, String(Math.max(0, Math.round(ms)))); } catch { /* storage-less device: the nudge just repeats */ }
}

// The actions that open sign-up immediately for a guest (docs/USER_JOURNEY.md).
export const GATED_ACTIONS = ['react', 'comment', 'vote', 'follow', 'remind', 'message', 'support'];
