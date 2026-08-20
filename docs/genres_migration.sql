-- genres migration (Accounts & Identity Day 2 -- product decision fold-in)
-- Run manually in the Supabase SQL editor -- not applied automatically.
--
-- Replaces the single free-text `genre` column with a fixed-list,
-- multi-select `genres text[]` -- see lib/genres.js for the canonical
-- list and components/GenreSelect.jsx for the picker UI. Both artist and
-- viewer profiles use it now (Change 1 of this round: bio/avatar_url also
-- stop being artist-only, no schema change needed for that part -- see
-- components/AccountSettings.jsx).
--
-- Storage shape: text[] (a native Postgres array), not a separate join
-- table. Reasoning: a bounded, small tag count per profile with no need
-- for genre-level metadata (no popularity counts, no per-genre records
-- requested) -- a join table would be real complexity for no real
-- benefit here. text[] also supports GIN indexing and the && / @>
-- operators directly for "any of these genres" queries, which is exactly
-- what genre-based discovery/contest matching (mentioned as the reason
-- for the fixed list in the first place) will need later. And it's a
-- straight pass-through from supabase-js -- `.update({ genres: [...] })`
-- serializes a JS array natively, no extra plumbing.
--
-- The old `genre` text column is NOT dropped -- kept as a read-only
-- historical/audit trail, same pattern this app already uses elsewhere
-- (cue_sheets kept artist_email when artist_id was added). The app no
-- longer reads or writes it after this round.

alter table profiles add column if not exists genres text[] not null default '{}';

-- One-time backfill from the old free-text `genre` column -- splits on
-- commas and normalizes known variants against lib/genres.js's canonical
-- list (case-insensitive, trimmed). This is a best-effort mapping, not a
-- guarantee -- anything that doesn't match a known form is dropped from
-- `genres` for that row (never invented or guessed at), and the
-- verification query below finds exactly which rows that happened to so
-- you can reconcile them by hand rather than silently losing data.
update profiles
set genres = (
  select coalesce(array_agg(distinct mapped) filter (where mapped is not null), '{}')
  from (
    select case lower(trim(piece))
      when 'afrobeats' then 'Afrobeats'
      when 'amapiano' then 'Amapiano'
      when 'r&b' then 'R&B'
      when 'rnb' then 'R&B'
      when 'r n b' then 'R&B'
      when 'r and b' then 'R&B'
      when 'r''n''b' then 'R&B'
      when 'rap' then 'Rap'
      when 'hip-hop' then 'Hip-Hop'
      when 'hip hop' then 'Hip-Hop'
      when 'hiphop' then 'Hip-Hop'
      when 'gospel' then 'Gospel'
      when 'pop' then 'Pop'
      when 'soul' then 'Soul'
      when 'jazz' then 'Jazz'
      when 'reggae' then 'Reggae'
      when 'dancehall' then 'Dancehall'
      when 'afro-fusion' then 'Afro-fusion'
      when 'afro fusion' then 'Afro-fusion'
      when 'afrofusion' then 'Afro-fusion'
      when 'alte' then 'Alté'
      when 'alté' then 'Alté'
      when 'highlife' then 'Highlife'
      when 'drill' then 'Drill'
      when 'grime' then 'Grime'
      when 'electronic' then 'Electronic'
      when 'house' then 'House'
      when 'rock' then 'Rock'
      when 'country' then 'Country'
      when 'folk' then 'Folk'
      when 'classical' then 'Classical'
      else null
    end as mapped
    from unnest(string_to_array(profiles.genre, ',')) as piece
  ) matched
)
where genre is not null and genre <> '';

-- ─── Verification -- run both before treating this as done ──────
-- Expect 1 row, genres.
select table_name, column_name
from information_schema.columns
where table_name = 'profiles' and column_name = 'genres';

-- Rows here had a non-empty old `genre` string that backfilled to an
-- EMPTY genres array -- every piece failed to match the canonical list.
-- Not necessarily wrong (could be legitimate free text that was never a
-- real genre), but worth a manual look since it means that profile lost
-- its genre display until someone re-picks from the fixed list.
select id, genre, genres
from profiles
where genre is not null and genre <> '' and genres = '{}';

notify pgrst, 'reload schema';
