// lib/spike/clockUpstream.js — let a LOCAL `next dev` server's
// /api/spike/clock answer with the STAGING deployment's clock.
//
// Why: in the one-phone test the phone talks to staging, so its clock
// offset (native/src/spike/clock.js) is measured against staging's wall
// clock. The laptop Controller (app/spike/controller) runs on localhost,
// where "the server clock" would be the Mac's own. Two references means
// the decided→completed figure in every ack carries the Mac's drift from
// Vercel. With NEXT_PUBLIC_SPIKE_CLOCK_BASE set, the local route fetches
// staging's clock on each request and returns that serverMs instead: the
// browser's sentMs/receivedMs still bracket the whole trip, so Cristian's
// method (lowest round trip wins, half of it is the error bound) stays
// exactly right, and both sides now stamp staging time.
//
// Why a relay and not CORS alone: a header added on this branch only
// reaches staging when the branch merges, and the spike must not merge
// before its migrations are approved. The route still sends
// Access-Control-Allow-Origin: * so a browser on another origin can
// sample it directly once this code is deployed.
//
// Local only: on Vercel (VERCEL / VERCEL_ENV set) the variable is
// ignored, so a deployment can never relay to itself in a loop.
//
// SPIKE ONLY: delete with app/api/spike/* when the spike ends.
// PRD row 165. S&I: Observability.

export function clockUpstreamBase(env = process.env) {
  if (env.VERCEL || env.VERCEL_ENV) return null;
  const raw = String(env.NEXT_PUBLIC_SPIKE_CLOCK_BASE || '').trim().replace(/\/+$/, '');
  if (!raw) return null;
  if (!/^https?:\/\//i.test(raw)) throw new Error('NEXT_PUBLIC_SPIKE_CLOCK_BASE must be an absolute http(s) URL, e.g. https://loud-app-git-staging-korey-alashe.vercel.app');
  return raw;
}

/** One upstream sample. Never throws: a failure is a dropped sample on the laptop, which clock.js already tolerates. */
export async function fetchUpstreamClock(base, { fetchImpl = globalThis.fetch, timeoutMs = 5000 } = {}) {
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
  try {
    const res = await fetchImpl(`${base}/api/spike/clock`, { cache: 'no-store', signal: ctl?.signal });
    const body = await res.json().catch(() => null);
    if (!res.ok || !Number.isFinite(body?.serverMs)) {
      return { ok: false, status: res.status, error: body?.error || `upstream clock answered ${res.status}` };
    }
    return { ok: true, serverMs: body.serverMs };
  } catch (e) {
    return { ok: false, status: 502, error: String(e?.message || e) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
