// GET /api/artist/youtube/status — the artist's own connection: channel,
// readiness, mode. Never token material. POST re-checks readiness.
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../../lib/supabaseAdmin';
import { verifyArtistAuth } from '../../../../../lib/verifyArtistAuth';
import { correlationFrom, withCorrelation } from '../../../../../lib/correlation';
import { connectionStatus, checkReadiness, youtubeMode } from '../../../../../lib/youtube/connections';

export async function GET(request) {
  const cid = correlationFrom(request);
  const auth = await verifyArtistAuth(request);
  if (auth.error) return withCorrelation(NextResponse.json({ error: auth.error }, { status: auth.status }), cid);
  const { status } = await connectionStatus(getSupabaseAdmin(), auth.user.id);
  return withCorrelation(NextResponse.json({ mode: youtubeMode(), connection: status }), cid);
}
export async function POST(request) {
  const cid = correlationFrom(request);
  const auth = await verifyArtistAuth(request);
  if (auth.error) return withCorrelation(NextResponse.json({ error: auth.error }, { status: auth.status }), cid);
  const admin = getSupabaseAdmin();
  const readiness = await checkReadiness(admin, auth.user.id, { correlationId: cid });
  const { status } = await connectionStatus(admin, auth.user.id);
  return withCorrelation(NextResponse.json({ readiness, connection: status }), cid);
}
