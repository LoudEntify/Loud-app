import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { AccessToken, TrackSource } from 'livekit-server-sdk';
import { verifyArtistAuth } from '../../../../lib/verifyArtistAuth';
import { devHarnessAllowed } from '../../../../lib/paymentProvider';
import { rehearsalRoom } from '../../../../lib/camfeedPairing';
import { correlationFrom, withCorrelation } from '../../../../lib/correlation';

// SPIKE-ONLY. Mints a LiveKit token for the native device-zoom spike
// (docs/DIRECTOR_DATA_SPEC.md, branch spike/native-device-zoom).
//
// DELETE THIS ROUTE WHEN THE SPIKE ENDS. It exists because the spike
// needs a data channel between two phones, and the production camera
// token (lib/camfeedPairing.js mintCameraToken) has canPublishData:false
// on purpose — a paired camera is a device, not a controller, and the
// decision (docs/DECISIONS.md, 2026-10-12) was to leave that grant alone
// rather than widen it for an experiment.
//
// AUTH MODEL: artist session (verifyArtistAuth) AND the dev-harness gate
// (devHarnessAllowed: never on VERCEL_ENV=production). Both phones sign in
// as the same artist and meet in that artist's own rehearsal room, so no
// token minted here can reach a show room or another artist's room.
//
//   role 'camera'     publishes camera video + data, subscribes
//   role 'controller' publishes data only, subscribes
//
// Thirty-minute TTL: long enough for the 20-minute soak, short enough
// that a leaked token is not a standing credential.
const TTL = '30m';

export async function POST(request) {
  const cid = correlationFrom(request);
  if (!devHarnessAllowed()) {
    return withCorrelation(
      NextResponse.json({ error: 'The spike token route is only available where the dev harness is allowed.' }, { status: 403 }),
      cid
    );
  }
  const auth = await verifyArtistAuth(request);
  if (auth.error) return withCorrelation(NextResponse.json({ error: auth.error }, { status: auth.status }), cid);

  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const url = process.env.NEXT_PUBLIC_LIVEKIT_URL || process.env.LIVEKIT_URL;
  if (!apiKey || !apiSecret || !url) {
    return withCorrelation(NextResponse.json({ error: 'LiveKit is not configured on this deployment.' }, { status: 503 }), cid);
  }

  const body = await request.json().catch(() => ({}));
  const role = body.role === 'controller' ? 'controller' : body.role === 'camera' ? 'camera' : null;
  if (!role) return withCorrelation(NextResponse.json({ error: 'role must be camera or controller' }, { status: 400 }), cid);

  const room = rehearsalRoom(auth.user.id);
  const identity = `spike-${role}-${randomUUID().slice(0, 8)}`;
  const at = new AccessToken(apiKey, apiSecret, { identity, ttl: TTL });
  at.addGrant({
    room,
    roomJoin: true,
    canPublish: role === 'camera',
    canPublishSources: role === 'camera' ? [TrackSource.CAMERA] : [],
    canSubscribe: true,
    canPublishData: true,
  });
  const token = await at.toJwt();
  return withCorrelation(NextResponse.json({ token, url, room, identity, role, ttl: TTL }), cid);
}
