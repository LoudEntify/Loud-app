import { NextResponse } from 'next/server';
import { WebhookReceiver } from 'livekit-server-sdk';
import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin';
import { verifyEgressResult } from '../../../../lib/egressVerification';

// LiveKit's egress webhook — the automatic trigger for "did the
// recording actually work".
//
// AUTH MODEL: there is no session, and there cannot be — the caller is
// LiveKit's own server. What replaces it is LiveKit's signature scheme,
// checked by their own `WebhookReceiver`: the Authorization header
// carries a JWT signed with the project's API secret whose `sha256` claim
// must match a hash of the body. `receive()` verifies both, and throws if
// either fails. Nothing is written before it returns.
//
// ── THE RAW BODY, AGAIN ──
// Read as TEXT and passed through unmodified, because the signature
// covers a hash of these exact bytes. Parsing to JSON and re-serialising
// changes whitespace and key order and the hash will never match again.
// Same trap as the payments webhook, same note next to the same line.
//
// ── IDEMPOTENCY ──
// Every write in the verification path is an upsert on `storage_path`
// (the natural key), so a redelivered `egress_ended` re-runs the checks
// and overwrites the same row with the same answer. Re-verification is
// harmless by construction, which is why this route does not need its own
// event-dedupe table the way the payments webhook does — there is no
// balance to double.
//
// ── REACHABILITY, STATED PLAINLY ──
// LiveKit's servers must be able to POST here. On a deployment-protected
// preview they cannot: the request is intercepted before it reaches this
// route. That is why `app/api/egress/verify` exists and runs the
// IDENTICAL checks from a signed-in artist's own session — the webhook is
// the automatic path, and the manual one is not a lesser fallback but the
// same function with a different trigger.

export async function POST(request) {
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const bucket = process.env.LIVEKIT_S3_BUCKET;

  if (!apiKey || !apiSecret) {
    return NextResponse.json({ error: 'Server missing LiveKit environment variables' }, { status: 500 });
  }

  let rawBody;
  try {
    rawBody = await request.text();
  } catch {
    return NextResponse.json({ error: 'Unreadable body' }, { status: 400 });
  }

  let event;
  try {
    const receiver = new WebhookReceiver(apiKey, apiSecret);
    event = await receiver.receive(rawBody, request.headers.get('authorization'));
  } catch (err) {
    console.warn('[egress/webhook] signature verification failed:', err?.message || err);
    // 400, not 401. There are no credentials to retry with, and a 4xx
    // tells LiveKit not to redeliver — correct for a signature that will
    // never start matching.
    return NextResponse.json({ error: 'Signature verification failed' }, { status: 400 });
  }

  // Only the terminal one. `egress_started` and `egress_updated` are
  // real events and there is nothing useful to check while a file is
  // still being written.
  if (event?.event !== 'egress_ended') {
    return NextResponse.json({ ok: true, ignored: event?.event || 'unknown' });
  }

  const admin = getSupabaseAdmin();
  const info = event.egressInfo || event.egress_info;

  if (!info) {
    return NextResponse.json({ ok: true, ignored: 'no egressInfo on event' });
  }

  try {
    // The room name is the join back to the show. Every scheduled show
    // owns a room minted at schedule time, so this resolves to exactly
    // one row — unlike the era when every show shared 'pilot-room'.
    const roomName = info.roomName || info.room_name || null;
    let showId = null;
    let artistId = null;
    if (roomName) {
      const { data: show } = await admin
        .from('shows')
        .select('id, artist_id')
        .eq('room_name', roomName)
        .order('slated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      showId = show?.id || null;
      artistId = show?.artist_id || null;
    }

    const result = await verifyEgressResult(admin, info, { bucket, showId, artistId });

    // 200 either way. A suspect recording is a successful verification —
    // returning a 5xx would make LiveKit redeliver an event we handled
    // perfectly well, and the answer would not change.
    return NextResponse.json({ ok: true, verified: result.ok, checks: result.checks });
  } catch (err) {
    console.error('[egress/webhook] verification failed:', err);
    // 500 here IS right: we could not complete the check, and a
    // redelivery genuinely might succeed.
    return NextResponse.json({ error: 'Verification failed' }, { status: 500 });
  }
}
