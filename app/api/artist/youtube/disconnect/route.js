// POST /api/artist/youtube/disconnect — takes effect immediately, deletes the tokens, audited.
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
  return withCorrelation(NextResponse.json({ ok: r.ok }), cid);
}
