// lib/insights.js — per-show insights computed from the event tables at
// show end (PRD 132, 134). Pure aggregation over rows the route fetches.
export function computeInsights({ metering = [], votes = 0, supportTokens = 0, followersBefore = 0, followersAfter = 0, startedAt, endedAt }) {
  const start = Date.parse(startedAt), end = Date.parse(endedAt || startedAt);
  const perMinute = new Map();
  const perViewer = new Map();
  for (const m of metering) {
    const t = Date.parse(m.created_at);
    if (!Number.isFinite(t)) continue;
    const minute = Math.max(0, Math.floor((t - start) / 60000));
    if (!perMinute.has(minute)) perMinute.set(minute, new Set());
    perMinute.get(minute).add(m.viewer_id);
    const v = perViewer.get(m.viewer_id) || { first: t, last: t };
    v.first = Math.min(v.first, t); v.last = Math.max(v.last, t);
    perViewer.set(m.viewer_id, v);
  }
  const series = [...perMinute.entries()].sort((a, b) => a[0] - b[0]).map(([t, set]) => ({ t, viewers: set.size }));
  const peak = series.reduce((m, p) => Math.max(m, p.viewers), 0);
  let watch = 0;
  for (const v of perViewer.values()) watch += Math.max(15000, v.last - v.first); // a single heartbeat still counts a quarter minute
  const avg = perViewer.size ? Math.round(watch / perViewer.size) : 0;
  return { peak_viewers: peak, watch_time_ms: watch, average_stay_ms: avg, votes_cast: votes, tokens_received: supportTokens, followers_gained: Math.max(0, followersAfter - followersBefore), viewers_series: series, duration_ms: Math.max(0, end - start) };
}

export function formatDuration(ms) {
  const s = Math.floor((ms || 0) / 1000); const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${String(m).padStart(2, '0')}` : `${m}:${String(s % 60).padStart(2, '0')}`;
}
