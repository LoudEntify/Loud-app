-- pilot2_item5_item6_verification.sql
-- Item 5 (comment persistence) and item 6 (the questionnaire).
--
-- Schema already migrated (pilot2_03, pilot2_06, pilot2_07, env stamp).
-- This verifies the WRITES.
--
-- ⚠️ Replace the UUID in `target_show` in each block.
-- ⚠️ EVERY QUERY FILTERS env = 'production'. Swap to env <> 'production'
--    to see what a device test wrote instead.

-- ══════════════════════════════════════════════════════════════
-- V1 · ITEM 5 — did comments persist at all?
--
-- EXPECT authors and viewers to be close but not equal: author_name
-- comes from the entry form, viewer_id from the device.
--
-- ⚠️ Each client persists only ITS OWN comments, so this is the count of
-- messages whose SENDER's write succeeded — not of messages the room
-- saw. A gap between this and what you remember seeing is a failed
-- write on someone else's device, not a missing message.
-- ══════════════════════════════════════════════════════════════

with target_show as (select '00000000-0000-0000-0000-000000000000'::uuid as show_uuid)
select count(*)                          as comments,
       count(distinct c.viewer_id)       as distinct_devices,
       count(distinct c.author_name)     as distinct_authors,
       min(c.offset_ms) / 1000           as first_at_s,
       max(c.offset_ms) / 1000           as last_at_s,
       count(*) filter (where c.offset_ms is null) as no_offset
  from show_comments c
  join target_show t on t.show_uuid = c.show_id
 where c.env = 'production';

-- ══════════════════════════════════════════════════════════════
-- V2 · ITEM 5 — the join item 3 makes possible.
--
-- Comments bucketed by minute of the ACTUAL performance. This is what
-- lines chat up against a shot change or a song, and it only means
-- anything because offset_ms is measured from actual_started_at.
-- ══════════════════════════════════════════════════════════════

with target_show as (select '00000000-0000-0000-0000-000000000000'::uuid as show_uuid)
select (c.offset_ms / 60000) as minute_into_show,
       count(*)              as comments,
       count(distinct c.viewer_id) as devices
  from show_comments c
  join target_show t on t.show_uuid = c.show_id
 where c.env = 'production' and c.offset_ms is not null
 group by 1
 order by 1;

-- ══════════════════════════════════════════════════════════════
-- V3 · ITEM 6 — what was asked, and how many answered each.
--
-- The response filter is in the JOIN, not the WHERE, so a question
-- nobody answered still reports zero rather than disappearing.
-- ══════════════════════════════════════════════════════════════

with target_show as (select '00000000-0000-0000-0000-000000000000'::uuid as show_uuid)
select p.body,
       p.kind,
       p.offset_ms / 60000 as asked_at_min,
       count(r.id)         as answers,
       count(distinct r.viewer_id) as distinct_viewers
  from show_prompts p
  join target_show t on t.show_uuid = p.show_id
  left join prompt_responses r on r.prompt_id = p.id and r.env = 'production'
 where p.env = 'production'
 group by p.id, p.body, p.kind, p.offset_ms
 order by p.offset_ms nulls last;

-- ══════════════════════════════════════════════════════════════
-- V4 · THE FOUR JULY COMPARISONS. The reason item 6 exists.
--
-- ⚠️ choice_label is FROZEN ON THE ANSWER at the moment it was given,
-- so these labels are what the viewer actually saw — they cannot have
-- been rewritten by a later edit to show_prompts.
--
-- Compare each row against the July figures:
--   versus interest   Very 55 / Somewhat 81 / Not really 21   (n=157)
--   originals/covers  Own 36 / Covers 22 / Mix 90 / Don't mind 9
--   buy tokens        Definitely 15 / Only for one I love 84 / Never 58
--   try first         Free votes 91 / £10 62 / £20 4
-- ══════════════════════════════════════════════════════════════

with target_show as (select '00000000-0000-0000-0000-000000000000'::uuid as show_uuid)
select r.prompt_body,
       r.choice_label,
       count(*) as votes,
       round(100.0 * count(*) / sum(count(*)) over (partition by r.prompt_body), 1) as pct
  from prompt_responses r
  join target_show t on t.show_uuid = r.show_id
 where r.env = 'production'
   and r.choice_label is not null
   and r.prompt_body in (
     'Imagine two unsigned artists going head-to-head in a live show, where your votes help decide the winner. How interesting does that sound?',
     'Would you rather watch a new artist perform their own songs, or covers of songs you know?',
     'Watching would be free. Would you ever buy tokens to power-vote or tip an artist you loved?',
     'Which would you most likely try first?'
   )
 group by r.prompt_body, r.choice_label
 order by r.prompt_body, votes desc;

-- ══════════════════════════════════════════════════════════════
-- V5 · ⚠️ THE VERBATIM CHECK. Run this BEFORE trusting V4.
--
-- If a stored prompt_body does not EXACTLY match the survey string, the
-- comparison with July is void for that question — and it fails
-- silently, because the rows still write and the percentages still
-- render. Two of these labels were shipped wrong once.
--
-- EXPECT four rows, all matched = true. A false means the deployed
-- constant drifted from the CSV.
-- ══════════════════════════════════════════════════════════════

with target_show as (select '00000000-0000-0000-0000-000000000000'::uuid as show_uuid),
expected(body) as (values
  ('Imagine two unsigned artists going head-to-head in a live show, where your votes help decide the winner. How interesting does that sound?'),
  ('Would you rather watch a new artist perform their own songs, or covers of songs you know?'),
  ('Watching would be free. Would you ever buy tokens to power-vote or tip an artist you loved?'),
  ('Which would you most likely try first?')
)
select e.body,
       exists (
         select 1 from show_prompts p
          join target_show t on t.show_uuid = p.show_id
          where p.env = 'production' and p.body = e.body
       ) as matched
  from expected e;

-- ══════════════════════════════════════════════════════════════
-- V6 · ONE ANSWER PER VIEWER. The property that makes this usable as
-- Versus voting rather than a tally of enthusiasm.
--
-- EXPECT zero rows. Any row means one person is outvoting others.
-- ══════════════════════════════════════════════════════════════

with target_show as (select '00000000-0000-0000-0000-000000000000'::uuid as show_uuid)
select r.prompt_id, r.viewer_id, count(*) as rows_for_one_viewer
  from prompt_responses r
  join target_show t on t.show_uuid = r.show_id
 where r.viewer_id is not null
 group by r.prompt_id, r.viewer_id
having count(*) > 1;

-- ══════════════════════════════════════════════════════════════
-- V7 · CATCH-UP COVERAGE. Did late joiners actually answer?
--
-- Compares when each viewer joined against how many questions they
-- answered. The catch-up exists so that a late arrival is not a viewer
-- who answered nothing — this is the query that says whether it worked.
-- ══════════════════════════════════════════════════════════════

with target_show as (select '00000000-0000-0000-0000-000000000000'::uuid as show_uuid),
s as (select sh.* from shows sh join target_show t on t.show_uuid = sh.id),
joins as (
  select v.viewer_id,
         min(v.joined_at) as first_joined,
         extract(epoch from (min(v.joined_at) - (select actual_started_at from s))) / 60 as joined_at_min
    from viewer_sessions v join s on s.id = v.show_id
   where v.env = 'production'
   group by v.viewer_id
)
select case
         when j.joined_at_min < 5  then 'from the start'
         when j.joined_at_min < 20 then 'joined 5-20 min in'
         else 'joined 20+ min in'
       end as arrival,
       count(*)                                    as viewers,
       round(avg(a.answers)::numeric, 1)           as avg_answers,
       count(*) filter (where coalesce(a.answers, 0) = 0) as answered_nothing
  from joins j
  left join (
    select r.viewer_id, count(*) as answers
      from prompt_responses r join s on s.id = r.show_id
     where r.env = 'production'
     group by r.viewer_id
  ) a on a.viewer_id = j.viewer_id
 group by 1
 order by 1;
