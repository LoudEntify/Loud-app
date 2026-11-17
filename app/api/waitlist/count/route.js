import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin';
import { rateLimit, clientKey } from '../../../../lib/rateLimit';

// app/api/waitlist/count/route.js
// ─────────────────────────────────────────────────────────────
// Public aggregate artist, fan and total signup counters. No personal data.
//
// Counts are computed server-side with the service role. HEAD queries
// return no personal data. `count` remains the artist count for existing
// callers; artists, fans and total power the waitlist's community panel.
// Responses are not cached so the post-submission refresh is current.
//
// PRD S&I: Database, Rate limiting
// ─────────────────────────────────────────────────────────────

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  const gate = rateLimit(clientKey(request, 'waitlist-count'), { limit: 120, windowMs: 60000 });
  if (!gate.ok) {
    return NextResponse.json(
      { ok: false, error: 'Rate limited' },
      { status: 429, headers: { 'Retry-After': String(gate.retryAfterSec) } }
    );
  }

  try {
    const admin = getSupabaseAdmin();
    const [artists, fans] = await Promise.all([
      admin.from('waitlist_signups').select('id', { count: 'exact', head: true }).eq('role', 'artist'),
      admin.from('waitlist_signups').select('id', { count: 'exact', head: true }).eq('role', 'viewer'),
    ]);
    const error = artists.error || fans.error;

    if (error) {
      console.warn('[waitlist/count] failed:', error);
      // Never 500 the landing page over a counter; show nothing instead.
      return NextResponse.json(
        { ok: false, count: null, artists: null, fans: null, total: null },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    }

    return NextResponse.json(
      { ok: true, count: artists.count ?? 0, artists: artists.count ?? 0, fans: fans.count ?? 0, total: (artists.count ?? 0) + (fans.count ?? 0) },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    console.warn('[waitlist/count] request failed:', err);
    return NextResponse.json({ ok: false, count: null, artists: null, fans: null, total: null }, { headers: { 'Cache-Control': 'no-store' } });
  }
}
