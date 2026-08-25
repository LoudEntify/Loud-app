-- overnight2_03_follows.sql
-- Overnight build #2, Phase 1 (viewer onboarding) + Phase 4g (Discover).
--
-- Run manually in the Supabase SQL editor. Idempotent.
--
-- The FOLLOW button has existed on artist profiles for a while and has
-- always said, in as many words, that it does not work — there was no
-- table behind it (components/ProfileSurface.jsx). Viewer onboarding's
-- second step is "follow a few artists", which cannot be a real step
-- against a button that is honest about being decorative. So: the table.
--
-- Deliberately minimal. A follow is one person pointing at one artist,
-- and the moment they did it. No notification preferences, no mute, no
-- close-friends tier — every one of those is a real feature that should
-- arrive with its own UI rather than as an unused column.

create table if not exists follows (
  -- Composite primary key rather than a surrogate id: the natural key IS
  -- the fact. One person cannot follow one artist twice, and expressing
  -- that as the key means the database enforces it instead of the app
  -- remembering to.
  follower_id uuid not null references auth.users(id) on delete cascade,
  artist_id   uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (follower_id, artist_id)
);

-- "Who follows this artist", which the primary key's index cannot answer
-- efficiently (it leads with follower_id).
create index if not exists follows_artist_idx on follows (artist_id, created_at desc);

alter table follows enable row level security;

-- A person manages their own follows, and nobody else's.
create policy "follows_select_own" on follows
  for select using (auth.uid() = follower_id);
create policy "follows_insert_own" on follows
  for insert with check (auth.uid() = follower_id);
create policy "follows_delete_own" on follows
  for delete using (auth.uid() = follower_id);

-- An artist may see who follows them. Additive to the policy above (two
-- permissive SELECT policies OR together), so a fan reading their own
-- follow list and an artist reading their follower list both work
-- without either being able to read a third party's.
--
-- NOTE what this deliberately does NOT grant: nobody can read anybody
-- else's follow GRAPH. A fan cannot enumerate who else follows an
-- artist, which is why the follower COUNT on a public profile is not
-- computed client-side — a count query under these policies returns the
-- caller's own row and nothing else, which would render as "1 follower"
-- for everyone. Any public count needs a security-definer function or a
-- maintained counter column; neither is built tonight, and no surface
-- claims a follower count it cannot support.
create policy "follows_select_as_artist" on follows
  for select using (auth.uid() = artist_id);

-- NO UPDATE POLICY, on purpose. A follow has nothing to update — it is
-- created or deleted. An UPDATE policy would only ever be a way to
-- rewrite who followed whom.

-- CONFLICT TARGET: `follows_pkey` on (follower_id, artist_id). This one
-- IS used — the follow button upserts with ignoreDuplicates so a double
-- tap is a no-op rather than a 409. The key is a plain (non-partial)
-- primary key, so ON CONFLICT (follower_id, artist_id) is inferrable.
-- Stated explicitly because a partial unique index in this position is
-- exactly the trap that produced a live 400 on `notifications` in an
-- earlier round.

notify pgrst, 'reload schema';

-- ─── VERIFICATION ─────────────────────────────────────────────
--
-- V1. Table and key:
--     select count(*) from information_schema.tables where table_name = 'follows';
--     -- EXPECT: 1
--     select conname, contype, pg_get_constraintdef(oid)
--       from pg_constraint where conrelid = 'follows'::regclass order by conname;
--     -- EXPECT 3 rows: follows_pkey (p) PRIMARY KEY (follower_id, artist_id),
--     -- plus the two foreign keys to auth.users, both ON DELETE CASCADE.
--
-- V2. RLS on, four policies, no UPDATE:
--     select relrowsecurity from pg_class where relname = 'follows';
--     -- EXPECT: t
--     select policyname, cmd from pg_policies where tablename = 'follows' order by policyname;
--     -- EXPECT exactly 4 rows:
--     --   follows_delete_own       | DELETE
--     --   follows_insert_own       | INSERT
--     --   follows_select_as_artist | SELECT
--     --   follows_select_own       | SELECT
--     -- Any UPDATE row here is wrong — see the note above.
--
-- V3. The conflict target is inferrable (this is the query the app runs):
--     begin;
--       insert into follows (follower_id, artist_id)
--         select a.id, b.id from auth.users a, auth.users b where a.id <> b.id limit 1
--         on conflict (follower_id, artist_id) do nothing;
--       insert into follows (follower_id, artist_id)
--         select a.id, b.id from auth.users a, auth.users b where a.id <> b.id limit 1
--         on conflict (follower_id, artist_id) do nothing;
--     rollback;
--     -- EXPECT: both statements succeed, second inserts 0 rows.
--     -- A 42P10 here means the key is not what this file thinks it is.
--     -- (Skip if you have fewer than 2 auth.users rows.)
--
-- V4. A fan cannot read someone else's follows. From the browser console
--     on the preview, signed in as fan A:
--       await window.__sb.from('follows').select('*')
--     -- EXPECT: only rows where follower_id is A's own id (plus, if A is
--     -- also an artist, rows where artist_id is A).
--
-- V5. Round-trip from the app: walk viewer onboarding's follow step and
--     pick two artists, then:
--       select f.artist_id, p.display_name, f.created_at
--         from follows f join profiles p on p.id = f.artist_id
--        where f.follower_id = '<your user id>';
--     -- EXPECT: the two artists you picked.
