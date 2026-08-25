import { EgressClient } from 'livekit-server-sdk';
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin';
import { verifyArtistAuth } from '../../../../lib/verifyArtistAuth';
import { verifyEgressResult } from '../../../../lib/egressVerification';

// The same verification as the webhook, triggered by a person.
//
// NOT A LESSER FALLBACK — it is literally the same function
// (lib/egressVerification.js) with a different trigger. That matters:
// two implementations of "is this recording good" diverge, and then a
// recording is verified by one path and suspect by the other with no way
// to tell which is right.
//
// It exists because the webhook has one hard requirement the manual path
// does not: LiveKit's servers must be able to reach us. On a
// deployment-protected preview they cannot — the request is intercepted
// before it arrives. Rather than leave verification untestable until
// production, this route runs it from the artist's own session.
//
// AUTH MODEL: artist-only (`verifyArtistAuth`), and additionally scoped —
// an artist may only verify egresses for rooms belonging to THEIR OWN
// shows. Checked server-side against `shows.artist_id`, because a room
// name is a guessable string and this route reads a third party's
// recording metadata if it does not check.

export async function POST(request) {
  try {
    const auth = await verifyArtistAuth(request);
    if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    const livekitUrl = process.env.LIVEKIT_URL;
    const bucket = process.env.LIVEKIT_S3_BUCKET;
    if (!apiKey || !apiSecret || !livekitUrl) {
      return NextResponse.json({ error: 'Server missing LiveKit environment variables' }, { status: 500 });
    }

    const body = await request.json().catch(() => ({}));
    const showId = body.show_id;
    if (!showId) return NextResponse.json({ error: 'show_id is required' }, { status: 400 });

    const admin = getSupabaseAdmin();

    // OWNERSHIP. A room name is a guessable string; without this an
    // artist could ask for verification of somebody else's show and read
    // its recording metadata back in the response.
    const { data: show } = await admin
      .from('shows')
      .select('id, room_name, artist_id')
      .eq('id', showId)
      .maybeSingle();
    if (!show) return NextResponse.json({ error: 'That show could not be found.' }, { status: 404 });
    if (show.artist_id && show.artist_id !== auth.user.id) {
      return NextResponse.json({ error: 'That show belongs to another artist.' }, { status: 403 });
    }
    if (!show.room_name) {
      return NextResponse.json({ error: 'That show has no room, so it was never recorded.' }, { status: 400 });
    }

    const client = new EgressClient(
      livekitUrl.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://'),
      apiKey,
      apiSecret
    );

    // active:false — the whole point is to look at FINISHED jobs. An
    // in-flight egress has no file to check yet.
    const all = await client.listEgress({ roomName: show.room_name, active: false });
    if (!all || all.length === 0) {
      return NextResponse.json({ ok: true, results: [], note: 'LiveKit has no finished recordings for this show.' });
    }

    const results = [];
    for (const info of all) {
      // Re-verification is harmless by construction — every write is an
      // upsert on storage_path with the same computed answer — so this
      // does not skip already-verified rows. An artist pressing the
      // button after a fix expects it to actually re-check.
      const result = await verifyEgressResult(admin, info, {
        bucket,
        showId: show.id,
        artistId: show.artist_id || auth.user.id,
      });
      results.push({
        egressId: result.summary.egressId,
        storagePath: result.summary.storagePath,
        ok: result.ok,
        checks: result.checks,
      });
    }

    return NextResponse.json({
      ok: true,
      verified: results.filter((r) => r.ok).length,
      suspect: results.filter((r) => !r.ok).length,
      results,
    });
  } catch (err) {
    console.error('[egress/verify] failed:', err);
    return NextResponse.json({ error: 'Verification failed', detail: String(err?.message || err) }, { status: 500 });
  }
}
