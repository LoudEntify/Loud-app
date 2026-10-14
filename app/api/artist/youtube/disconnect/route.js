// POST /api/artist/youtube/disconnect — takes effect immediately: revokes the
// grant with Google, deletes the tokens and this artist's stream keys, audited
// (lib/youtube/disconnect.js). Reachable from Settings and onboarding.
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../../lib/supabaseAdmin';
import { verifyArtistAuth } from '../../../../../lib/verifyArtistAuth';
import { correlationFrom, withCorrelation } from '../../../../../lib/correlation';
import { disconnect } from '../../../../../lib/youtube/connections';

export async function POST(request) {
  const cid = correlationFrom(request);
  const auth = await verifyArtistAuth(request);
  if (auth.error) return withCorrelation(NextResponse.json({ error: auth.error }, { status: auth.status }), cid);
  const r = await disconnect(getSupabaseAdmin(), auth.user.id, { correlationId: cid });
  if (r.error) return withCorrelation(NextResponse.json({ error: 'Could not disconnect. Try again.' }, { status: 500 }), cid);
  // ok: a live connection was removed. revoked: Google confirmed the grant
  // is gone (null when there was nothing to revoke, false when Google
  // refused; our copy is deleted either way, and the Settings page says so).
  return withCorrelation(NextResponse.json({ ok: r.ok, revoked: r.revoked ?? null, streamKeysWiped: r.streamKeysWiped ?? 0 }), cid);
}
