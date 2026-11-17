import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin';
import { rateLimit, clientKey } from '../../../../lib/rateLimit';
import { normaliseUsername, validateUsername } from '../../../../lib/usernames';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };

// Public signup check. Owner-only profile RLS deliberately hides rows from
// anonymous browsers; only the server can check the shared handle namespace.
// Return one boolean, never the account id or any private profile fields.
export async function GET(request) {
  const gate = rateLimit(clientKey(request, 'signup-username'), { limit: 30, windowMs: 60000 });
  if (!gate.ok) return NextResponse.json({ error: 'Please wait before checking another username.' }, { status: 429, headers: { ...headers, 'Retry-After': String(gate.retryAfterSec) } });
  const handle = normaliseUsername(new URL(request.url).searchParams.get('username'));
  const invalid = validateUsername(handle);
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400, headers });
  try {
    const { count, error } = await getSupabaseAdmin().from('profiles')
      .select('id', { count: 'exact', head: true }).eq('username', handle);
    if (error) return NextResponse.json({ error: 'Username checks are temporarily unavailable. Please try again.' }, { status: 503, headers });
    return NextResponse.json({ available: count === 0 }, { headers });
  } catch {
    return NextResponse.json({ error: 'Username checks are temporarily unavailable. Please try again.' }, { status: 503, headers });
  }
}
