import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';
import { NextResponse } from 'next/server';

// This route is the only place the LiveKit API secret is ever touched.
// It must never be imported into client components -- it runs server-side
// only, which is guaranteed by living under app/api/.
//
// Required environment variables (set in Vercel project settings, and in
// .env.local for local dev -- never commit actual values):
//   LIVEKIT_API_KEY
//   LIVEKIT_API_SECRET
//   LIVEKIT_URL        (e.g. wss://yourproject.livekit.cloud)

function toHttpUrl(wsUrl) {
  return wsUrl.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://');
}

export async function GET(request) {
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const livekitUrl = process.env.LIVEKIT_URL;

  if (!apiKey || !apiSecret || !livekitUrl) {
    return NextResponse.json(
      { error: 'Server missing LiveKit environment variables' },
      { status: 500 }
    );
  }

  const { searchParams } = new URL(request.url);
  const room = searchParams.get('room') || 'pilot-room';
  const identity = searchParams.get('identity') || `guest-${Date.now()}`;
  const requestedContestant = searchParams.get('contestant'); // 'a' | 'b' | null

  // Check whether the requested contestant slot is already occupied by a
  // currently-connected participant, so a third person can't also publish
  // as "contestant A" over an existing performer.
  let slotTaken = false;
  if (requestedContestant === 'a' || requestedContestant === 'b') {
    try {
      const svc = new RoomServiceClient(toHttpUrl(livekitUrl), apiKey, apiSecret);
      const participants = await svc.listParticipants(room);
      const prefix = `contestant-${requestedContestant}-`;
      slotTaken = participants.some(
        (p) => p.identity.startsWith(prefix) && p.identity !== identity
      );
    } catch (e) {
      // Room doesn't exist yet (first person joining) -- not taken.
      slotTaken = false;
    }
  }

  // If the slot is taken, silently fall back to a viewer-only token rather
  // than erroring, so a late joiner isn't blocked -- they just watch instead.
  const assignedContestant = slotTaken ? null : requestedContestant;

  const at = new AccessToken(apiKey, apiSecret, { identity });
  at.addGrant({
    room,
    roomJoin: true,
    canPublish: assignedContestant === 'a' || assignedContestant === 'b',
    canSubscribe: true,
  });

  const token = await at.toJwt();

  return NextResponse.json({
    token,
    url: livekitUrl,
    slotTaken,
    assignedRole: assignedContestant || 'viewer',
  });
}
