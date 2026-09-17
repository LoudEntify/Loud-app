-- pilot2_clear_test_votes.sql
-- Remove rehearsal/preview prompt and vote rows without touching the
-- pilot's own data.
--
-- ⚠️ YOU PROBABLY DO NOT NEED THIS.
--
-- A vote cast from a PREVIEW deployment is already stamped
-- env = 'preview' and is already excluded from every query in
-- docs/pilot2_item5_item6_verification.sql, all of which filter
-- env = 'production'. The rows exist but they do not count.
--
-- Use this only if you want them physically gone -- for a clean export,
-- or so that a query written later WITHOUT the env filter cannot pick
-- them up.
--
-- ── WHY env IS TRUSTWORTHY HERE ───────────────────────────────
-- rowEnv() reads process.env.VERCEL_ENV, and /api/build-info returns
-- that same value. Measured on 17 September:
--   preview deployment    env = 'preview'
--   loudentify.app        env = 'production'
-- So the stamp is not an assumption about how Vercel behaves; it is the
-- value the running function actually saw.

-- ══════════════════════════════════════════════════════════════
-- C1 · LOOK FIRST. What is stamped what, for the current show.
--
-- EXPECT: 'production' rows only from the real show, 'preview' rows only
-- from testing. Anything under 'development' came from a local `next
-- dev` and is also safe to remove.
-- ══════════════════════════════════════════════════════════════

with target as (
  select id, room_name from shows
   where performance_mode = 'versus' and state <> 'ended'
   order by created_at desc nulls last, slated_at desc
   limit 1
)
select 'show_prompts' as tbl, p.env, count(*) as rows,
       min(p.pushed_at) as first_pushed, max(p.pushed_at) as last_pushed
  from show_prompts p join target t on t.id = p.show_id
 group by p.env
union all
select 'prompt_responses', r.env, count(*), min(r.created_at), max(r.created_at)
  from prompt_responses r join target t on t.id = r.show_id
 group by r.env
order by tbl, env;

-- ── C1b · The individual prompts, so you can see which is which.

with target as (
  select id from shows
   where performance_mode = 'versus' and state <> 'ended'
   order by created_at desc nulls last, slated_at desc limit 1
)
select p.id, p.env, p.kind, p.body, p.pushed_at, p.closed_at,
       (select count(*) from prompt_responses r where r.prompt_id = p.id) as answers
  from show_prompts p join target t on t.id = p.show_id
 order by p.pushed_at;

-- ══════════════════════════════════════════════════════════════
-- C2 · DELETE EVERY NON-PRODUCTION PROMPT AND ANSWER for this show.
--
-- Scoped three ways so it cannot reach the pilot's data:
--   the show               (the newest open versus show)
--   env <> 'production'    (never a real row)
--   responses before prompts (the FK is ON DELETE CASCADE, but deleting
--                             explicitly means the count is visible)
--
-- Wrapped in a transaction ending in ROLLBACK. Read the counts, then
-- change the last line to `commit;` to apply. As written it changes
-- NOTHING.
-- ══════════════════════════════════════════════════════════════

begin;

with target as (
  select id from shows
   where performance_mode = 'versus' and state <> 'ended'
   order by created_at desc nulls last, slated_at desc limit 1
),
gone_responses as (
  delete from prompt_responses r
   using target t
   where r.show_id = t.id and r.env <> 'production'
  returning r.id
)
select count(*) as responses_deleted from gone_responses;

with target as (
  select id from shows
   where performance_mode = 'versus' and state <> 'ended'
   order by created_at desc nulls last, slated_at desc limit 1
),
gone_prompts as (
  delete from show_prompts p
   using target t
   where p.show_id = t.id and p.env <> 'production'
  returning p.id
)
select count(*) as prompts_deleted from gone_prompts;

-- What SURVIVES. Every row here must be env = 'production'.
with target as (
  select id from shows
   where performance_mode = 'versus' and state <> 'ended'
   order by created_at desc nulls last, slated_at desc limit 1
)
select 'show_prompts' as tbl, p.env, count(*) from show_prompts p join target t on t.id = p.show_id group by p.env
union all
select 'prompt_responses', r.env, count(*) from prompt_responses r join target t on t.id = r.show_id group by r.env
order by tbl, env;

rollback;
-- ^ change to `commit;` to apply. Left as rollback so pasting the whole
--   file is safe and applying it is a deliberate edit.

-- ══════════════════════════════════════════════════════════════
-- C3 · The same, for the OTHER pilot tables, if you want a fully clean
-- production dataset after the rehearsal.
--
-- READ-ONLY. It only shows you the counts -- deleting viewer sessions
-- and comments is a bigger decision than deleting test votes, and the
-- rehearsal's rows are legitimate evidence that the write paths worked.
-- ══════════════════════════════════════════════════════════════

select 'viewer_sessions'  as tbl, env, count(*) from viewer_sessions  group by env
union all select 'show_comments',   env, count(*) from show_comments   group by env
union all select 'prompt_responses',env, count(*) from prompt_responses group by env
union all select 'show_prompts',    env, count(*) from show_prompts    group by env
order by tbl, env;
