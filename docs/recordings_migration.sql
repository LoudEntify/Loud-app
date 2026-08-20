-- recordings migration (Accounts & Identity, Day 2 -- profiles + recordings library)
-- Run manually in the Supabase SQL editor -- not applied automatically.
--
-- Two things in this file:
--   1. recordings -- new table, RLS-gated metadata for egress-produced files.
--   2. avatars -- new PUBLIC storage bucket, for profile photos.
--
-- Storage enforcement note (the actual privacy mechanism for recordings):
-- this file does NOT touch the `recordings` STORAGE BUCKET's public/private
-- flag or any storage.objects RLS policy for it -- that's a separate
-- dashboard step (Storage > recordings > Settings > toggle to private), done
-- by hand, not via SQL, so it's not silently bundled into a script you might
-- re-run. The actual read-gating happens in app/api/recordings/[id]/url/
-- route.js, which uses the SERVICE-ROLE client (bypasses RLS entirely, same
-- as every other admin-client route in this app) to issue short-lived signed
-- URLs only after checking this table's own visibility/artist_id columns --
-- so no storage.objects RLS policy is needed for recordings at all. Once the
-- bucket is private, a bare object URL 400s for everyone; only a signed URL
-- obtained through that route works, and only after it authorizes the
-- request.

-- ─── 1. recordings ────────────────────────────────────────────
-- storage_path is the raw S3 key egress already writes
-- (recordings/{room}-{epoch-ms}.mp4, see app/api/egress/start/route.js) --
-- never exposed to the client directly; only this row's own `id` is, and
-- app/api/recordings/[id]/url/route.js exchanges that id for a short-lived
-- signed URL after checking visibility/ownership. artist_id is NOT NULL --
-- unlike shows.artist_id (nullable, backfilled over time by claim-slot),
-- every recordings row is only ever created by the sync route (docs/
-- ownership_migration.sql's shows.artist_id backfill runs first, and the
-- sync route skips any object it can't attribute to a known artist), so
-- there's no equivalent "ownerless" state to allow for here.
create table if not exists recordings (
  id           uuid primary key default gen_random_uuid(),
  show_id      uuid references shows(id),
  artist_id    uuid not null references auth.users(id) on delete cascade,
  storage_path text not null unique,
  title        text not null default 'Untitled recording',
  recorded_at  timestamptz not null,
  visibility   text not null default 'private' check (visibility in ('public', 'private')),
  created_at   timestamptz not null default now()
);

create index if not exists recordings_artist_idx on recordings (artist_id);
create index if not exists recordings_public_idx on recordings (artist_id) where visibility = 'public';

alter table recordings enable row level security;

-- Owner: full read/write of their own rows, any visibility.
create policy "recordings_select_own" on recordings
  for select using (auth.uid() = artist_id);

create policy "recordings_insert_own" on recordings
  for insert with check (auth.uid() = artist_id);

create policy "recordings_update_own" on recordings
  for update using (auth.uid() = artist_id) with check (auth.uid() = artist_id);

-- Public (anon or authed): read-only, and only rows explicitly marked
-- public. Combines with recordings_select_own via OR, same pattern as
-- profiles' public-artist-read policy from Day 1 -- an owner's private rows
-- are never exposed by this policy, only by the one above, to themselves.
create policy "recordings_select_public" on recordings
  for select using (visibility = 'public');

-- No delete policy -- not asked for this round; a row with no matching
-- policy for a command is simply unreachable for that command, same as
-- every other zero-policy table in this app for whichever commands it
-- doesn't define.

-- ─── 2. avatars (new public bucket) ──────────────────────────
-- Public by design -- a public artist profile photo has no privacy
-- requirement, unlike recordings. Path convention: {auth.uid()}/{filename},
-- enforced by the write policies below via storage.foldername(), so a user
-- can only ever write inside their own folder.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

create policy "avatars_public_read" on storage.objects
  for select using (bucket_id = 'avatars');

create policy "avatars_owner_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "avatars_owner_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- ─── Verification query -- run after the above, confirm before moving on ──
-- Expect 4 rows for `recordings` (select_own, insert_own, update_own,
-- select_public) and 3 rows for `storage.objects` scoped to bucket_id =
-- 'avatars' (public_read, owner_insert, owner_update). If this returns
-- fewer, some policy failed to create (see Day 1's own experience with this
-- exact failure mode) -- do not proceed to app verification until it
-- matches.
select schemaname, tablename, policyname, cmd, roles
from pg_policies
where tablename in ('recordings', 'objects')
order by tablename, policyname;
