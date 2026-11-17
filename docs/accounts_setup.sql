-- Artist and fan account foundation. Run in the Supabase SQL Editor.
-- Separate from waitlist_signups: a waitlist entry never creates an account.
-- Idempotent; preserves existing profile rows and unrelated tables.

begin;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('artist', 'viewer')),
  display_name text not null,
  created_at timestamptz not null default now()
);

alter table public.profiles
  add column if not exists genres text[] not null default '{}',
  add column if not exists full_name text,
  add column if not exists username text,
  add column if not exists date_of_birth date,
  add column if not exists country text;

create unique index if not exists profiles_username_key
  on public.profiles (username) where username is not null;

alter table public.profiles enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles_select_own') then
    create policy profiles_select_own on public.profiles for select to authenticated using (auth.uid() = id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles_insert_own') then
    create policy profiles_insert_own on public.profiles for insert to authenticated with check (auth.uid() = id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles_update_own') then
    create policy profiles_update_own on public.profiles for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.profiles'::regclass and conname = 'profiles_min_age_18') then
    alter table public.profiles add constraint profiles_min_age_18
      check (date_of_birth is null or date_of_birth <= (current_date - interval '18 years')) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.profiles'::regclass and conname = 'profiles_country_iso2') then
    alter table public.profiles add constraint profiles_country_iso2
      check (country is null or country ~ '^[A-Z]{2}$') not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.profiles'::regclass and conname = 'profiles_username_format') then
    alter table public.profiles add constraint profiles_username_format
      check (username is null or username ~ '^[a-z0-9_]{3,20}$') not valid;
  end if;
end $$;

-- Profiles contain private account fields; this migration grants owner access only.
grant select, insert, update on public.profiles to authenticated;

notify pgrst, 'reload schema';
commit;
