-- Phase 2: what a show needs so a viewer can watch it through PlayerSource.
--
-- PRD rows 98, 99, 100, 143 (docs/Loudentify_PRD_User_Stories.xlsx).
-- docs/ARCHITECTURE.md "The path (v2)" and "YouTube delivery rules (v2)";
-- docs/YOUTUBE_ADDENDUM.md "Shape".
--
-- Additive only. The pilot columns (room_name, slot, state, actual_*) keep
-- meaning what they mean; the live console still works on them.
--
-- Ritual (docs/CLAUDE.md §3): shows.id is uuid, artist_id is uuid -> auth.users
-- (checked against information_schema before writing this); no conflict
-- targets change; read_shows stays public (nothing below is a secret: the
-- stream key never lives on this table — it lives on broadcasts in Phase 3,
-- with no client policy at all).

-- Which PlayerSource implementation a viewer gets. 'fixture' is the test
-- double: a local, position-aware player used by seeded synthetic shows and
-- the layout/delay tests so none of them depend on YouTube being reachable.
alter table shows add column if not exists delivery text not null default 'youtube';
alter table shows drop constraint if exists shows_delivery_check;
alter table shows add constraint shows_delivery_check
  check (delivery in ('youtube', 'loudentify-llhls', 'fixture'));

-- The embed id. The broadcast id is what the Live Streaming API hands back
-- when the broadcast is created; the video id is what the player embeds.
alter table shows add column if not exists youtube_video_id text;
alter table shows add column if not exists youtube_broadcast_id text;

-- Versus: the current view is a show-level fact (docs/CLAUDE.md §5).
alter table shows add column if not exists versus_view text not null default 'conversation';
alter table shows drop constraint if exists shows_versus_view_check;
alter table shows add constraint shows_versus_view_check
  check (versus_view in ('conversation', 'a_performing', 'b_performing'));

-- The second artist in a Versus show, set when the invite is accepted
-- (show_slots keeps the invite mechanics; this is the denormalised answer
-- to "who is B" so a viewer read is one row, not a join through a table
-- with zero client policies).
alter table shows add column if not exists artist_b_id uuid references auth.users(id);

-- Card and page content.
alter table shows add column if not exists genre text;
alter table shows add column if not exists description text;
alter table shows add column if not exists cover_url text;
alter table shows add column if not exists visibility text not null default 'public';
alter table shows drop constraint if exists shows_visibility_check;
alter table shows add constraint shows_visibility_check check (visibility in ('public', 'unlisted'));

-- Seeded, synthetic shows are labelled so they can be excluded from any
-- real number and deleted in one statement. Test data is synthetic
-- (docs/CLAUDE.md §3) and must be identifiable as such.
alter table shows add column if not exists is_synthetic boolean not null default false;

create index if not exists shows_state_slated_idx on shows (state, slated_at);
create index if not exists shows_genre_idx on shows (genre) where genre is not null;
create index if not exists shows_artist_b_idx on shows (artist_b_id) where artist_b_id is not null;

-- Viewers need to see view changes and prompt pushes as they happen.
-- shows is publicly readable (read_shows), so realtime delivers its row
-- changes to anon. show_prompts has no client policy: the row change is
-- not delivered to clients, but adding it keeps the publication complete
-- for the service-side listener in Phase 3.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'shows') then
    alter publication supabase_realtime add table shows;
  end if;
end $$;

notify pgrst, 'reload schema';

-- ─── VERIFICATION ─────────────────────────────────────────────
-- V1. select column_name from information_schema.columns where table_name='shows'
--       and column_name in ('delivery','youtube_video_id','youtube_broadcast_id','versus_view','artist_b_id','genre','description','cover_url','visibility','is_synthetic');
--     -- EXPECT: 10 rows
-- V2. insert into shows (room_name, slated_at, delivery) values ('v2-bad', now(), 'vimeo');
--     -- EXPECT: ERROR shows_delivery_check
-- V3. update shows set versus_view = 'both' where false; -- no-op, but
--     insert ... versus_view = 'both' -- EXPECT: ERROR shows_versus_view_check
