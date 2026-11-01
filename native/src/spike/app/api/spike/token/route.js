// POST /api/spike/token — SPIKE ONLY (spike/native-device-zoom). Mints a
// token for the signed-in artist's own rehearsal room with camera video
// AND data messages, so the device-zoom spike's camera phone can answer
// commands over LiveKit data messages. The real camera and rehearsal seats
// (lib/camfeedPairing.js mintCameraToken) stay camera-only on purpose and
// are not touched by this route.
//
// Preview and local only: refuses where the dev harness is not allowed
// (never on production). Delete this file when the spike ends.
//
// AUTH MODEL: verifyArtistAuth — a signed-in artist, for their own room.
// PRD rows 12, 13, 127. S&I: Real-time media.
import { NextResponse } from 'next/server';
import { AccessToken } from 'livekit-server-sdk';
import { randomUUID } from 'node:crypto';
import { verifyArtistAuth } from '../../../../lib/verifyArtistAuth';
import { devHarnessAllowed } from '../../../../lib/paymentProvider';
import { rehearsalRoom } from '../../../../lib/camfeedPairing';
import { correlationFrom, withCorrelation } from '../../../../lib/correlation';

const TTL_SECONDS = 30 * 60;

export async function POST(request) {
  const cid = correlationFrom(request);
  if (!devHarnessAllowed()) return withCorrelation(NextResponse.json({ error: 'The spike token is only available where the dev harness is allowed.' }, { status: 403 }), cid);
  const auth = await verifyArtistAuth(request);
  if (auth.error) return withCorrelation(NextResponse.json({ error: auth.error }, { status: auth.status }), cid);
  const apiKey = process.env.LIVEKIT_API_KEY; const apiSecret = process.env.LIVEKIT_API_SECRET; const url = process.env.LIVEKIT_URL;
  if (!apiKey || !apiSecret || !url) return withCorrelation(NextResponse.json({ error: 'LiveKit is not configured here.' }, { status: 500 }), cid);
  let body = {}; try { body = await request.json(); } catch { body = {}; }
  const role = body.role === 'controller' ? 'controller' : 'camera';
  const room = rehearsalRoom(auth.user.id);
  const identity = `spike-${role}-${randomUUID().slice(0, 8)}`;
  const at = new AccessToken(apiKey, apiSecret, { identity, ttl: TTL_SECONDS });
  at.addGrant({ room, roomJoin: true, canPublish: role === 'camera', canPublishSources: role === 'camera' ? ['camera'] : [], canSubscribe: true, canPublishData: true });
  const token = await at.toJwt();
  return withCorrelation(NextResponse.json({ token, url, room, identity, role, sessionSeconds: TTL_SECONDS }), cid);
}
