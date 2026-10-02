// POST /api/artist/net-probe — Kit Check's upload probe (PRD: connection check).
// The browser's navigator.connection.downlink is a coarse estimate of the
// DOWN link; streaming needs the UP link, which only a timed upload can
// measure. The client posts a few hundred KB and times it; this route just
// counts the bytes and answers. Signed-in artists only, body capped at 2 MB.
import { NextResponse } from 'next/server';
import { verifyArtistAuth } from '../../../../lib/verifyArtistAuth';
import { correlationFrom, withCorrelation } from '../../../../lib/correlation';

const MAX_BYTES = 2 * 1024 * 1024;

export async function POST(request) {
  const cid = correlationFrom(request);
  const auth = await verifyArtistAuth(request);
  if (auth.error) return withCorrelation(NextResponse.json({ error: auth.error }, { status: auth.status }), cid);
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > MAX_BYTES) return withCorrelation(NextResponse.json({ error: 'Probe too large' }, { status: 413 }), cid);
  const buf = await request.arrayBuffer();
  return withCorrelation(NextResponse.json({ bytes: buf.byteLength }), cid);
}
