import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin';
import { verifySession } from '../../../../lib/verifyArtistAuth';
import {
  CAMERA_ROLES,
  PAIRING_TTL_MS,
  REHEARSAL_TOKEN_TTL,
  SHOW_TOKEN_TTL,
  camfeedIdentity,
  hashDeviceSecret,
  mintCameraToken,
  newDeviceSecret,
  pairingCapabilities,
  pairingCode,
  rehearsalRoom,
  roomForPairing,
} from '../../../../lib/camfeedPairing';

// Camera pairing — ONE mechanism, both contexts.
//
// Kit Check and the live show used to pair cameras two different ways.
// Kit Check minted a six-character code; the live show printed three QR
// codes containing bare `/cam?room=…&slot=…&role=…` URLs with no
// credential in them at all, which meant anyone who could read the QR off
// a stream could join the show room as a camera. Both are gone. There is
// now one path — mint a pairing row, hand out a code, redeem the code —
// and the QR is simply that code rendered as a picture.
//
// ⚠️ THIS IS THE DOCUMENTED EXCEPTION TO KIT CHECK'S ZERO-LIVEKIT RULE.
// Kit Check is otherwise entirely local. Pairing a second camera and
// seeing the composed view genuinely requires moving video between two
// devices, and doing that ourselves would mean building a signalling
// path plus TURN. The exception is bounded rather than open: codes
// expire, codes are single-use, tokens carry a hard TTL, and a paired
// device gets CAMERA publish rights only.
//
// ACTIONS (all POST; the artist ones need Authorization: Bearer <token>)
//   { code }                             device redeems a code — NO AUTH,
//                                        by design: this pairs a DEVICE,
//                                        not a person.
//   { action:'start' }                   artist's own token for their
//                                        rehearsal room.
//   { action:'invite', role, slot,
//     context, show_id, room }           mint one pairing code for one
//                                        camera. Called once per camera.
//   { action:'list' }                    the artist's live rig.
//   { action:'migrate', show_id, room }  point every live pairing at the
//                                        show room. THIS IS PHASE 0b.
//   { action:'revoke', id }              pull one camera.
//   { slot, show_id }  (no action)       legacy shape, unchanged: start +
//                                        one invite in a single response.
//
// PRE-MIGRATION: every multi-camera capability is gated on
// pairingCapabilities(). Without docs/overnight2_01_camfeed_pairings.sql
// this route behaves exactly as it did before tonight and says so in the
// response (`degraded: true`), which the UI renders as a plain sentence
// rather than an error.

const MAX_LIVE_PAIRINGS = 6;

function requireLiveKitEnv() {
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const livekitUrl = process.env.LIVEKIT_URL;
  if (!apiKey || !apiSecret || !livekitUrl) return null;
  return { apiKey, apiSecret, livekitUrl };
}

function publicPairing(row) {
  return {
    id: row.id,
    code: row.code,
    slot: row.slot,
    role: row.role || null,
    context: row.context || 'rehearsal',
    expiresAt: row.expires_at,
    pairedAt: row.used_at || null,
    lastSeenAt: row.last_seen_at || null,
    generation: row.generation ?? 1,
    targetRoom: row.target_room || null,
  };
}

export async function POST(request) {
  try {
    const env = requireLiveKitEnv();
    if (!env) {
      return NextResponse.json({ error: 'Server missing LiveKit environment variables' }, { status: 500 });
    }
    const { apiKey, apiSecret, livekitUrl } = env;

    const body = await request.json().catch(() => ({}));
    const admin = getSupabaseAdmin();
    const caps = await pairingCapabilities(admin);

    // ── Device redeeming a code (no auth — the code IS the claim) ──
    if (body.code) {
      return redeemCode({ admin, caps, body, apiKey, apiSecret, livekitUrl });
    }

    // ── Everything below is the artist's own rig ───────────────
    const auth = await verifySession(request);
    if (auth.error) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    const userId = auth.user.id;
    const action = body.action || 'legacy';

    if (action === 'start') {
      return NextResponse.json({
        ...(await artistRehearsalSession({ userId, apiKey, apiSecret, livekitUrl })),
        degraded: !caps.multiCamera,
      });
    }

    if (action === 'list') {
      if (!caps.multiCamera) return NextResponse.json({ pairings: [], degraded: true });
      const { data } = await admin
        .from('camfeed_pairings')
        .select('*')
        .eq('created_by', userId)
        .is('revoked_at', null)
        .order('created_at', { ascending: true });
      return NextResponse.json({ pairings: (data || []).map(publicPairing), degraded: false });
    }

    if (action === 'invite') {
      return createInvite({ admin, caps, body, userId });
    }

    if (action === 'migrate') {
      return migrateToShow({ admin, caps, body, userId });
    }

    if (action === 'revoke') {
      if (!caps.multiCamera) return NextResponse.json({ ok: true, degraded: true });
      // Scoped to the caller's own rows. A revoke of somebody else's
      // camera is not an error the caller gets to distinguish from a
      // no-op — it simply matches nothing.
      await admin
        .from('camfeed_pairings')
        .update({ revoked_at: new Date().toISOString() })
        .eq('id', body.id)
        .eq('created_by', userId);
      return NextResponse.json({ ok: true });
    }

    // ── Legacy shape: one call, one code, artist token included ────
    // Kept working verbatim so nothing that already calls this breaks.
    const invite = await createInvite({
      admin,
      caps,
      body: { role: body.role || 'wide', slot: body.slot, show_id: body.show_id, context: 'rehearsal' },
      userId,
      raw: true,
    });
    if (invite.error) return NextResponse.json({ error: invite.error }, { status: invite.status || 500 });

    const session = await artistRehearsalSession({ userId, apiKey, apiSecret, livekitUrl });
    return NextResponse.json({
      ...session,
      code: invite.pairing.code,
      expiresAt: invite.pairing.expires_at,
      slot: invite.pairing.slot,
      pairingId: invite.pairing.id,
      degraded: !caps.multiCamera,
    });
  } catch (err) {
    console.error('[camfeed/pair] request failed:', err);
    return NextResponse.json({ error: 'Request failed' }, { status: 500 });
  }
}

// ─── the artist's own seat in their rehearsal room ─────────────
// Publishes their camera so the composed view is a real composition
// rather than the paired phones on their own.
async function artistRehearsalSession({ userId, apiKey, apiSecret, livekitUrl }) {
  const room = rehearsalRoom(userId);
  const identity = `contestant-a-rehearsal-${randomUUID().slice(0, 8)}`;
  const at = await mintCameraToken({
    apiKey,
    apiSecret,
    room,
    identity,
    ttl: REHEARSAL_TOKEN_TTL,
    canSubscribe: true,
  });
  return {
    token: at,
    url: livekitUrl,
    room,
    identity,
    // Surfaced so the UI can show a countdown rather than silently
    // dropping the artist out of the room.
    sessionSeconds: 20 * 60,
  };
}

// ─── mint one pairing code for one camera ──────────────────────
async function createInvite({ admin, caps, body, userId, raw = false }) {
  const slot = String(body.slot || 'a').toLowerCase();
  const role = CAMERA_ROLES.includes(body.role) ? body.role : 'wide';
  const context = body.context === 'show' ? 'show' : 'rehearsal';
  const expiresAt = new Date(Date.now() + PAIRING_TTL_MS).toISOString();

  if (caps.multiCamera) {
    // A rig, not a farm. Six is more cameras than any artist in this
    // pilot will prop, and it stops a stuck loop minting codes forever.
    const { count } = await admin
      .from('camfeed_pairings')
      .select('id', { count: 'exact', head: true })
      .eq('created_by', userId)
      .is('revoked_at', null);
    if ((count ?? 0) >= MAX_LIVE_PAIRINGS) {
      const err = { error: `You already have ${MAX_LIVE_PAIRINGS} cameras paired. Remove one first.`, status: 409 };
      return raw ? err : NextResponse.json({ error: err.error }, { status: err.status });
    }
  }

  // show_id is OMITTED rather than sent as null when there is no
  // upcoming show. A rehearsal is not tied to a show — an artist should
  // be able to pair a camera before scheduling anything — and omitting
  // lets a column default apply if one is ever added.
  const base = { slot, code: pairingCode(), created_by: userId, expires_at: expiresAt };
  if (body.show_id) base.show_id = body.show_id;

  const row = caps.multiCamera
    ? { ...base, role, context, target_room: body.room || null, generation: 1 }
    : base;

  const { data, error } = await admin.from('camfeed_pairings').insert(row).select().single();
  if (error) {
    console.error('[camfeed/pair] insert failed:', error);
    // The real Postgres message goes back to the caller. A generic
    // "Could not create a pairing code" is what cost a previous test
    // sitting: the actual cause was a NOT NULL on show_id, which the
    // message would have named immediately. Nothing here is sensitive —
    // it is the caller's own failed write.
    const message = /relation .* does not exist|schema cache/i.test(error.message || '')
      ? 'Camera pairing needs docs/show_access_migration.sql to be run first.'
      : `Could not create a pairing code — ${error.message}`;
    const err = { error: message, status: 500 };
    return raw ? err : NextResponse.json({ error: message }, { status: 500 });
  }

  if (raw) return { pairing: data };
  return NextResponse.json({ pairing: publicPairing(data), degraded: !caps.multiCamera });
}

// ─── PHASE 0b: the handover ────────────────────────────────────
// Kit Check calls this at countdown-zero, immediately before pushing the
// artist to /live. It rewrites `target_room` on every one of this
// artist's live pairings and bumps `generation`. Each paired phone is
// polling /api/camfeed/session; within one poll interval it sees a
// generation it hasn't seen, tears down its connection to the rehearsal
// room and reconnects to the show room with the token this write made
// available. Nobody touches a phone.
//
// Why an artist-initiated UPDATE and not something automatic: the show
// room's name is only knowable once a specific show is resolved, and the
// artist's own client is the one thing that definitely knows which show
// it is walking into. A server-side scheduler would have to guess, and
// guessing wrong puts a camera in somebody else's broadcast.
async function migrateToShow({ admin, caps, body, userId }) {
  if (!caps.multiCamera) {
    // Honest, not silent. The Kit Check UI turns this into a sentence
    // telling the artist their paired phones will need re-pairing once
    // they are live — which is the truth of the pre-migration state.
    return NextResponse.json({ migrated: 0, degraded: true });
  }

  let room = body.room || null;
  if (!room && body.show_id) {
    const { data: show } = await admin
      .from('shows')
      .select('id, room_name, artist_id')
      .eq('id', body.show_id)
      .maybeSingle();
    // Ownership is checked HERE, not on the client. Migrating cameras
    // into a room means publishing into a broadcast; the only person who
    // may do that is the artist whose show it is.
    if (!show) return NextResponse.json({ error: 'That show could not be found.' }, { status: 404 });
    if (show.artist_id && show.artist_id !== userId) {
      return NextResponse.json({ error: 'That show belongs to another artist.' }, { status: 403 });
    }
    room = show.room_name;
  }
  if (!room) {
    return NextResponse.json({ error: 'A show id or room name is required.' }, { status: 400 });
  }

  const { data: live } = await admin
    .from('camfeed_pairings')
    .select('*')
    .eq('created_by', userId)
    .is('revoked_at', null);

  const targets = (live || []).filter((p) => p.target_room !== room);
  // Row-by-row rather than one bulk UPDATE because `generation + 1` needs
  // each row's own current value, and PostgREST has no expression-update.
  // At most MAX_LIVE_PAIRINGS rows — the loop is bounded and tiny.
  for (const p of targets) {
    await admin
      .from('camfeed_pairings')
      .update({
        target_room: room,
        generation: (p.generation ?? 1) + 1,
        context: 'show',
        // The pairing code is long dead by now (single-use), but push the
        // window out anyway so a phone that reconnects late in a long
        // show is never refused for an expiry that stopped meaning
        // anything the moment it was redeemed.
        expires_at: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
        ...(body.show_id ? { show_id: body.show_id } : {}),
      })
      .eq('id', p.id)
      .eq('created_by', userId);
  }

  return NextResponse.json({ migrated: targets.length, room, degraded: false });
}

// ─── device redeems a code ─────────────────────────────────────
async function redeemCode({ admin, caps, body, apiKey, apiSecret, livekitUrl }) {
  const code = String(body.code).trim().toUpperCase();
  const { data: pairing } = await admin
    .from('camfeed_pairings')
    .select('*')
    .eq('code', code)
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
  if (caps.multiCamera && pairing.revoked_at) {
    return NextResponse.json({ error: 'That camera was removed. Ask for a new code.' }, { status: 410 });
  }

  const room = roomForPairing(pairing);
  const identity = camfeedIdentity({ slot: pairing.slot, role: pairing.role });
  const isShow = (pairing.context || 'rehearsal') === 'show';

  // Mark used FIRST. If token minting fails after this the artist mints a
  // new code, which is a small annoyance; the reverse ordering would let
  // a code that already produced a working token be redeemed twice.
  const redeemPatch = { used_at: new Date().toISOString() };
  let deviceSecret = null;
  if (caps.multiCamera) {
    deviceSecret = newDeviceSecret();
    redeemPatch.device_secret_hash = hashDeviceSecret(deviceSecret);
    redeemPatch.device_identity = identity;
    redeemPatch.last_seen_at = new Date().toISOString();
  }
  await admin.from('camfeed_pairings').update(redeemPatch).eq('id', pairing.id);

  const token = await mintCameraToken({
    apiKey,
    apiSecret,
    room,
    identity,
    ttl: isShow ? SHOW_TOKEN_TTL : REHEARSAL_TOKEN_TTL,
    canSubscribe: isShow,
  });

  return NextResponse.json({
    token,
    url: livekitUrl,
    room,
    slot: pairing.slot,
    role: pairing.role || null,
    context: pairing.context || 'rehearsal',
    // The two values the phone needs to keep following this pairing.
    // Absent pre-migration, which is exactly how the phone knows not to
    // bother polling.
    pairingId: caps.multiCamera ? pairing.id : null,
    deviceSecret,
    generation: pairing.generation ?? 1,
  });
}
