import { NextResponse } from 'next/server';
import { RoomServiceClient } from 'livekit-server-sdk';
import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin';
import { verifyArtistAuth } from '../../../../lib/verifyArtistAuth';
import { verifyShowOwner } from '../../../../lib/verifyShowOwner';

// ── ITEM 8 LAYER B: ACTUALLY END THE SHOW ─────────────────────
//
// THE COST BUG. Pilot 1 left 2.54GB up / 12.8GB down of waste in a room
// nobody was watching, including one camera publishing for 5h39m. End
// Show ended the show for everybody who was LISTENING — it broadcast
// SHOW_ENDED over the data channel — and did nothing at all to devices
// that had stopped listening, or had never been listening, or whose page
// had been closed with the camera still publishing.
//
// Deleting the room is the only teardown that does not depend on the
// thing being torn down cooperating.
//
// AUTH MODEL: artist bearer (verifyArtistAuth) AND ownership of this
// specific room (verifyShowOwner). Both, not either. Deleting a LiveKit
// room evicts every participant instantly, so this is the most
// destructive endpoint in the product and the only caller who may use it
// is the artist whose show it is.
//
// IDEMPOTENT. Safe to call from three devices at once and safe to call
// on a room that is already gone — deleteRoom on a non-existent room is
// a no-op at the service, and any error from it is reported without
// being treated as a failure of the show. The caller is a client that
// has already decided the show is over; there is nothing useful it could
// do with a failure, and nothing it should retry.

const REASONS = new Set(['end_show', 'window_closed', 'manual']);

function requireLiveKitEnv() {
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const livekitUrl = process.env.LIVEKIT_URL;
  if (!apiKey || !apiSecret || !livekitUrl) return null;
  return { apiKey, apiSecret, livekitUrl };
}

export async function POST(request) {
  try {
    const env = requireLiveKitEnv();
    if (!env) {
      return NextResponse.json({ error: 'Server missing LiveKit environment variables' }, { status: 500 });
    }

    const body = await request.json().catch(() => ({}));
    const room = body.room;
    // Free-form reasons are not accepted: this string ends up in
    // health_events as the explanation for why a live room was torn
    // down, and an unbounded value there is one typo away from being
    // unsearchable on the 21st.
    const reason = REASONS.has(body.reason) ? body.reason : 'manual';
    if (!room) return NextResponse.json({ error: 'room is required' }, { status: 400 });

    const auth = await verifyArtistAuth(request);
    if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const admin = getSupabaseAdmin();
    const owner = await verifyShowOwner(admin, room, auth.user);
    if (owner.error) return NextResponse.json({ error: owner.error }, { status: owner.status });

    const svc = new RoomServiceClient(env.livekitUrl, env.apiKey, env.apiSecret);

    let deleted = false;
    let detail = null;
    try {
      await svc.deleteRoom(room);
      deleted = true;
    } catch (err) {
      // A room that does not exist is the DESIRED state, not a failure.
      // LiveKit reports it as an error, so the only honest thing to do is
      // record what happened and still answer ok — the caller wanted the
      // room gone and the room is gone.
      detail = String(err?.message || err);
    }

    // ── CLOSE OUT OPEN VIEWER SESSIONS (item 4) ───────────────
    //
    // This exists because item 9 was CUT. The plan ranked the
    // participant_left webhook as authoritative and demoted the sweep to
    // unnecessary on that basis. With the webhook deferred to the 22nd,
    // the beacon is the only leave source -- and the beacon does not
    // fire on every mobile kill path. Without this, a viewer whose phone
    // was locked or whose tab was evicted has left_at NULL forever, and
    // their watch time is not "unknown", it is silently unbounded.
    //
    // 'sweep' is an UPPER BOUND and is labelled as one, exactly like
    // shows.ended_by = 'window_sweep'. All this knows is that the room
    // was torn down at this moment and the session had not closed
    // itself; the viewer may have left an hour earlier. Analysis on the
    // 21st must treat sweep-closed sessions as a ceiling, not a
    // measurement, which is only possible because the label is there.
    //
    // `.is('left_at', null)` preserves the source ranking: a real beacon
    // (and, from the 22nd, a webhook) always wins over this.
    //
    // Best-effort and never allowed to fail the close: the room being
    // gone is the point of this endpoint, and a diagnostic column must
    // not stand between the artist and the end of the bill.
    let sessionsSwept = null;
    try {
      const { data: swept, error: sweepErr } = await admin
        .from('viewer_sessions')
        .update({ left_at: new Date().toISOString(), left_source: 'sweep' })
        .eq('show_id', owner.show.id)
        .is('left_at', null)
        .select('id');
      sessionsSwept = sweepErr ? null : (swept?.length ?? 0);
      if (sweepErr) console.warn('[room/close] viewer-session sweep failed:', sweepErr);
    } catch (e) {
      console.warn('[room/close] viewer-session sweep threw:', e);
    }

    return NextResponse.json({ ok: true, room, reason, deleted, detail, sessionsSwept });
  } catch (err) {
    console.warn('[room/close] request failed:', err);
    return NextResponse.json({ error: 'Could not close the room.', detail: String(err?.message || err) }, { status: 500 });
  }
}
