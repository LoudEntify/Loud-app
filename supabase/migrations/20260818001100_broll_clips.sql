-- B-roll clips (overnight product round)
-- Run manually in the Supabase SQL editor. Idempotent.
--
-- Clips live in the EXISTING recordings bucket under a broll/ prefix, so
-- they inherit the same private-bucket posture and the same signed-URL
-- enforcement that recordings already have. No new bucket, no second
-- access model to keep in sync.

create table if not exists broll_clips (
  id            uuid primary key default gen_random_uuid(),
  artist_id     uuid not null references auth.users(id) on delete cascade,
  storage_path  text not null unique,
  title         text not null default 'Untitled clip',
  size_bytes    bigint not null default 0,
  duration_ms   integer,
  created_at    timestamptz not null default now()
);

create index if not exists broll_artist_idx on broll_clips (artist_id, created_at desc);

alter table broll_clips enable row level security;

-- Owner-only, all four verbs. B-roll is working material, not published
-- content -- there is deliberately no public read policy here, unlike
-- recordings which have a visibility flag.
create policy "broll_select_own" on broll_clips
  for select using (auth.uid() = artist_id);
create policy "broll_insert_own" on broll_clips
  for insert with check (auth.uid() = artist_id);
create policy "broll_update_own" on broll_clips
  for update using (auth.uid() = artist_id) with check (auth.uid() = artist_id);
create policy "broll_delete_own" on broll_clips
  for delete using (auth.uid() = artist_id);

notify pgrst, 'reload schema';

-- ─── VERIFICATION ─────────────────────────────────────────────
-- 1. Table + policies:
--    select count(*) from information_schema.tables where table_name='broll_clips';
--    -- expect 1
--    select policyname from pg_policies where tablename='broll_clips' order by policyname;
--    -- expect 4: broll_delete_own, broll_insert_own, broll_select_own, broll_update_own
--
-- 2. Quota accounting works (this is the query the app uses for the
--    500MB cap -- run it as yourself after uploading a clip):
--    select coalesce(sum(size_bytes),0) as used_bytes,
--           round(coalesce(sum(size_bytes),0)/1048576.0, 1) as used_mb,
--           count(*) as clips
--      from broll_clips where artist_id = auth.uid();
--    -- expect used_mb to match what the B-roll panel shows you.
--
-- 3. Isolation (should return 0 rows, NOT an error -- RLS filters
--    rather than rejects):
--    select count(*) from broll_clips where artist_id <> auth.uid();
--    -- expect 0
--
-- 4. Storage objects landed under the right prefix:
--    select name, (metadata->>'size')::bigint as bytes
--      from storage.objects
--     where bucket_id = 'recordings' and name like 'broll/%'
--     order by created_at desc limit 5;
--    -- expect one row per uploaded clip, path broll/<your-uid>/<file>.
