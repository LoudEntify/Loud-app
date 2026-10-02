-- Phase 2: stamp votes, reactions and comments with the viewer's playback
-- position, not the wall clock.
--
-- PRD rows 101, 102. docs/CLAUDE.md §5: "Reactions are stamped with the
-- viewer's playback position, not wall clock." docs/YOUTUBE_ADDENDUM.md:
-- "YouTube delay: votes, Support thank-yous and reactions must line up with
-- what the viewer sees, not what the server sees."
--
-- offset_ms (existing) is the SERVER's idea of where the show is (wall
-- clock minus actual_started_at). playback_position_ms is where the
-- VIEWER's player actually was, reported by the client. Under YouTube the
-- two differ by the delivery delay (3–10 s), and the second one is the one
-- that lines up with what the person saw. Both are kept: the difference
-- between them IS the measured delay, which ARCHITECTURE.md asks to report
-- on every show.
--
-- Ritual: show_comments.id bigint, reaction_events.id bigint,
-- prompt_responses.id bigint (checked). No conflict targets change here;
-- the new unique index on prompt_responses is partial and is NOT used as
-- a PostgREST conflict target — the API resolves the row itself.

alter table show_comments    add column if not exists playback_position_ms bigint;
alter table reaction_events  add column if not exists playback_position_ms bigint;
alter table prompt_responses add column if not exists playback_position_ms bigint;

-- Versus reactions and comments carry the artist they are for (row 102:
-- "Versus reactions need an artist field before they can count for A or B").
alter table reaction_events add column if not exists artist_slot text;
alter table reaction_events drop constraint if exists reaction_events_artist_slot_check;
alter table reaction_events add constraint reaction_events_artist_slot_check
  check (artist_slot is null or artist_slot in ('a', 'b'));

-- One vote per ACCOUNT, changeable until voting closes. The pilot's
-- one-per-device rule (prompt_id, viewer_id) stays for guest-era rows;
-- signed-in votes are also unique per user.
create unique index if not exists prompt_responses_prompt_user_uidx
  on prompt_responses (prompt_id, user_id) where user_id is not null;

-- A short grace window after voting closes, in seconds, so a viewer who
-- saw "voting closes" a few seconds late (delivery delay) is not refused.
alter table show_prompts add column if not exists grace_seconds integer not null default 15;
alter table show_prompts drop constraint if exists show_prompts_grace_sane;
alter table show_prompts add constraint show_prompts_grace_sane check (grace_seconds between 0 and 60);

create index if not exists show_comments_show_created_idx on show_comments (show_id, created_at desc);

notify pgrst, 'reload schema';

-- ─── VERIFICATION ─────────────────────────────────────────────
-- V1. select table_name, column_name from information_schema.columns
--      where column_name = 'playback_position_ms' order by 1;
--     -- EXPECT: prompt_responses, reaction_events, show_comments
-- V2. two inserts into prompt_responses with the same prompt_id and user_id
--     -- EXPECT: the second fails on prompt_responses_prompt_user_uidx
