import { AccessToken, TrackSource } from 'livekit-server-sdk';
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

export async function GET(request) {
  try {
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
    const camfeed = searchParams.get('camfeed'); // 'a' | 'b' | null -- extra camera-only device

    // Extra camera feeds: video-only, no data messages, no slot-exclusivity
    // check (multiple camera devices per artist are expected and allowed).
    if (camfeed === 'a' || camfeed === 'b') {
      const at = new AccessToken(apiKey, apiSecret, { identity });
      at.addGrant({
        room,
        roomJoin: true,
        canPublish: true,
        canPublishSources: [TrackSource.CAMERA],
        canSubscribe: true,
        canPublishData: false,
      });
      const token = await at.toJwt();
      return NextResponse.json({ token, url: livekitUrl, slotTaken: false, assignedRole: `camfeed-${camfeed}` });
    }

    // Accounts & Identity Day 1: `?contestant=a|b` no longer grants publish
    // rights. It used to mint a publish-capable token gated only by a
    // same-prefix name-collision check against live LiveKit participants --
    // no code, no auth -- flagged "accepted-not-solved" in
    // MULTI_PERFORMER_SPEC.md, closed now. The only legitimate way to get a
    // performer-publish token is app/api/performer/claim-slot, which
    // requires both a valid show_slots code AND a verified artist session
    // as of this round, and mints its own AccessToken directly -- it never
    // calls this route. No button in the current UI ever sent `contestant=`
    // here (confirmed: the role dropdown's performer option always routes
    // through claim-slot); this branch existed only as directly-callable
    // API surface. Still logged, in case anything is actually relying on
    // it, but it now falls through to the same subscribe-only grant every
    // viewer gets rather than ever setting canPublish.
    const requestedContestant = searchParams.get('contestant');
    if (requestedContestant === 'a' || requestedContestant === 'b') {
      console.warn('[token] contestant= requested but no longer grants publish (bypass closed)', { room, requestedContestant, identity });
    }

    const at = new AccessToken(apiKey, apiSecret, { identity });
    at.addGrant({
      room,
      roomJoin: true,
      canPublish: false,
      canSubscribe: true,
      // Comments travel as data messages, which is a separate permission
      // from publishing video/audio. Everyone -- viewers included -- needs
      // this, or their comments never leave their own client.
      canPublishData: true,
    });

    const token = await at.toJwt();

    return NextResponse.json({
      token,
      url: livekitUrl,
      slotTaken: false,
      assignedRole: 'viewer',
    });
  } catch (err) {
    // Any unexpected crash returns readable JSON instead of an empty body --
    // an empty body is what caused the confusing "Unexpected end of JSON
    // input" client-side error this bug produced.
    console.error('Token route error:', err);
    return NextResponse.json(
      { error: 'Token generation failed', detail: String(err?.message || err) },
      { status: 500 }
    );
  }
}
