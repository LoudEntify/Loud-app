import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin';
import { rateLimit, clientKey } from '../../../../lib/rateLimit';

// app/api/waitlist/count/route.js
// ─────────────────────────────────────────────────────────────
// The public artist counter. Returns ONE integer and nothing else.
//
// This is the only number the landing page shows, and it is computed
// here with the service role. No column of personal data is selected,
// so nothing to leak: a head/count query reads no rows into memory, it
// asks Postgres for a number. The anon key never touches the table.
//
// Cached briefly at the edge so a page that polls, or a burst of
// visitors, does not become a burst of counts.
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
    const { count, error } = await admin
      .from('waitlist_signups')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'artist');

    if (error) {
      console.warn('[waitlist/count] failed:', error);
      // Never 500 the landing page over a counter; show nothing instead.
      return NextResponse.json(
        { ok: true, count: null },
        { headers: { 'Cache-Control': 'public, max-age=10' } }
      );
    }

    return NextResponse.json(
      { ok: true, count: count ?? 0 },
      { headers: { 'Cache-Control': 'public, max-age=30, s-maxage=30, stale-while-revalidate=60' } }
    );
  } catch (err) {
    console.warn('[waitlist/count] request failed:', err);
    return NextResponse.json({ ok: true, count: null });
  }
}
