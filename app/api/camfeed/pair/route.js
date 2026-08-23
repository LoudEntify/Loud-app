import { AccessToken, TrackSource } from 'livekit-server-sdk';
import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin';
import { verifySession } from '../../../../lib/verifyArtistAuth';

// Camfeed device pairing.
//
// POST { slot }        — artist mints a short-lived pairing code and gets
//                        their own token for the REHEARSAL room.
// POST { code }        — a device redeems that code for a camera-only
//                        token. No account required: this pairs a DEVICE,
//                        not a person (see DECISIONS.md).
//
// ⚠️ THIS IS THE DOCUMENTED EXCEPTION TO THE ZERO-LIVEKIT RULE.
// Kit Check is otherwise entirely local. Pairing a second camera and
// seeing the composed view genuinely requires moving video between two
// devices, and doing that ourselves would mean building a signalling
// path plus TURN — see the decision log for why that was rejected.
//
// The exception is BOUNDED rather than open:
//   * the room is a rehearsal room, never the show room
//   * pairing codes expire in PAIRING_TTL_MS and are single use
//   * tokens carry a hard TTL, so the room cannot outlive the rehearsal
//     even if a client never disconnects cleanly
//   * the device gets CAMERA publish rights only — no mic, no data
const PAIRING_TTL_MS = 10 * 60 * 1000;      // code is redeemable for 10 minutes
const REHEARSAL_TOKEN_TTL = '20m';           // the room dies with the tokens

function rehearsalRoom(userId) {
  // Deliberately namespaced away from show rooms so a rehearsal can
  // never be mistaken for, or collide with, a real broadcast.
  return `rehearsal-${userId}`;
}

function code6() {
  // Ambiguous characters removed: someone is typing this off a screen,
  // possibly in bad light, onto a phone.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
}

export async function POST(request) {
  try {
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    const livekitUrl = process.env.LIVEKIT_URL;
    if (!apiKey || !apiSecret || !livekitUrl) {
      return NextResponse.json({ error: 'Server missing LiveKit environment variables' }, { status: 500 });
    }

    const body = await request.json().catch(() => ({}));

    // ── Device redeeming a code ───────────────────────────────
    if (body.code) {
      const admin = getSupabaseAdmin();
      const { data: pairing } = await admin
        .from('camfeed_pairings')
        .select('*')
        .eq('code', String(body.code).trim().toUpperCase())
        .maybeSingle();

      if (!pairing) {
        return NextResponse.json({ error: 'That pairing code is not valid.' }, { status: 404 });
      }
      if (pairing.used_at) {
        return NextResponse.json({ error: 'That pairing code has already been used.' }, { status: 409 });
      }
      if (new Date(pairing.expires_at).getTime() < Date.now()) {
        return NextResponse.json({ error: 'That pairing code has expired. Generate a new one.' }, { status: 410 });
      }

      await admin.from('camfeed_pairings').update({ used_at: new Date().toISOString() }).eq('id', pairing.id);

      const identity = `camfeed-${pairing.slot}-rehearsal-${randomUUID().slice(0, 8)}`;
      const at = new AccessToken(apiKey, apiSecret, { identity, ttl: REHEARSAL_TOKEN_TTL });
      at.addGrant({
        room: rehearsalRoom(pairing.created_by),
        roomJoin: true,
        canPublish: true,
        // Camera only. A paired phone is a lens, not a participant: no
        // microphone (it would double the room's audio and feed back)
        // and no data channel (it has no business sending shot commands).
        canPublishSources: [TrackSource.CAMERA],
        canSubscribe: false,
        canPublishData: false,
      });

      return NextResponse.json({
        token: await at.toJwt(),
        url: livekitUrl,
        room: rehearsalRoom(pairing.created_by),
        slot: pairing.slot,
      });
    }

    // ── Artist minting a code ─────────────────────────────────
    const auth = await verifySession(request);
    if (auth.error) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const slot = (body.slot || 'a').toLowerCase();
    const admin = getSupabaseAdmin();
    const code = code6();
    const expiresAt = new Date(Date.now() + PAIRING_TTL_MS).toISOString();

    const { error: insErr } = await admin.from('camfeed_pairings').insert({
      show_id: body.show_id || null,
      slot,
      code,
      created_by: auth.user.id,
      expires_at: expiresAt,
    });
    if (insErr) {
      console.error('[camfeed/pair] insert failed:', insErr);
      return NextResponse.json(
        { error: /relation .* does not exist|schema cache/i.test(insErr.message || '')
            ? 'Camera pairing needs docs/show_access_migration.sql to be run first.'
            : 'Could not create a pairing code.' },
        { status: 500 }
      );
    }

    // The artist's own token for the same rehearsal room. Publishes their
    // camera so the composed view is a real composition, not the paired
    // phone on its own.
    const identity = `contestant-${slot}-rehearsal-${randomUUID().slice(0, 8)}`;
    const at = new AccessToken(apiKey, apiSecret, { identity, ttl: REHEARSAL_TOKEN_TTL });
    at.addGrant({
      room: rehearsalRoom(auth.user.id),
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    return NextResponse.json({
      code,
      expiresAt,
      token: await at.toJwt(),
      url: livekitUrl,
      room: rehearsalRoom(auth.user.id),
      slot,
      // Surfaced so the UI can show a countdown rather than silently
      // dropping the artist out of the room.
      sessionSeconds: 20 * 60,
    });
  } catch (err) {
    console.error('[camfeed/pair] request failed:', err);
    return NextResponse.json({ error: 'Request failed' }, { status: 500 });
  }
}
