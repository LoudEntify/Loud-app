import { EgressClient } from 'livekit-server-sdk';
import { EncodedFileOutput, EncodedFileType, EgressStatus, S3Upload } from '@livekit/protocol';
import { NextResponse } from 'next/server';

// Stage 3: stock LiveKit grid template only -- proves the record/store
// pipeline end-to-end before Stage 4 (a custom shot-directed template via
// customBaseUrl, once a grid file has actually landed in the bucket and
// been downloaded and confirmed).
//
// Required environment variables, server-side only (same scope as
// app/api/token/route.js's LiveKit vars):
//   LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL   (existing)
//   LIVEKIT_S3_ACCESS_KEY, LIVEKIT_S3_SECRET,
//   LIVEKIT_S3_ENDPOINT, LIVEKIT_S3_REGION,
//   LIVEKIT_S3_BUCKET                                   (new, Supabase's
//     S3-compatible Storage connection -- distinct from the app's own
//     NEXT_PUBLIC_SUPABASE_* anon-key pair used elsewhere)

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
    const {
      LIVEKIT_API_KEY: apiKey,
      LIVEKIT_API_SECRET: apiSecret,
      LIVEKIT_URL: livekitUrl,
      LIVEKIT_S3_ACCESS_KEY: accessKey,
      LIVEKIT_S3_SECRET: secret,
      LIVEKIT_S3_ENDPOINT: endpoint,
      LIVEKIT_S3_REGION: region,
      LIVEKIT_S3_BUCKET: bucket,
    } = process.env;

    if (!apiKey || !apiSecret || !livekitUrl || !accessKey || !secret || !endpoint || !region || !bucket) {
      return NextResponse.json({ error: 'Server missing egress environment variables' }, { status: 500 });
    }

    const { room } = await request.json();
    if (!room) {
      return NextResponse.json({ error: 'room is required' }, { status: 400 });
    }

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

    // opts.layout omitted -> LiveKit's own default composite layout
    // ("grid" of published tracks). Explicit here for Stage 3's stock
    // template requirement, not left implicit.
    const info = await egressClient.startRoomCompositeEgress(room, { file: output }, { layout: 'grid' });
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
