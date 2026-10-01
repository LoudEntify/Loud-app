-- mvp2_03_set_list_items.sql
-- MVP round 2, TASK 2 — the ordered items.
--
-- PRD: Director Experience / Live Show (set lists)
-- S&I: Database, Auth (RLS)
--
-- Run manually. Idempotent. Run AFTER mvp2_01 and mvp2_02 — this
-- references backing_tracks, set_lists AND cue_sheets.

create table if not exists set_list_items (
  id           uuid primary key default gen_random_uuid(),
  set_list_id  uuid not null references set_lists(id) on delete cascade,

  -- ── WHY position IS NOT UNIQUE ────────────────────────────────
  -- A reorder rewrites several rows at once, and under a unique
  -- constraint the intermediate states of that rewrite are illegal:
  -- moving item 3 into slot 1 collides with the existing 1 before the
  -- rest have shifted. The usual escapes are a DEFERRABLE unique
  -- constraint or shuffling through negative placeholders, and both buy
  -- a uniqueness the app never needs at the price of a reorder that can
  -- fail halfway through and leave a set in a state nobody designed.
  --
  -- Instead: order by (position, created_at). Duplicate positions are
  -- possible and harmless — they resolve to a stable, deterministic
  -- order rather than an error. Reordering rewrites every position in
  -- the set inside one transaction, which is the only operation that
  -- touches this column at all.
  position     integer not null,

  -- ── on delete restrict, NOT cascade ───────────────────────────
  -- Cascade would let an artist clearing storage space silently gut a
  -- set they are performing from on Friday, and the hole is found
  -- mid-show. Someone deleting a track is thinking about SPACE; they
  -- are not thinking about a running order they built a week ago.
  --
  -- So the database refuses. app/api/tracks/delete refuses first and
  -- more helpfully — naming the sets the track appears in — and this
  -- constraint is the backstop that makes it true even if that check is
  -- ever bypassed. An extra click is not a cost worth a missing song at
  -- 9pm.
  --
  -- NOTE: a track NOT in any set list still deletes exactly as it did
  -- before this table existed, cue sheets kept. That path is unchanged.
  backing_track_id uuid not null references backing_tracks(id) on delete restrict,

  -- ── CUE SHEETS ARE NOT RE-KEYED, AND MUST NOT BE ──────────────
  -- cue_sheets stays keyed (track_hash, artist_email). A sheet belongs
  -- to a TRACK: the same track in three sets is one sheet, not three,
  -- and re-keying to the set list would multiply an artist's authoring
  -- by the number of sets they put a song in.
  --
  -- This column is an optional OVERRIDE — "in THIS set, play that track
  -- against that sheet" — for a different reading of the same song in a
  -- different show. Null is the normal state and the overwhelmingly
  -- common one; it means "whatever sheet the track resolves to by hash",
  -- which is what already happens today.
  --
  -- bigint, not uuid: cue_sheets.id is `bigint generated always as
  -- identity`. Verification 5 below is what proves that, and it exists
  -- because round 1 got this exact pairing wrong.
  cue_sheet_id bigint references cue_sheets(id) on delete set null,

  created_at   timestamptz not null default now()
);

create index if not exists set_list_items_order_idx
  on set_list_items (set_list_id, position, created_at);

-- Reverse lookup: "which sets is this track in?" — the query that makes
-- the delete refusal able to name them.
create index if not exists set_list_items_track_idx
  on set_list_items (backing_track_id);

alter table set_list_items enable row level security;

-- ── OWNERSHIP IS INHERITED, NOT DUPLICATED ────────────────────
-- There is deliberately no artist_id column here. It would be a second
-- copy of a fact set_lists already holds, and the two could disagree —
-- an item whose artist_id contradicts its parent set is a row no policy
-- can correctly judge, and no amount of care at write time prevents it
-- forever. So every policy resolves ownership through the parent, and
-- there is only ever one answer to who owns an item.
drop policy if exists set_list_items_select_own on set_list_items;
create policy set_list_items_select_own on set_list_items
  for select using (exists (
    select 1 from set_lists s
    where s.id = set_list_items.set_list_id and s.artist_id = auth.uid()));

drop policy if exists set_list_items_insert_own on set_list_items;
create policy set_list_items_insert_own on set_list_items
  for insert with check (exists (
    select 1 from set_lists s
    where s.id = set_list_items.set_list_id and s.artist_id = auth.uid()));

drop policy if exists set_list_items_update_own on set_list_items;
create policy set_list_items_update_own on set_list_items
  for update using (exists (
    select 1 from set_lists s
    where s.id = set_list_items.set_list_id and s.artist_id = auth.uid()))
  with check (exists (
    select 1 from set_lists s
    where s.id = set_list_items.set_list_id and s.artist_id = auth.uid()));

drop policy if exists set_list_items_delete_own on set_list_items;
create policy set_list_items_delete_own on set_list_items
  for delete using (exists (
    select 1 from set_lists s
    where s.id = set_list_items.set_list_id and s.artist_id = auth.uid()));

notify pgrst, 'reload schema';


-- ══════════════════════════════════════════════════════════════
-- VERIFICATION
-- ══════════════════════════════════════════════════════════════

-- 1. COLUMNS — expect exactly 6 rows.
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'set_list_items'
order by ordinal_position;

-- 2. POLICIES — expect 4 rows. EVERY qual must contain the set_lists
--    subquery (that is the inherited-ownership check); the update row
--    must have BOTH qual and with_check.
select policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'set_list_items'
order by policyname;

-- 3. RLS IS ACTUALLY ON — expect relrowsecurity = true.
select relname, relrowsecurity from pg_class where relname = 'set_list_items';

-- 4. INDEXES — expect 3 (pkey + the two above). NONE should be unique
--    except the pkey: a unique position index is precisely what this
--    design avoids, and finding one here means someone "fixed" the
--    ordering and broke reordering.
select i.relname as index_name, ix.indisunique, ix.indpred,
       pg_get_indexdef(ix.indexrelid) as definition
from pg_index ix
join pg_class i on i.oid = ix.indexrelid
join pg_class t on t.oid = ix.indrelid
where t.relname = 'set_list_items';

-- 5. FOREIGN KEY TYPES RESOLVE — expect 3 rows, no error.
--    STANDING CHECK. Read them: set_list_id uuid->uuid,
--    backing_track_id uuid->uuid ON DELETE RESTRICT, cue_sheet_id
--    bigint->bigint. If this statement errors at all, a type pairing is
--    wrong and the table did not create — the failure round 1 hid
--    behind `create table if not exists`.
select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'set_list_items'::regclass and contype = 'f';

-- 6. restrict ACTUALLY BITES — this must ERROR with a foreign key
--    violation. Replace the uuid with a track that is in a set.
-- delete from backing_tracks where id = '<a-track-that-is-in-a-set>';

-- 7. AND A TRACK IN NO SET STILL DELETES — must succeed. This is the
--    behaviour that existed before this table and must not regress.
-- delete from backing_tracks where id = '<a-track-in-no-set>';
