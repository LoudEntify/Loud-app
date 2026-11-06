// native/src/spike/clock.js — the device's offset to the server clock (B12).
// Cristian's method: several round trips, keep the sample with the lowest
// latency, offset = serverMs - (sentMs + rtt/2). Repeated every minute so
// drift is visible. Every record the spike writes carries
// t_server_ms = t_device_ms + offset.
//
// PRD row 165. S&I: Observability.

export const SAMPLES = 5;
export const RESYNC_EVERY_MS = 60_000;

/** Pick the best sample: lowest round trip wins; its half-RTT is the error bound. */
export function pickOffset(samples) {
  const good = samples.filter((s) => Number.isFinite(s.rttMs) && Number.isFinite(s.serverMs));
  if (!good.length) return null;
  const best = good.reduce((a, b) => (b.rttMs < a.rttMs ? b : a));
  const offsetMs = best.serverMs - (best.sentMs + best.rttMs / 2);
  return { offsetMs: Math.round(offsetMs), errorBoundMs: Math.round(best.rttMs / 2), rttMs: best.rttMs, samples: good.length };
}

/**
 * Measure against `/api/spike/clock`. `fetchImpl` and `now` are injectable
 * for tests. `now` must be a monotonic-ish ms clock on the device.
 */
export async function measureOffset({ base, fetchImpl = globalThis.fetch, now = () => Date.now(), samples = SAMPLES } = {}) {
  const out = [];
  for (let i = 0; i < samples; i += 1) {
    const sentMs = now();
    try {
      const res = await fetchImpl(`${base}/api/spike/clock`, { cache: 'no-store' });
      const receivedMs = now();
      const body = await res.json();
      if (res.ok && Number.isFinite(body?.serverMs)) out.push({ sentMs, receivedMs, rttMs: receivedMs - sentMs, serverMs: body.serverMs });
    } catch { /* a failed sample is just a missing sample */ }
  }
  const picked = pickOffset(out);
  return picked ? { ...picked, measuredAt: now() } : null;
}

export function toServerMs(deviceMs, offset) { return offset ? deviceMs + offset.offsetMs : null; }
