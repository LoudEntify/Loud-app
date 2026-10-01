-- Organisations and the permission model.
--
-- docs/ARCHITECTURE.md: "a user belongs to zero or more organisations, an
-- organisation holds artists, and roles are granted per organisation rather
-- than globally. A solo artist is simply an organisation of one." Not
-- launch work, but docs/CLAUDE.md §4 lists it as build-first because
-- bolting tenancy onto a single-user model later means rewriting the data
-- layer rather than adding to it.
--
-- This is additive. `profiles.role` (artist|viewer) is untouched and keeps
-- meaning what it already means — this does not replace it, it sits
-- alongside it as the shape that lets a label, venue or management company
-- become "one organisation, several artist profiles" later without a
-- migration that touches every existing row.

create table if not exists organisations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  -- 'solo' now; 'label' / 'venue' / 'management' are later shapes this
  -- column already has room for, per ARCHITECTURE.md's "additive later
  -- rather than structural" framing. Not a CHECK constraint yet — the set
  -- of organisation kinds is exactly the kind of thing that grows with a
  -- deal, and a CHECK that blocks a real signup is worse than a typo this
  -- codebase's own conventions (see profiles.role vs camera slot roles)
  -- already distinguish by stability, not by category.
  kind        text not null default 'solo',
  created_at  timestamptz not null default now()
);

create table if not exists organisation_members (
  organisation_id  uuid not null references organisations(id) on delete cascade,
  user_id          uuid not null references auth.users(id) on delete cascade,
  -- 'owner' can manage members and settings; 'member' cannot. A solo
  -- artist's one membership row is always 'owner' — there is nobody else
  -- to grant anything to yet, but the row exists so adding a second member
  -- later is an INSERT, not a schema change.
  role             text not null check (role in ('owner', 'member')),
  created_at       timestamptz not null default now(),
  primary key (organisation_id, user_id)
);

create index if not exists organisation_members_user_idx
  on organisation_members (user_id);

alter table organisations enable row level security;
alter table organisation_members enable row level security;

-- A member can see the organisations they belong to, and who else is in
-- them — nothing about an organisation a user isn't a member of leaks,
-- including its existence (the subquery only matches rows the caller is
-- already in).
--
-- organisation_members_select_same_org deliberately does NOT write
-- `organisation_id in (select organisation_id from organisation_members
-- where user_id = auth.uid())` directly in the policy: a policy on
-- organisation_members that subqueries organisation_members itself makes
-- Postgres re-apply this same policy while evaluating the subquery, which
-- is the textbook way to get "infinite recursion detected in policy for
-- relation organisation_members". The fix Supabase's own docs recommend is
-- a SECURITY DEFINER helper function, which runs as its owner and so
-- bypasses RLS entirely while answering "which orgs does this user belong
-- to" — the recursive self-query never happens because the lookup isn't
-- going back through the policy at all.
create or replace function my_organisation_ids() returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  select organisation_id from organisation_members where user_id = auth.uid();
$$;

create policy "organisations_select_member" on organisations
  for select using (id in (select my_organisation_ids()));

create policy "organisation_members_select_same_org" on organisation_members
  for select using (organisation_id in (select my_organisation_ids()));

-- No client insert/update/delete policies on either table. Creating an
-- organisation (sign-up, or a future "add a label" flow) and changing
-- membership are both privileged operations that go through a service-role
-- route, the same posture docs/REPO_AUDIT.md confirms the rest of this
-- codebase already uses for anything that shapes who-can-do-what.

-- ─── Backfill: every existing artist becomes an organisation of one ──────
-- A solo artist is an organisation of one, from the moment this migration
-- runs, not from the moment they next touch a setting. Viewers do not get
-- an organisation — nothing in the product grants viewer-side roles per
-- organisation today, and creating one speculatively per viewer would be
-- exactly the kind of row nobody can explain later.
-- A single CTE generates one uuid per artist and reuses it in both
-- inserts, rather than inserting into organisations and then joining back
-- by name to find it — two artists can share a display_name, and a
-- name-based join back would silently attach the wrong artist to the
-- wrong organisation. Sharing the generated id avoids that entirely.
with new_artists as (
  select p.id as artist_user_id,
         gen_random_uuid() as org_id,
         coalesce(p.display_name, 'Artist') as org_name
    from profiles p
   where p.role = 'artist'
     and not exists (select 1 from organisation_members om where om.user_id = p.id)
),
inserted_orgs as (
  insert into organisations (id, name, kind)
  select org_id, org_name, 'solo' from new_artists
  returning id
)
insert into organisation_members (organisation_id, user_id, role)
select org_id, artist_user_id, 'owner' from new_artists;

notify pgrst, 'reload schema';

-- ─── VERIFICATION ─────────────────────────────────────────────
--
-- V1. Every artist has exactly one organisation, as owner:
--     select p.id, count(om.organisation_id) as org_count
--       from profiles p
--       left join organisation_members om on om.user_id = p.id
--      where p.role = 'artist'
--      group by p.id having count(om.organisation_id) <> 1;
--     -- EXPECT: 0 rows (every artist has exactly one membership).
--
-- V2. No viewer has an organisation:
--     select count(*) from organisation_members om
--       join profiles p on p.id = om.user_id
--      where p.role = 'viewer';
--     -- EXPECT: 0
--
-- V3. A member cannot see another organisation's membership list:
--     -- as user A (member of org 1), querying organisation_members
--     -- for org 2 (user A is not a member) must return 0 rows, not an error.
