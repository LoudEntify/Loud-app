import { NextResponse } from 'next/server';
import { rateLimit, clientKey } from '../../../../lib/rateLimit';
import { clockUpstreamBase, fetchUpstreamClock } from '../../../../lib/spike/clockUpstream';

// SPIKE-ONLY clock reference for docs/DIRECTOR_DATA_SPEC.md clock sync.
//
// Returns the server's wall clock. The phone (native/src/spike/clock.js)
// and the laptop Controller (lib/spike/controllerSession.js) send five
// requests, keep the one with the lowest round trip, and store
// offset = serverMs - (sentMs + rtt/2) with rtt/2 as the error bound.
// Every director-data timestamp is then written in server time so the
// phone and the web app agree to within that bound.
//
// LOCAL RELAY: on a local `next dev` with NEXT_PUBLIC_SPIKE_CLOCK_BASE
// set (lib/spike/clockUpstream.js), this route answers with THAT
// deployment's clock instead of the Mac's, so a laptop Controller on
// localhost stamps the same staging time as the phone. Ignored on Vercel.
//
// AUTH MODEL: deliberately open and rate-limited. It returns one number
// that any HTTP Date header already gives away, takes no input, writes
// nothing. A session would put the clock behind the thing being timed
// (the token request itself). For the same reason it allows any origin
// (Access-Control-Allow-Origin: *): a browser on another host can sample
// it, and there is nothing in the answer to protect.
export const dynamic = 'force-dynamic';
const RATE_LIMIT = { limit: 120, windowMs: 60000 };
const HEADERS = { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' };

export async function GET(request) {
  const gate = rateLimit(clientKey(request, 'spike-clock'), RATE_LIMIT);
  if (!gate.ok) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { ...HEADERS, 'Retry-After': String(gate.retryAfterSec) } });
  }
  const upstream = clockUpstreamBase();
  if (upstream) {
    const r = await fetchUpstreamClock(upstream);
    if (!r.ok) return NextResponse.json({ error: `upstream clock ${upstream}: ${r.error}` }, { status: 502, headers: HEADERS });
    return NextResponse.json({ serverMs: r.serverMs, via: upstream }, { headers: HEADERS });
  }
  return NextResponse.json({ serverMs: Date.now() }, { headers: HEADERS });
}
