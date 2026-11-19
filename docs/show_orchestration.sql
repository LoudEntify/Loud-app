-- Fault-tolerant server-side show orchestration. Safe to re-run.
begin;

create table if not exists public.show_orchestrations (
  show_id uuid primary key references public.shows(id) on delete cascade,
  artist_id uuid not null references auth.users(id) on delete cascade,
  state text not null default 'SCHEDULED',
  version integer not null default 1,
  desired_operation text,
  lease_token uuid,
  lease_owner text,
  lease_expires_at timestamptz,
  recovery_attempts integer not null default 0,
  failed_phase text,
  last_error_code text,
  last_error_message text,
  checkpoints jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint show_orchestrations_state_check check (state in ('DRAFT','SCHEDULED','PREPARING','READY','STARTING','LIVE','ENDING','COMPLETED','FAILED')),
  constraint show_orchestrations_operation_check check (desired_operation is null or desired_operation in ('start','stop','cancel','reconcile'))
);

create table if not exists public.show_orchestration_events (
  id bigint generated always as identity primary key,
  show_id uuid not null references public.shows(id) on delete cascade,
  event_type text not null,
  from_state text,
  to_state text,
  actor_id uuid references auth.users(id) on delete set null,
  data jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);
create index if not exists show_orchestration_events_show_idx on public.show_orchestration_events (show_id, occurred_at, id);
create index if not exists show_orchestrations_lease_idx on public.show_orchestrations (lease_expires_at) where lease_token is not null;

create or replace function public.acquire_show_orchestration_lease(
  p_show_id uuid, p_artist_id uuid, p_operation text, p_lease_token uuid,
  p_lease_owner text, p_lease_seconds integer default 90
) returns setof public.show_orchestrations
language sql security definer set search_path = public
as $$
  update public.show_orchestrations
     set lease_token = p_lease_token,
         lease_owner = p_lease_owner,
         lease_expires_at = now() + make_interval(secs => greatest(10, least(p_lease_seconds, 300))),
         desired_operation = p_operation,
         updated_at = now()
   where show_id = p_show_id
     and artist_id = p_artist_id
     and (lease_token is null or lease_expires_at < now() or lease_token = p_lease_token)
  returning *;
$$;

alter table public.show_orchestrations enable row level security;
alter table public.show_orchestration_events enable row level security;
revoke all on public.show_orchestrations from anon, authenticated;
revoke all on public.show_orchestration_events from anon, authenticated;
revoke all on function public.acquire_show_orchestration_lease(uuid,uuid,text,uuid,text,integer) from public, anon, authenticated;
grant execute on function public.acquire_show_orchestration_lease(uuid,uuid,text,uuid,text,integer) to service_role;

notify pgrst, 'reload schema';
commit;
