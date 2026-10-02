// POST /api/dev/seed — seed the synthetic shows on an environment where
// auth.users cannot be written by SQL (staging). Dev harness only: refuses
// on production and without the dev payment provider, like
// /api/wallet/dev-event. Creates the same accounts and shows as
// scripts/db/seed-synthetic.sql through the admin API.
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin';
import { devHarnessAllowed } from '../../../../lib/paymentProvider';
import { verifySession } from '../../../../lib/verifyArtistAuth';
import { correlationFrom, withCorrelation } from '../../../../lib/correlation';

const ARTISTS = [
  ['ama', 'Ama Serwaa', 'GB', 'London', ['Afrobeats', 'Highlife'], 'Afrobeats with a live band feel, straight from a Peckham living room.'],
  ['kofi', 'Kofi Mensah', 'GB', 'Manchester', ['Gospel', 'Soul'], 'Gospel and soul. Sunday evenings are for singing.'],
  ['nia', 'Nia Okafor', 'GB', 'Birmingham', ['R&B', 'Soul'], 'R&B, slow and close.'],
  ['dele', 'Dele Alabi', 'NG', 'Lagos', ['Amapiano', 'Afrobeats'], 'Amapiano sets with a keyboard and a log drum.'],
  ['zara', 'Zara Lindqvist', 'SE', 'Stockholm', ['Indie', 'Jazz'], 'New here. Indie songs on a nylon-string guitar.'],
  ['tobi', 'Tobi Grace', 'GB', 'Leeds', ['Hip-Hop', 'Rap'], 'First shows this month. Bars over live keys.'],
];
const m = (n) => new Date(Date.now() + n * 60000).toISOString();

export async function POST(request) {
  const cid = correlationFrom(request);
  if (!devHarnessAllowed()) return withCorrelation(NextResponse.json({ error: 'Seeding is only available where the dev harness is allowed.' }, { status: 403 }), cid);
  const auth = await verifySession(request);
  if (auth.error) return withCorrelation(NextResponse.json({ error: auth.error }, { status: auth.status }), cid);
  const admin = getSupabaseAdmin();
  await admin.from('shows').delete().eq('is_synthetic', true);
  const ids = {};
  for (const [key, name, country, city, genres, bio] of ARTISTS) {
    const email = `synth-${key}@synthetic.loudentify.invalid`;
    const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
    const existing = (list?.users || []).find((u) => u.email === email);
    let id = existing?.id;
    if (!id) {
      const { data } = await admin.auth.admin.createUser({ email, password: `synthetic-${key}-${Math.random().toString(36).slice(2)}`, email_confirm: true, user_metadata: { role: 'artist', display_name: name } });
      id = data?.user?.id;
    }
    if (!id) continue;
    ids[key] = id;
    await admin.from('profiles').upsert({ id, role: 'artist', display_name: name, username: `synth_${key}`, full_name: name, date_of_birth: '1995-01-01', country, city, genres, bio }, { onConflict: 'id' });
  }
  const show = (room, artist, title, mode, slatedMin, startedMin, delivery, extra = {}) => ({
    room_name: room, artist_name: ARTISTS.find((a) => a[0] === artist)[1], artist_id: ids[artist], title, performance_mode: mode, slated_at: m(slatedMin), state: startedMin != null ? 'live' : 'scheduled',
    actual_started_at: startedMin != null ? m(startedMin) : null, delivery, is_synthetic: true, duration_minutes: 60, ...extra,
  });
  const rows = [
    show('synth-live-solo', 'ama', 'Living room session', 'solo', -12, -11, 'fixture', { genre: 'Afrobeats', description: 'An hour of originals with the band squeezed into the living room.' }),
    show('synth-live-versus', 'kofi', 'Gospel vs R&B: round two', 'versus', -20, -19, 'fixture', { artist_b_id: ids.nia, versus_view: 'a_performing', genre: 'Gospel' }),
    show('synth-live-youtube', 'dele', 'Amapiano late set', 'solo', -5, -4, 'youtube', { youtube_video_id: 'jfKfPfyJRdk', genre: 'Amapiano' }),
    show('synth-soon-1', 'zara', 'First show: nylon strings', 'solo', 14, null, 'fixture', { genre: 'Indie' }),
    show('synth-soon-2', 'tobi', 'Bars over keys', 'solo', 48, null, 'fixture', { genre: 'Hip-Hop' }),
    show('synth-soon-3', 'nia', 'Slow jams', 'solo', 150, null, 'fixture', { genre: 'R&B' }),
    show('synth-up-1', 'ama', 'Highlife Thursday', 'solo', 27 * 60, null, 'fixture', { genre: 'Highlife' }),
    show('synth-up-2', 'kofi', 'Gospel vs Amapiano', 'versus', 48 * 60, null, 'fixture', { artist_b_id: ids.dele, genre: 'Gospel' }),
    show('synth-up-3', 'dele', 'Log drum Sunday', 'solo', 72 * 60, null, 'fixture', { genre: 'Amapiano' }),
  ];
  const { data: inserted, error } = await admin.from('shows').insert(rows).select('id, room_name');
  if (error) return withCorrelation(NextResponse.json({ error: error.message }, { status: 500 }), cid);
  const solo = inserted.find((s) => s.room_name === 'synth-live-solo'); const versus = inserted.find((s) => s.room_name === 'synth-live-versus');
  await admin.from('show_prompts').insert([
    { show_id: solo.id, room_name: 'synth-live-solo', kind: 'choice', body: 'Next song: slow one or the banger?', options: ['The slow one', 'The banger'], source: 'composed', pinned: true, pushed_at: m(0), closed_at: m(3), created_by: ids.ama },
    { show_id: versus.id, room_name: 'synth-live-versus', kind: 'choice', body: 'Who moved you this round?', options: ['Kofi Mensah', 'Nia Okafor'], source: 'composed', pinned: true, pushed_at: m(0), closed_at: m(5), created_by: ids.kofi },
  ]);
  return withCorrelation(NextResponse.json({ ok: true, shows: inserted.length, artists: Object.keys(ids).length }), cid);
}
