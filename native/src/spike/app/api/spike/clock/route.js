// GET /api/spike/clock — SPIKE ONLY (spike/native-device-zoom). The server's
// clock, in milliseconds, for the phones' clock-offset measurement (B12,
// native/src/spike/clock.js). Open by design: it carries nothing but the
// time, it is rate-limited, and the devices that need it most (paired
// camera phones) have no account. Delete when a permanent time endpoint
// exists. PRD row 165. S&I: Observability.
import { NextResponse } from 'next/server';
import { rateLimit, clientKey } from '../../../../lib/rateLimit';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const limited = rateLimit(`spike-clock:${clientKey(request)}`, { limit: 120, windowMs: 60_000 });
  if (limited) return limited;
  return NextResponse.json({ serverMs: Date.now() }, { headers: { 'cache-control': 'no-store' } });
}
