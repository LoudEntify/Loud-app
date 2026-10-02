-- scripts/db/seed-synthetic.sql
-- ─────────────────────────────────────────────────────────────
-- Synthetic shows and artists for local development, CI and the staging
-- demo. Everything here is labelled: shows.is_synthetic = true, usernames
-- start with "synth_", emails end in @synthetic.loudentify.invalid.
-- `scripts/db/seed.sh` runs this against DATABASE_URL (local/CI). On a real
-- Supabase project auth.users must be created through the admin API, so
-- app/api/dev/seed does the same job there (dev harness only).
--
-- Re-runnable: deletes its own previous rows first.
-- ─────────────────────────────────────────────────────────────
\set ON_ERROR_STOP on
begin;

delete from shows where is_synthetic;
delete from auth.users where email like '%@synthetic.loudentify.invalid';

-- six artists (two "new": joined this week) and one fan with tokens
insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000000001', 'synth-ama@synthetic.loudentify.invalid', now(), '{"role":"artist","display_name":"Ama Serwaa"}'),
  ('a0000000-0000-4000-8000-000000000002', 'synth-kofi@synthetic.loudentify.invalid', now(), '{"role":"artist","display_name":"Kofi Mensah"}'),
  ('a0000000-0000-4000-8000-000000000003', 'synth-nia@synthetic.loudentify.invalid', now(), '{"role":"artist","display_name":"Nia Okafor"}'),
  ('a0000000-0000-4000-8000-000000000004', 'synth-dele@synthetic.loudentify.invalid', now(), '{"role":"artist","display_name":"Dele Alabi"}'),
  ('a0000000-0000-4000-8000-000000000005', 'synth-zara@synthetic.loudentify.invalid', now(), '{"role":"artist","display_name":"Zara Lindqvist"}'),
  ('a0000000-0000-4000-8000-000000000006', 'synth-tobi@synthetic.loudentify.invalid', now(), '{"role":"artist","display_name":"Tobi Grace"}'),
  ('f0000000-0000-4000-8000-000000000001', 'synth-fan@synthetic.loudentify.invalid', now(), '{"role":"viewer","display_name":"Sam"}');

insert into profiles (id, role, display_name, username, full_name, date_of_birth, country, city, genres, bio, created_at) values
  ('a0000000-0000-4000-8000-000000000001', 'artist', 'Ama Serwaa', 'synth_ama', 'Ama Serwaa', '1996-04-12', 'GB', 'London', '{Afrobeats,Highlife}', 'Afrobeats with a live band feel, straight from a Peckham living room.', now() - interval '90 days'),
  ('a0000000-0000-4000-8000-000000000002', 'artist', 'Kofi Mensah', 'synth_kofi', 'Kofi Mensah', '1992-11-02', 'GB', 'Manchester', '{Gospel,Soul}', 'Gospel and soul. Sunday evenings are for singing.', now() - interval '60 days'),
  ('a0000000-0000-4000-8000-000000000003', 'artist', 'Nia Okafor', 'synth_nia', 'Nia Okafor', '1998-07-21', 'GB', 'Birmingham', '{R&B,Soul}', 'R&B, slow and close.', now() - interval '45 days'),
  ('a0000000-0000-4000-8000-000000000004', 'artist', 'Dele Alabi', 'synth_dele', 'Dele Alabi', '1994-01-30', 'NG', 'Lagos', '{Amapiano,Afrobeats}', 'Amapiano sets with a keyboard and a log drum.', now() - interval '30 days'),
  ('a0000000-0000-4000-8000-000000000005', 'artist', 'Zara Lindqvist', 'synth_zara', 'Zara Lindqvist', '1999-09-09', 'SE', 'Stockholm', '{Indie,Jazz}', 'New here. Indie songs on a nylon-string guitar.', now() - interval '3 days'),
  ('a0000000-0000-4000-8000-000000000006', 'artist', 'Tobi Grace', 'synth_tobi', 'Tobi Grace', '2000-03-15', 'GB', 'Leeds', '{Hip-Hop,Rap}', 'First shows this month. Bars over live keys.', now() - interval '2 days'),
  ('f0000000-0000-4000-8000-000000000001', 'viewer', 'Sam', 'synth_fan', 'Sam Fan', '1995-05-05', 'GB', 'London', '{Afrobeats,Gospel,R&B}', null, now() - interval '10 days');

-- organisations of one for the artists (what sign-up does)
insert into organisations (id, name, kind) select ('b' || substr(id::text, 2))::uuid, display_name, 'solo' from profiles where username like 'synth_%' and role = 'artist';
insert into organisation_members (organisation_id, user_id, role) select ('b' || substr(id::text, 2))::uuid, id, 'owner' from profiles where username like 'synth_%' and role = 'artist';

-- the fan holds 500 tokens (purchase: a balanced pair from platform_float)
insert into wallet_transactions (user_id, system_account, amount_tokens, kind, description, idempotency_key, entry_group_id, is_legacy_single_leg) values
  ('f0000000-0000-4000-8000-000000000001', null, 500, 'purchase', 'Synthetic starter tokens', 'synth-fan-purchase:user', 'c0000000-0000-4000-8000-000000000001', false),
  (null, 'platform_float', -500, 'purchase', 'Synthetic starter tokens', 'synth-fan-purchase:float', 'c0000000-0000-4000-8000-000000000001', false);

-- shows: two live now (solo fixture, versus fixture), one live on youtube
-- delivery (video id from the environment or a placeholder), three starting
-- soon, six upcoming, one ended (with a recording)
insert into shows (id, room_name, artist_name, slated_at, state, artist_id, artist_b_id, title, performance_mode, duration_minutes, actual_started_at, delivery, youtube_video_id, versus_view, genre, description, is_synthetic) values
  ('d0000000-0000-4000-8000-000000000001', 'synth-live-solo', 'Ama Serwaa', now() - interval '12 minutes', 'live', 'a0000000-0000-4000-8000-000000000001', null, 'Living room session', 'solo', 60, now() - interval '11 minutes', 'fixture', null, 'conversation', 'Afrobeats', 'An hour of originals with the band squeezed into the living room.', true),
  ('d0000000-0000-4000-8000-000000000002', 'synth-live-versus', 'Kofi Mensah', now() - interval '20 minutes', 'live', 'a0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000003', 'Gospel vs R&B: round two', 'versus', 45, now() - interval '19 minutes', 'fixture', null, 'a_performing', 'Gospel', 'Kofi and Nia trade songs. You pick who moved you.', true),
  ('d0000000-0000-4000-8000-000000000003', 'synth-live-youtube', 'Dele Alabi', now() - interval '5 minutes', 'live', 'a0000000-0000-4000-8000-000000000004', null, 'Amapiano late set', 'solo', 90, now() - interval '4 minutes', 'youtube', 'jfKfPfyJRdk', 'conversation', 'Amapiano', 'Delivered through the YouTube player. Needs cookie consent.', true),
  ('d0000000-0000-4000-8000-000000000004', 'synth-soon-1', 'Zara Lindqvist', now() + interval '14 minutes', 'scheduled', 'a0000000-0000-4000-8000-000000000005', null, 'First show: nylon strings', 'solo', 30, null, 'fixture', null, 'conversation', 'Indie', 'Zara''s first ever show on Loudentify.', true),
  ('d0000000-0000-4000-8000-000000000005', 'synth-soon-2', 'Tobi Grace', now() + interval '48 minutes', 'scheduled', 'a0000000-0000-4000-8000-000000000006', null, 'Bars over keys', 'solo', 45, null, 'fixture', null, 'conversation', 'Hip-Hop', null, true),
  ('d0000000-0000-4000-8000-000000000006', 'synth-soon-3', 'Nia Okafor', now() + interval '2 hours 30 minutes', 'scheduled', 'a0000000-0000-4000-8000-000000000003', null, 'Slow jams', 'solo', 60, null, 'fixture', null, 'conversation', 'R&B', null, true),
  ('d0000000-0000-4000-8000-000000000007', 'synth-up-1', 'Ama Serwaa', now() + interval '1 day 3 hours', 'scheduled', 'a0000000-0000-4000-8000-000000000001', null, 'Highlife Thursday', 'solo', 60, null, 'fixture', null, 'conversation', 'Highlife', null, true),
  ('d0000000-0000-4000-8000-000000000008', 'synth-up-2', 'Kofi Mensah', now() + interval '2 days', 'scheduled', 'a0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000004', 'Gospel vs Amapiano', 'versus', 45, null, 'fixture', null, 'conversation', 'Gospel', null, true),
  ('d0000000-0000-4000-8000-000000000009', 'synth-up-3', 'Dele Alabi', now() + interval '3 days', 'scheduled', 'a0000000-0000-4000-8000-000000000004', null, 'Log drum Sunday', 'solo', 90, null, 'fixture', null, 'conversation', 'Amapiano', null, true),
  ('d0000000-0000-4000-8000-000000000010', 'synth-up-4', 'Zara Lindqvist', now() + interval '4 days', 'scheduled', 'a0000000-0000-4000-8000-000000000005', null, 'Jazz standards, badly', 'solo', 30, null, 'fixture', null, 'conversation', 'Jazz', null, true),
  ('d0000000-0000-4000-8000-000000000011', 'synth-up-5', 'Tobi Grace', now() + interval '5 days', 'scheduled', 'a0000000-0000-4000-8000-000000000006', null, 'Freestyle Friday', 'solo', 45, null, 'fixture', null, 'conversation', 'Rap', null, true),
  ('d0000000-0000-4000-8000-000000000012', 'synth-up-6', 'Nia Okafor', now() + interval '6 days', 'scheduled', 'a0000000-0000-4000-8000-000000000003', null, 'Covers night (originals only, really)', 'solo', 60, null, 'fixture', null, 'conversation', 'Soul', null, true),
  ('d0000000-0000-4000-8000-000000000013', 'synth-ended', 'Ama Serwaa', now() - interval '2 days', 'ended', 'a0000000-0000-4000-8000-000000000001', null, 'Last week''s session', 'solo', 60, now() - interval '2 days', 'fixture', null, 'conversation', 'Afrobeats', null, true);
update shows set actual_ended_at = actual_started_at + interval '58 minutes', ended_by = 'artist' where id = 'd0000000-0000-4000-8000-000000000013';

insert into recordings (id, show_id, artist_id, storage_path, title, recorded_at, visibility, duration_ms) values
  ('e0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000013', 'a0000000-0000-4000-8000-000000000001', 'synthetic/ama/last-week.mp4', 'Last week''s session', now() - interval '2 days', 'public', 3480000),
  ('e0000000-0000-4000-8000-000000000002', null, 'a0000000-0000-4000-8000-000000000002', 'synthetic/kofi/sunday.mp4', 'Sunday evening, full show', now() - interval '5 days', 'public', 2700000);

-- an open prompt on the solo show and a Versus vote on the versus show
insert into show_prompts (id, show_id, room_name, kind, body, options, source, pinned, pushed_at, closed_at, created_by, grace_seconds) values
  ('c1000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'synth-live-solo', 'choice', 'Next song: slow one or the banger?', '["The slow one","The banger"]', 'composed', true, now() - interval '20 seconds', now() + interval '30 minutes', 'a0000000-0000-4000-8000-000000000001', 15),
  ('c1000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000002', 'synth-live-versus', 'choice', 'Who moved you this round?', '["Kofi Mensah","Nia Okafor"]', 'composed', true, now() - interval '30 seconds', now() + interval '40 minutes', 'a0000000-0000-4000-8000-000000000002', 15);

insert into show_comments (show_id, room_name, author_name, body, viewer_id, offset_ms, playback_position_ms, created_at) values
  ('d0000000-0000-4000-8000-000000000001', 'synth-live-solo', 'maya_k', 'this band is tight 🔥', 'synth-device-1', 300000, 294000, now() - interval '6 minutes'),
  ('d0000000-0000-4000-8000-000000000001', 'synth-live-solo', 'jo', 'play the one from last week!', 'synth-device-2', 420000, 413000, now() - interval '4 minutes'),
  ('d0000000-0000-4000-8000-000000000002', 'synth-live-versus', 'tunde', 'kofi took that round 😂', 'synth-device-3', 600000, 592000, now() - interval '9 minutes');

-- a few viewers metered so counts are not zero
insert into metering_events (show_id, viewer_id, event, playback_position_ms, source) values
  ('d0000000-0000-4000-8000-000000000001', 'synth-device-1', 'heartbeat', 600000, 'fixture'),
  ('d0000000-0000-4000-8000-000000000001', 'synth-device-2', 'heartbeat', 610000, 'fixture'),
  ('d0000000-0000-4000-8000-000000000002', 'synth-device-3', 'heartbeat', 900000, 'fixture');

commit;
select count(*) as synthetic_shows from shows where is_synthetic;
