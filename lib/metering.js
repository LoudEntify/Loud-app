// lib/metering.js
// ─────────────────────────────────────────────────────────────
// Viewer-hour metering from the player's own events. PRD row 144;
// docs/ARCHITECTURE.md "Metering viewer-hours (v2)": a view counts after
// 30 seconds of playing; client-reported, rate-limited, de-duplicated per
// viewer and show; never blocks playback.
//
// ViewMeter is pure: feed it player states and it says when the 30-second
// 'counted' event is due and when heartbeats are due. The route
// (app/api/viewer/metering) stores whatever arrives; de-duplication of
// 'counted' is per (viewer, show) on the server too.
// ─────────────────────────────────────────────────────────────

export const METERING_EVENTS = ['play', 'pause', 'ended', 'heartbeat', 'counted'];
export const COUNT_AFTER_MS = 30_000;
export const HEARTBEAT_MS = 15_000;

export class ViewMeter {
  constructor({ now = () => Date.now() } = {}) {
    this.now = now;
    this.playingSince = null;
    this.playedMs = 0;
    this.counted = false;
    this.lastHeartbeat = null;
  }
  playedTotal() { return this.playedMs + (this.playingSince != null ? this.now() - this.playingSince : 0); }
  /** Returns the metering events to send for this state change. */
  onPlayerState(state) {
    const out = [];
    if (state === 'playing') {
      if (this.playingSince == null) { this.playingSince = this.now(); this.lastHeartbeat = this.playingSince; out.push('play'); }
    } else if (this.playingSince != null) {
      this.playedMs += this.now() - this.playingSince;
      this.playingSince = null;
      out.push(state === 'ended' ? 'ended' : 'pause');
    }
    return out;
  }
  /** Call on a timer while playing. Returns due events (heartbeat and/or counted). */
  tick() {
    const out = [];
    if (this.playingSince == null) return out;
    const t = this.now();
    if (!this.counted && this.playedTotal() >= COUNT_AFTER_MS) { this.counted = true; out.push('counted'); }
    if (t - this.lastHeartbeat >= HEARTBEAT_MS) { this.lastHeartbeat = t; out.push('heartbeat'); }
    return out;
  }
}
