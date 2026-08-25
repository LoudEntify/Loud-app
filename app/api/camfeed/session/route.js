import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin';
import {
  REHEARSAL_TOKEN_TTL,
  SHOW_TOKEN_TTL,
  SESSION_POLL_MS,
  camfeedIdentity,
  hashDeviceSecret,
  mintCameraToken,
  pairingCapabilities,
  roomForPairing,
} from '../../../../lib/camfeedPairing';

// The paired phone's heartbeat, and the mechanism behind Phase 0b.
//
// A phone that has redeemed a code holds two things: its pairing id and a
// device secret. It presents both here every few seconds and gets back
// the room it should currently be in, a token for that room, and a
// generation number. When the artist walks out of Kit Check into a live
// show, /api/camfeed/pair's migrate action rewrites `target_room` and
// bumps `generation` — and the very next poll hands this phone a show-room
// token. The phone reconnects itself. Nobody picks it up.
//
// AUTH MODEL — stated explicitly because this route mints publish
// credentials with no user session behind it:
//   * The caller proves it is the device by presenting the secret it was
//     handed at redeem. Only the SHA-256 is stored, so this is a
//     comparison against a hash, and the database never holds anything
//     replayable.
//   * A pairing that has been revoked, or whose row is gone, gets
//     `revoked: true` and no token, which is the phone's signal to stop.
//   * There is no enumeration surface: the id alone is worthless without
//     the secret, and a wrong secret is a flat 403 regardless of whether
//     the id exists.
//   * The grant is CAMERA publish only — no mic, no data channel — so
//     even a stolen secret cannot speak in a show, only show a picture
//     the director still has to choose to cut to.
//
// PRE-MIGRATION: without docs/overnight2_01_camfeed_pairings.sql the
// columns this route reads do not exist. It answers `{ supported: false }`
// and the phone stops polling — which leaves exactly the previous
// behaviour: a phone that stays in the rehearsal room until its token
// expires.

export async function POST(request) {
  try {
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    const livekitUrl = process.env.LIVEKIT_URL;
    if (!apiKey || !apiSecret || !livekitUrl) {
      return NextResponse.json({ error: 'Server missing LiveKit environment variables' }, { status: 500 });
    }

    const { pairingId, deviceSecret } = await request.json().catch(() => ({}));
    if (!pairingId || !deviceSecret) {
      return NextResponse.json({ error: 'pairingId and deviceSecret are required' }, { status: 400 });
    }

    const admin = getSupabaseAdmin();
    const caps = await pairingCapabilities(admin);
    if (!caps.multiCamera) {
      return NextResponse.json({ supported: false, pollMs: SESSION_POLL_MS });
    }

    const { data: pairing } = await admin
      .from('camfeed_pairings')
      .select('*')
      .eq('id', pairingId)
      .maybeSingle();

    // Same answer for "no such pairing" and "wrong secret". A device that
    // guesses an id learns nothing from the response about whether it
    // guessed right.
    if (!pairing || !pairing.device_secret_hash || pairing.device_secret_hash !== hashDeviceSecret(deviceSecret)) {
      return NextResponse.json({ error: 'Not paired' }, { status: 403 });
    }

    if (pairing.revoked_at) {
      return NextResponse.json({ supported: true, revoked: true, pollMs: SESSION_POLL_MS });
    }

    const room = roomForPairing(pairing);
    const isShow = (pairing.context || 'rehearsal') === 'show';
    // Reuse the stored identity. A camera whose identity changes reads to
    // every other client in the room as this camera dropping and a
    // different one arriving — the director console would lose its shot
    // mid-show for no reason at all.
    const identity = pairing.device_identity || camfeedIdentity({ slot: pairing.slot, role: pairing.role });

    const token = await mintCameraToken({
      apiKey,
      apiSecret,
      room,
      identity,
      ttl: isShow ? SHOW_TOKEN_TTL : REHEARSAL_TOKEN_TTL,
      canSubscribe: isShow,
    });

    // Best-effort liveness. Never allowed to fail the poll — the phone
    // staying connected matters, a diagnostic column does not.
    admin
      .from('camfeed_pairings')
      .update({ last_seen_at: new Date().toISOString(), ...(pairing.device_identity ? {} : { device_identity: identity }) })
      .eq('id', pairing.id)
      .then(() => {}, () => {});

    return NextResponse.json({
      supported: true,
      revoked: false,
      room,
      token,
      url: livekitUrl,
      identity,
      slot: pairing.slot,
      role: pairing.role || null,
      context: pairing.context || 'rehearsal',
      // The phone compares this against what it last connected with. A
      // counter, not a timestamp: the comparison is exact and clock skew
      // between a phone and the server can never make it wrong.
      generation: pairing.generation ?? 1,
      pollMs: SESSION_POLL_MS,
    });
  } catch (err) {
    console.error('[camfeed/session] request failed:', err);
    return NextResponse.json({ error: 'Request failed' }, { status: 500 });
  }
}
