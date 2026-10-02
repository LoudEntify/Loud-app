// POST /api/artist/invite/accept { token } — accept a Versus invite (PRD 116).
// Marks slot b as claimed on show_slots (the pilot's mechanics) and sets
// shows.artist_b_id (Phase 2's denormalised answer to "who is B"). Audited.
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../../lib/supabaseAdmin';
import { verifyArtistAuth } from '../../../../../lib/verifyArtistAuth';
import { correlationFrom, withCorrelation } from '../../../../../lib/correlation';
import { recordAuditEvent } from '../../../../../lib/audit';
import { createBroadcastsForShow } from '../../../../../lib/pipeline/lifecycle';
import { supabaseLifecycleStore } from '../../../../../lib/pipeline/store';

export async function POST(request) {
  const cid = correlationFrom(request);
  const auth = await verifyArtistAuth(request);
  if (auth.error) return withCorrelation(NextResponse.json({ error: auth.error }, { status: auth.status }), cid);
  let body; try { body = await request.json(); } catch { body = {}; }
  const admin = getSupabaseAdmin();
  const { data: slot } = await admin.from('show_slots').select('show_id, slot, invited_user_id, claimed_by_user_id').eq('invite_token', body.token || '').maybeSingle();
  if (!slot) return withCorrelation(NextResponse.json({ error: 'This invite is no longer valid.' }, { status: 404 }), cid);
  if (slot.invited_user_id && slot.invited_user_id !== auth.user.id) return withCorrelation(NextResponse.json({ error: 'This invite was sent to someone else.' }, { status: 403 }), cid);
  if (slot.claimed_by_user_id && slot.claimed_by_user_id !== auth.user.id) return withCorrelation(NextResponse.json({ error: 'Someone already accepted this invite.' }, { status: 409 }), cid);
  const { data: show } = await admin.from('shows').select('id, artist_id, slated_at, cancelled_at').eq('id', slot.show_id).maybeSingle();
  if (!show || show.cancelled_at) return withCorrelation(NextResponse.json({ error: 'This show was cancelled.' }, { status: 410 }), cid);
  if (show.artist_id === auth.user.id) return withCorrelation(NextResponse.json({ error: 'This is your own show.' }, { status: 409 }), cid);
  await admin.from('show_slots').update({ claimed_by_user_id: auth.user.id, invited_user_id: auth.user.id, invite_accepted_at: new Date().toISOString() }).eq('show_id', slot.show_id).eq('slot', 'b');
  await admin.from('shows').update({ artist_b_id: auth.user.id }).eq('id', show.id);
  await admin.from('notifications').upsert({ user_id: show.artist_id, kind: 'system', body: `${auth.profile.display_name} accepted your Versus invite`, href: `/artist/console/${show.id}`, dedupe_key: `versus_accepted:${show.id}` }, { onConflict: 'user_id,dedupe_key' });
  await recordAuditEvent(admin, { actorType: 'artist', actorId: auth.user.id, action: 'show.versus_invite_accepted', subjectType: 'show', subjectId: show.id, correlationId: cid });
  // the second channel's broadcast is created now that B is known
  await createBroadcastsForShow(supabaseLifecycleStore(admin), { showId: show.id, correlationId: cid });
  return withCorrelation(NextResponse.json({ ok: true, showId: show.id }), cid);
}
