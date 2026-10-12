import { NextResponse } from 'next/server';
import { rateLimit, clientKey } from '../../../../lib/rateLimit';

// SPIKE-ONLY clock reference for docs/DIRECTOR_DATA_SPEC.md clock sync.
//
// Returns the server's wall clock. The phone (native/src/spike/clock.js)
// sends five requests, keeps the one with the lowest round trip, and
// stores offset = serverMs - (sentMs + rtt/2) with rtt/2 as the error
// bound. Every director-data timestamp is then written in server time
// so two phones and the web app agree to within that bound.
//
// AUTH MODEL: deliberately open and rate-limited. It returns one number
// that any HTTP Date header already gives away, takes no input, writes
// nothing. A session would put the clock behind the thing being timed
// (the token request itself).
export const dynamic = 'force-dynamic';
const RATE_LIMIT = { limit: 120, windowMs: 60000 };

export async function GET(request) {
  const gate = rateLimit(clientKey(request, 'spike-clock'), RATE_LIMIT);
  if (!gate.ok) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': String(gate.retryAfterSec) } });
  }
  return NextResponse.json({ serverMs: Date.now() }, { headers: { 'Cache-Control': 'no-store' } });
}
