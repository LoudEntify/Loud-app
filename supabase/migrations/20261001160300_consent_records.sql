-- Consent and preference records, including the training-data choice.
--
-- docs/ARCHITECTURE.md's training-data section is explicit about the
-- shape this needs: an opt-out toggle (on by default) for AI-director
-- training, presented as "a clear, separate line at sign-up... never
-- hidden behind a link", switchable at any time afterwards in Settings,
-- "with the change taking effect from that moment and recorded in the
-- audit log", shown only to people who chose to perform (viewers are
-- excluded entirely), and a basis the architecture doc says rests on
-- legitimate interests, not consent — which is exactly why this is named
-- "consent_records" generically rather than "training_consent": terms
-- acceptance and marketing email (both real, both in
-- docs/ARCHITECTURE.md's privacy table) belong in the same shape.
--
-- Every change is a NEW row, never an UPDATE — "switched off... with the
-- change taking effect from that moment" means the history of when
-- someone's choice changed is itself the record. The current status for
-- a (user, consent_type) pair is always its latest row by recorded_at.

create table if not exists consent_records (
  id             bigint generated always as identity primary key,
  user_id        uuid not null references auth.users(id) on delete cascade,
  -- 'training_data' is the one ARCHITECTURE.md walks through in detail.
  -- 'terms' and 'marketing_email' are named in its privacy table as real,
  -- separate lawful-basis lines; included now so the shape doesn't need
  -- redoing when the sign-up flow actually wires them (Phase 2/3 work,
  -- not this migration).
  consent_type   text not null check (consent_type in ('training_data', 'terms', 'marketing_email')),
  granted        boolean not null,
  -- Where the choice was made: 'signup', 'settings', or a specific flow
  -- name. Free text rather than a CHECK — new surfaces where someone can
  -- change a consent will keep appearing and a blocked insert here is
  -- worse than an inconsistent label.
  source         text not null,
  recorded_at    timestamptz not null default now()
);

create index if not exists consent_records_user_type_idx
  on consent_records (user_id, consent_type, recorded_at desc);

alter table consent_records enable row level security;

-- A user can read their own consent history (Settings needs to show the
-- current state, and "download my data" needs the full history).
create policy "consent_records_select_own" on consent_records
  for select using (auth.uid() = user_id);

-- A user can record their own consent change directly — this has to be
-- instant (toggling a Settings switch cannot wait on a server round trip
-- through a review queue), and it is always and only a row about the
-- caller's own choice, never anyone else's, enforced by the WITH CHECK.
create policy "consent_records_insert_own" on consent_records
  for insert with check (auth.uid() = user_id);

-- No UPDATE or DELETE policy for anyone, including via this table's own
-- RLS -- a change is a new row, per the file header. This is enforced by
-- absence here rather than a trigger, because unlike wallet_transactions
-- and the audit log there is no service-role write path to this table
-- that a trigger would need to also block -- every writer is a user
-- writing their own row, and RLS with no UPDATE/DELETE policy already
-- stops that completely.

-- Every consent change is itself an audited event, structurally rather
-- than by convention -- ARCHITECTURE.md: "every change recorded in the
-- audit log". This writes to audit.audit_log directly from a trigger so
-- it is impossible to add a consent_records row through the normal
-- insert path without it being logged.
--
-- SECURITY DEFINER, deliberately: the caller is an ordinary authenticated
-- user (consent_records_insert_own lets them write their own row), but
-- audit.audit_log has zero client-facing RLS policies by design (see
-- 20261001160100_audit_log.sql) -- nothing with the authenticated role
-- can insert into it directly. This function runs as its owner instead,
-- so a user's own consent change can reach the audit log without opening
-- audit.audit_log itself to every signed-in session. `set search_path`
-- pins name resolution inside the function so it cannot be redirected by
-- a caller-controlled search_path -- the standard SECURITY DEFINER
-- precaution.
create or replace function log_consent_change() returns trigger
language plpgsql
security definer
set search_path = public, audit
as $$
begin
  insert into audit.audit_log (actor_id, actor_type, action, subject_type, subject_id, after_value)
  values (
    new.user_id,
    'viewer_or_artist', -- the audit log does not need to know which; profiles.role already records that
    'consent.' || new.consent_type || case when new.granted then '.granted' else '.withdrawn' end,
    'consent_records',
    new.id::text,
    jsonb_build_object('consent_type', new.consent_type, 'granted', new.granted, 'source', new.source)
  );
  return new;
end;
$$;

drop trigger if exists consent_records_audit on consent_records;
create trigger consent_records_audit
  after insert on consent_records
  for each row execute function log_consent_change();

notify pgrst, 'reload schema';

-- ─── VERIFICATION ─────────────────────────────────────────────
--
-- V1. A user can write their own consent and read it back:
--     insert into consent_records (user_id, consent_type, granted, source)
--       values (auth.uid(), 'training_data', false, 'settings');
--     select * from consent_records where user_id = auth.uid() order by recorded_at desc limit 1;
--     -- EXPECT: 1 row, granted = false.
--
-- V2. The write produced an audit entry:
--     select action, subject_type, after_value from audit.audit_log
--      where subject_type = 'consent_records' order by id desc limit 1;
--     -- EXPECT: action = 'consent.training_data.withdrawn', after_value
--     -- matches what was written in V1.
--
-- V3. A user cannot write a consent row for someone else:
--     insert into consent_records (user_id, consent_type, granted, source)
--       values ('<some other uuid>', 'training_data', false, 'settings');
--     -- EXPECT: fails the RLS WITH CHECK (0 rows affected / policy violation).
--
-- V4. Nobody can UPDATE or DELETE a consent row, including its own owner:
--     update consent_records set granted = true where user_id = auth.uid();
--     -- EXPECT: 0 rows affected (no UPDATE policy exists to allow it).
