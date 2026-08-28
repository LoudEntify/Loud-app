// TrackSource is gone with the camfeed publish branch below — this route
// now mints exactly one kind of grant, and it is subscribe-only.
import { AccessToken } from 'livekit-server-sdk';
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
    // NO DEFAULT ROOM. This used to fall back to 'pilot-room', which
    // meant any caller that failed to resolve a show still got a valid
    // token -- into somebody else's room. A missing room is now a 400:
    // the caller has a bug, and a token is the wrong way to find out.
    const room = searchParams.get('room');
    if (!room) {
      return NextResponse.json({ error: 'room is required' }, { status: 400 });
    }
    const identity = searchParams.get('identity') || `guest-${Date.now()}`;

    // ── CLOSED: `?camfeed=a|b` no longer grants publish ──────────
    //
    // Security round, 2026-08-28. This branch minted a CAMERA-publish
    // token into ANY room, for ANY caller, with no authentication of
    // any kind. That is a live stage invasion, and the full chain was
    // short and needed no account:
    //
    //   1. Open any show's public link, /live?show={uuid}.
    //   2. LiveDemo resolves the show with `select('*')` through the
    //      anon client, so `room_name` is in the browser's own network
    //      response — visible to every viewer.
    //   3. GET /api/token?room={room_name}&camfeed=a
    //      → { canPublish: true, canPublishSources: ['camera'] }
    //   4. Publish a camera track into a running broadcast.
    //
    // Verified against the deployed preview before this change: HTTP
    // 200 with exactly that grant, no Authorization header sent.
    //
    // WHAT REPLACED IT, and why removing this breaks nothing real:
    // multi-camera pairing (Phase 0a). A phone redeems a six-character
    // code at /cam/pair, and app/api/camfeed/session hands it camera
    // tokens against a hashed device secret it must present on every
    // poll. That is the same capability with an actual auth model, and
    // it is what PairingPanel's QR code and link both point at.
    //
    // The ONLY caller of `?camfeed=` was components/CamPage.jsx — the
    // legacy `/cam?room=…&slot=…` page, which nothing in the current UI
    // links to (confirmed by grep across app/, components/, lib/: every
    // pairing link is /cam/pair?code=…). That page now explains itself
    // and points at pairing rather than failing to publish.
    //
    // Identical reasoning, and identical treatment, to the
    // `?contestant=` bypass closed below — a directly-callable API
    // surface with no button behind it is still API surface.
    const requestedCamfeed = searchParams.get('camfeed');
    if (requestedCamfeed === 'a' || requestedCamfeed === 'b') {
      console.warn('[token] camfeed= requested but no longer grants publish (bypass closed)', { room, requestedCamfeed, identity });
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
