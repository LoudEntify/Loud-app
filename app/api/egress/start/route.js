import { EgressClient, WebhookConfig } from 'livekit-server-sdk';
import { EncodedFileOutput, EncodedFileType, EncodingOptions, EgressStatus, S3Upload } from '@livekit/protocol';
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin';
import { verifyArtistAuth } from '../../../../lib/verifyArtistAuth';
import { verifyShowOwner } from '../../../../lib/verifyShowOwner';

// AUTH MODEL: the verified artist who owns the show running in this room.
// Security round finding 3 (docs/SECURITY_AUDIT_2026-08-28.md) — this
// route previously started a billed LiveKit egress, writing into the S3
// bucket, for anyone who knew a room name. See the note in
// app/api/egress/stop/route.js for why a room name is not a secret.

// Stage 4: directed portrait egress -- replaces Stage 3's stock grid
// template with LiveKit's customBaseUrl mechanism, pointed at this app's
// own /egress route (components/EgressPage.jsx). That page renders the
// SAME directed view (ShotVideo/VersusSplit, reused from the live app)
// a real viewer sees, with no UI chrome -- so the recorded file is a
// clean capture of the actual performance, in portrait, not a landscape
// grid of raw feeds. `layout` carries this show's performanceMode
// ('solo' | 'versus') through to that page -- LiveKit passes whatever
// string is given here straight through as a query param, untouched;
// reused for that purpose rather than inventing a parallel channel.
//
// Required environment variables, server-side only (same scope as
// app/api/token/route.js's LiveKit vars):
//   LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL   (existing)
//   LIVEKIT_S3_ACCESS_KEY, LIVEKIT_S3_SECRET,
//   LIVEKIT_S3_ENDPOINT, LIVEKIT_S3_REGION,
//   LIVEKIT_S3_BUCKET                                   (existing, Supabase's
//     S3-compatible Storage connection -- distinct from the app's own
//     NEXT_PUBLIC_SUPABASE_* anon-key pair used elsewhere)
//   EGRESS_TEMPLATE_BASE_URL                            (new -- this
//     app's own real, publicly-reachable origin, e.g.
//     https://loudentify.vercel.app. LiveKit's Egress service runs
//     OUTSIDE this deployment and navigates a headless browser to
//     customBaseUrl directly -- it can never reach localhost or a
//     preview-only URL, so this has to be the stable production domain,
//     not derived from the incoming request.)

function toHttpUrl(wsUrl) {
  return wsUrl.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://');
}

function describeEgress(info) {
  return {
    egressId: info.egressId,
    status: EgressStatus[info.status] ?? info.status,
    error: info.error || null,
  };
}

export async function POST(request) {
  try {
    // ── IDENTITY BEFORE CONFIGURATION ─────────────────────────
    // The env-var guard used to run first, which meant an anonymous
    // caller got `500 "Server missing egress environment variables"` —
    // the server's own configuration state, handed to a stranger, from
    // a route that should have refused them at the door. It also made
    // the auth gate untestable: scripts/api-auth-probe.mjs expects a
    // 401 and was getting the 500 instead, so the check could not tell
    // a closed route from an open one.
    //
    // Answer WHO ARE YOU before WHAT IS WRONG WITH ME.
    const body = await request.json();
    const { room, performanceMode } = body;
    if (!room) {
      return NextResponse.json({ error: 'room is required' }, { status: 400 });
    }

    const auth = await verifyArtistAuth(request);
    if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const admin = getSupabaseAdmin();
    const owner = await verifyShowOwner(admin, room, auth.user);
    if (owner.error) return NextResponse.json({ error: owner.error }, { status: owner.status });

    const {
      LIVEKIT_API_KEY: apiKey,
      LIVEKIT_API_SECRET: apiSecret,
      LIVEKIT_URL: livekitUrl,
      LIVEKIT_S3_ACCESS_KEY: accessKey,
      LIVEKIT_S3_SECRET: secret,
      LIVEKIT_S3_ENDPOINT: endpoint,
      LIVEKIT_S3_REGION: region,
      LIVEKIT_S3_BUCKET: bucket,
      EGRESS_TEMPLATE_BASE_URL: templateBaseUrl,
    } = process.env;

    if (!apiKey || !apiSecret || !livekitUrl || !accessKey || !secret || !endpoint || !region || !bucket || !templateBaseUrl) {
      return NextResponse.json({ error: 'Server missing egress environment variables' }, { status: 500 });
    }


    // Defaults to 'solo' for anything other than exactly 'versus' --
    // EgressPage.jsx's own layout handling has the identical fallback
    // (components/EgressPage.jsx), so an unexpected/missing value here
    // still lands on a sane, working result rather than an ambiguous one.
    const layout = performanceMode === 'versus' ? 'versus' : 'solo';

    const egressClient = new EgressClient(toHttpUrl(livekitUrl), apiKey, apiSecret);

    // Guard against double-starts. The caller already fires this at most
    // once per device per show (a showLiveBroadcastSentRef-style ref
    // guard), but this is the authoritative check -- if a versus show's
    // OTHER performer device (or a retry) already started one for this
    // room, don't stack a second egress on top of it.
    const active = await egressClient.listEgress({ roomName: room, active: true });
    if (active.length > 0) {
      return NextResponse.json({ ok: true, alreadyActive: true, ...describeEgress(active[0]) });
    }

    // Defensive trim only -- a trailing slash pasted from Supabase's S3
    // Connection panel is a common copy-paste mistake and silently breaks
    // path-style bucket resolution. Everything else (region, bucket,
    // access key/secret) is passed through exactly as configured, no
    // normalization -- a mismatch there should surface as an upload
    // error, not be guessed at here.
    const cleanEndpoint = endpoint.replace(/\/+$/, '');

    const output = new EncodedFileOutput({
      fileType: EncodedFileType.MP4,
      filepath: `recordings/${room}-${Date.now()}.mp4`,
      output: {
        case: 's3',
        value: new S3Upload({
          accessKey,
          secret,
          region,
          endpoint: cleanEndpoint,
          bucket,
          forcePathStyle: true, // required for non-AWS S3-compatible endpoints like Supabase Storage
        }),
      },
    });

    // customBaseUrl points at this app's own headless template
    // (components/EgressPage.jsx) instead of LiveKit's built-in grid
    // renderer -- LiveKit appends its own url/token (auto-generated,
    // never minted by us) and this `layout` string as query params when
    // it navigates there. encodingOptions sets the actual output canvas
    // to portrait -- this is what was missing before, not the template
    // choice alone: the default canvas is 1920x1080 regardless of what
    // shape the SOURCE tracks are (confirmed against the installed
    // @livekit/protocol's own EncodingOptions defaults), which is why
    // the old grid recording came out landscape/letterboxed even though
    // the feeds themselves were already portrait.
    // Phase 4a — attach the completion webhook TO THIS REQUEST rather
    // than configuring one in the LiveKit dashboard.
    //
    // Two reasons, and the second is the one that matters. First, a
    // per-request webhook needs no manual setup step, so a fresh
    // deployment records and verifies with nothing to remember. Second,
    // and more importantly, a project-wide dashboard webhook points at
    // ONE url — which means a preview deployment's recordings would be
    // reported to production, or the other way round. Carrying the url on
    // the request keeps each deployment's results with that deployment.
    //
    // EGRESS_WEBHOOK_URL overrides, for the case where the template base
    // (which must be a stable public origin, since a headless browser
    // navigates to it) is not where the webhook should land.
    //
    // STATED PLAINLY: LiveKit's servers must be able to reach this url.
    // On a deployment-protected preview they cannot — the POST is
    // intercepted before it arrives. That is not a silent failure: it
    // simply means no automatic verification on a protected preview, and
    // app/api/egress/verify runs the identical checks from the artist's
    // own session instead.
    const webhookUrl =
      process.env.EGRESS_WEBHOOK_URL ||
      `${templateBaseUrl.replace(/\/+$/, '')}/api/egress/webhook`;

    const info = await egressClient.startRoomCompositeEgress(room, { file: output }, {
      layout,
      customBaseUrl: `${templateBaseUrl.replace(/\/+$/, '')}/egress`,
      encodingOptions: new EncodingOptions({ width: 1080, height: 1920 }),
      // signingKey names WHICH of the project's API keys LiveKit signs
      // the callback with. app/api/egress/webhook verifies with the same
      // pair, so they have to agree.
      webhooks: [new WebhookConfig({ url: webhookUrl, signingKey: apiKey })],
    });
    // info.status/error here only reflect the SYNCHRONOUS start call --
    // the actual S3 upload happens after this returns, so a bad
    // credential/bucket often won't surface until the stop response
    // (EgressStatus.EGRESS_FAILED + info.error) or later in LiveKit's own
    // dashboard/logs, not necessarily here.
    return NextResponse.json({ ok: true, ...describeEgress(info) });
  } catch (err) {
    // A recording failure must never take the show down -- this route
    // always returns a readable response; the caller fires it
    // fire-and-forget and only logs on failure, same principle as
    // flywheel logging in lib/shotCommands.js.
    console.error('[egress] start failed:', err);
    return NextResponse.json(
      { error: 'Egress start failed', detail: String(err?.message || err) },
      { status: 500 }
    );
  }
}
