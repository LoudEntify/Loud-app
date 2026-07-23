import { AccessToken } from 'livekit-server-sdk';
import { NextResponse } from 'next/server';

// This route is the only place the LiveKit API secret is ever touched.
// It must never be imported into client components — it runs server-side
// only, which is guaranteed by living under app/api/.
//
// Required environment variables (set in Vercel project settings, and in
// .env.local for local dev — never commit actual values):
//   LIVEKIT_API_KEY
//   LIVEKIT_API_SECRET
//   LIVEKIT_URL        (e.g. wss://yourproject.livekit.cloud)

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
  const contestant = searchParams.get('contestant'); // 'a' | 'b' | null for solo/viewer

  const at = new AccessToken(apiKey, apiSecret, { identity });
  at.addGrant({
    room,
    roomJoin: true,
    canPublish: contestant === 'a' || contestant === 'b',
    canSubscribe: true,
  });

  const token = await at.toJwt();

  return NextResponse.json({ token, url: livekitUrl });
}
