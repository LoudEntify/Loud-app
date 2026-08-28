import { EgressClient } from 'livekit-server-sdk';
import { EgressStatus } from '@livekit/protocol';
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin';
import { verifyArtistAuth } from '../../../../lib/verifyArtistAuth';
import { verifyShowOwner } from '../../../../lib/verifyShowOwner';

// AUTH MODEL: the verified artist who owns the show running in this room.
//
// Security round finding 2 (docs/SECURITY_AUDIT_2026-08-28.md). This
// route had no authentication of any kind, and `room_name` is not a
// secret: components/LiveDemo.jsx resolves a show with select('*')
// through the anon client, so every viewer of a public show link already
// has the one input this needed.
//
// Of the two egress routes this is the one with teeth. Starting a
// recording nobody wanted costs money. Stopping one costs the
// PERFORMANCE — a stopped recording is not re-recordable, and the artist
// finds out afterwards.

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
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    const livekitUrl = process.env.LIVEKIT_URL;

    if (!apiKey || !apiSecret || !livekitUrl) {
      return NextResponse.json({ error: 'Server missing LiveKit environment variables' }, { status: 500 });
    }

    const { room } = await request.json();
    if (!room) {
      return NextResponse.json({ error: 'room is required' }, { status: 400 });
    }

    // ORDER MATTERS: identity first, then ownership, then act. Nothing
    // touches LiveKit until both have passed — a caller who fails the
    // check must not be able to learn from a timing difference whether a
    // room has an active recording.
    const auth = await verifyArtistAuth(request);
    if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const admin = getSupabaseAdmin();
    const owner = await verifyShowOwner(admin, room, auth.user);
    if (owner.error) return NextResponse.json({ error: owner.error }, { status: owner.status });

    const egressClient = new EgressClient(toHttpUrl(livekitUrl), apiKey, apiSecret);

    // Looked up by room name rather than a persisted egress ID -- this
    // pilot is single-show-per-room, so "whatever's active for this room"
    // is unambiguous and avoids a DB column just to remember an ID.
    const active = await egressClient.listEgress({ roomName: room, active: true });
    if (active.length === 0) {
      return NextResponse.json({ ok: true, stopped: false }); // nothing recording -- not an error
    }

    // stopEgress resolves with the EgressInfo at the moment the stop
    // command was issued -- status is often still EGRESS_ENDING here
    // rather than the final COMPLETE/FAILED, since file finalization +
    // the S3 upload finish shortly after this call returns. If status
    // isn't COMPLETE, the real outcome (including a bad-credential/bucket
    // failure) needs a follow-up listEgress({ egressId }) a few seconds
    // later, or LiveKit Cloud's own egress dashboard -- there's no
    // webhook wired up in this pilot to push that update to us.
    const results = await Promise.all(active.map((e) => egressClient.stopEgress(e.egressId)));
    return NextResponse.json({ ok: true, stopped: true, egresses: results.map(describeEgress) });
  } catch (err) {
    console.error('[egress] stop failed:', err);
    return NextResponse.json(
      { error: 'Egress stop failed', detail: String(err?.message || err) },
      { status: 500 }
    );
  }
}
