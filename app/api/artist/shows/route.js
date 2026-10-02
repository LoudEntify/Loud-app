// POST /api/artist/shows — book a show (PRD 115, 116, 117). Server-side
// validation of the 30-minute rule, the length, the title; the broadcast
// is created at scheduling (PRD 141); reminders still in the future are
// written; a Versus invite reuses the pilot's show_slots mechanics.
// GET lists the artist's own shows.
import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin';
import { verifyArtistAuth } from '../../../../lib/verifyArtistAuth';
import { correlationFrom, withCorrelation } from '../../../../lib/correlation';
import { validateBooking, reminderOffsetsDue } from '../../../../lib/schedule';
import { createBroadcastsForShow } from '../../../../lib/pipeline/lifecycle';
import { supabaseLifecycleStore } from '../../../../lib/pipeline/store';
import { recordAuditEvent } from '../../../../lib/audit';
import { youtubeMode } from '../../../../lib/youtube/api';

export async function GET(request) {
  const cid = correlationFrom(request);
  const auth = await verifyArtistAuth(request);
  if (auth.error) return withCorrelation(NextResponse.json({ error: auth.error }, { status: auth.status }), cid);
  const admin = getSupabaseAdmin();
  const { data } = await admin.from('shows').select('*').or(`artist_id.eq.${auth.user.id},artist_b_id.eq.${auth.user.id}`).order('slated_at', { ascending: false }).limit(50);
  return withCorrelation(NextResponse.json({ shows: data || [] }), cid);
}

export async function POST(request) {
  const cid = correlationFrom(request);
  const auth = await verifyArtistAuth(request);
  if (auth.error) return withCorrelation(NextResponse.json({ error: auth.error }, { status: auth.status }), cid);
  let body; try { body = await request.json(); } catch { body = {}; }
  const v = validateBooking(body);
  if (!v.ok) return withCorrelation(NextResponse.json({ errors: v.errors }, { status: 400 }), cid);
  const { values } = v;
  const admin = getSupabaseAdmin();
  let inviteeId = values.inviteeId;
  if (values.mode === 'versus' && !inviteeId && values.inviteeUsername) {
    const { data: p } = await admin.from('public_profiles').select('id, role').eq('username', String(values.inviteeUsername).toLowerCase().replace(/^@/, '')).maybeSingle();
    if (!p || p.role !== 'artist') return withCorrelation(NextResponse.json({ errors: { invitee: 'No artist with that username.' } }, { status: 400 }), cid);
    inviteeId = p.id;
  }
  if (inviteeId === auth.user.id) return withCorrelation(NextResponse.json({ errors: { invitee: 'You cannot invite yourself.' } }, { status: 400 }), cid);
  const row = {
    artist_id: auth.user.id, artist_name: auth.profile.display_name, room_name: `show-${randomUUID().slice(0, 8)}`, slated_at: values.startAt, state: 'scheduled',
    title: values.title, performance_mode: values.mode, duration_minutes: values.minutes, genre: values.genre, description: values.description, cover_url: values.coverUrl,
    delivery: youtubeMode() === 'google' ? 'youtube' : (process.env.NEXT_PUBLIC_PLAYER_SOURCE_OVERRIDE || 'fixture'), place_id: values.placeId, visibility: 'public',
  };
  const { data: show, error } = await admin.from('shows').insert(row).select('*').single();
  if (error) return withCorrelation(NextResponse.json({ error: 'Could not book the show. Try again.' }, { status: 500 }), cid);
  // Versus: invite through show_slots (pilot mechanics) + notification
  let inviteToken = null;
  if (values.mode === 'versus' && inviteeId) {
    inviteToken = randomUUID();
    const { data: invitee } = await admin.from('public_profiles').select('username, display_name').eq('id', inviteeId).maybeSingle();
    await admin.from('show_slots').upsert({ show_id: show.id, slot: 'b', invite_token: inviteToken, invited_user_id: inviteeId, invited_username: invitee?.username || null }, { onConflict: 'show_id,slot' });
    await admin.from('notifications').upsert({ user_id: inviteeId, kind: 'versus_invite', body: `${auth.profile.display_name} invited you to a Versus show: ${values.title}`, href: `/artist/invite/${inviteToken}`, dedupe_key: `versus_invite:${show.id}` }, { onConflict: 'user_id,dedupe_key' });
  }
  // reminders still in the future (24h, 4h, 1h, 30m)
  const offsets = reminderOffsetsDue(Date.parse(values.startAt));
  if (offsets.length) {
    await admin.from('notifications').upsert(offsets.map((m) => ({ user_id: auth.user.id, kind: 'show_reminder', body: `${values.title} starts in ${m >= 60 ? `${m / 60} hour${m > 60 ? 's' : ''}` : `${m} minutes`}`, href: `/artist/kit-check?show=${show.id}`, dedupe_key: `show:${show.id}:reminder:${m}` })), { onConflict: 'user_id,dedupe_key', ignoreDuplicates: true });
  }
  // the broadcast(s) are created now, not at show time (PRD 141)
  const store = supabaseLifecycleStore(admin);
  const bc = await createBroadcastsForShow(store, { showId: show.id, correlationId: cid });
  await recordAuditEvent(admin, { actorType: 'artist', actorId: auth.user.id, action: 'show.scheduled', subjectType: 'show', subjectId: show.id, correlationId: cid, after: { slated_at: values.startAt, mode: values.mode, minutes: values.minutes } });
  const { data: fresh } = await admin.from('shows').select('*').eq('id', show.id).single();
  return withCorrelation(NextResponse.json({ ok: true, show: fresh || show, broadcasts: (bc.broadcasts || []).map((b) => ({ id: b.id, state: b.state, channel_user_id: b.channel_user_id, last_error: b.last_error || null })), inviteToken, remindersDue: offsets }), cid);
}
