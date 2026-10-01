-- The audit log.
--
-- docs/ARCHITECTURE.md: "Build it first. SOC 2 Type II needs a continuous
-- evidence period, so an audit log added in month ten gives an audit that
-- can only start in month ten." Must be: separate, append-only,
-- tamper-evident (hash-chained), queryable by actor/subject/action/time/
-- correlation id, and complete but clean (records that something
-- happened, never message contents or card numbers).
--
-- HONEST LIMIT, stated rather than hidden: ARCHITECTURE.md wants this in
-- "a separate account entirely, write-only from the app." A single
-- Supabase project has one database — true separate-account isolation
-- needs a second Supabase project (or a log sink outside Supabase
-- entirely) and is an infrastructure decision, not a migration. This
-- migration gets as far as a migration can: its own schema (not `public`),
-- RLS enabled with zero client policies (nothing reachable via the anon or
-- authenticated roles, read or write), and a hash chain that makes tampering
-- provable rather than merely against policy. See docs/NEEDS_KOREY.md for
-- the separate-project option when that's worth the operational cost.

create extension if not exists pgcrypto; -- digest() for the hash chain

create schema if not exists audit;

create table if not exists audit.audit_log (
  id              bigint generated always as identity primary key,
  occurred_at     timestamptz not null default now(),
  -- Who did it. actor_type covers the roles docs/ARCHITECTURE.md names
  -- (viewer/artist/operator/support/admin/finance/engineer/build_agent);
  -- actor_id is nullable because a few actions (a scheduled job, a
  -- webhook from a payment provider) have no human or user-row actor.
  actor_id        uuid,
  actor_type      text not null,
  -- What happened, and to what. action is a short, stable string
  -- ('sign_in', 'payout.approved', 'youtube.disconnected', ...) — a fixed
  -- vocabulary enforced at the application layer, not a CHECK constraint,
  -- because ARCHITECTURE.md's own action list (auth, money, consent,
  -- content, grants, configuration, third-party connections, show
  -- control, release/agent actions) will grow and a CHECK that blocks a
  -- new, legitimate action type is worse than an inconsistent string.
  action          text not null,
  subject_type    text not null,
  subject_id      text,
  correlation_id  uuid,
  -- Before/after for anything that changed a value. jsonb, and the
  -- discipline of what goes in here is an application concern: "records
  -- that an action happened, not the contents of a private message or a
  -- card number" (ARCHITECTURE.md) is enforced by what callers pass in,
  -- not by this schema — a database column cannot know what a value means.
  before_value    jsonb,
  after_value     jsonb,
  metadata        jsonb not null default '{}'::jsonb,
  -- The hash chain. prev_hash is this row's predecessor's row_hash (null
  -- only for the very first row ever written). row_hash is computed by
  -- the trigger below, never supplied by the caller — a client that could
  -- set its own row_hash could forge the chain.
  prev_hash       text,
  row_hash        text not null
);

create index if not exists audit_log_actor_idx on audit.audit_log (actor_id, occurred_at desc);
create index if not exists audit_log_subject_idx on audit.audit_log (subject_type, subject_id, occurred_at desc);
create index if not exists audit_log_correlation_idx on audit.audit_log (correlation_id);
create index if not exists audit_log_action_idx on audit.audit_log (action, occurred_at desc);

-- The chain. BEFORE INSERT so row_hash is computed and stored atomically
-- with the row it describes — there is no window where a row exists
-- without its hash. prev_hash is read from the current last row; row_hash
-- is sha256 of prev_hash concatenated with a canonical (ordered-key)
-- representation of this row's own content, so any single-row edit or
-- removal breaks every subsequent row's hash, not just the tampered one.
create or replace function audit.compute_row_hash() returns trigger
language plpgsql as $$
declare
  last_hash text;
begin
  select row_hash into last_hash from audit.audit_log order by id desc limit 1;
  new.prev_hash := last_hash;
  new.row_hash := encode(
    digest(
      coalesce(last_hash, '') || '|' ||
      new.occurred_at::text || '|' ||
      coalesce(new.actor_id::text, '') || '|' ||
      new.actor_type || '|' ||
      new.action || '|' ||
      new.subject_type || '|' ||
      coalesce(new.subject_id, '') || '|' ||
      coalesce(new.correlation_id::text, '') || '|' ||
      coalesce(new.before_value::text, '') || '|' ||
      coalesce(new.after_value::text, '') || '|' ||
      new.metadata::text,
      'sha256'
    ),
    'hex'
  );
  return new;
end;
$$;

drop trigger if exists audit_log_hash_chain on audit.audit_log;
create trigger audit_log_hash_chain
  before insert on audit.audit_log
  for each row execute function audit.compute_row_hash();

-- APPEND-ONLY, enforced by the database, same pattern as
-- wallet_transactions_append_only (docs/overnight2_06_wallet_transactions.sql)
-- and for the same reason: "the server code doesn't do that" is not a
-- guarantee, a trigger is. This one has no documented escape hatch,
-- deliberately — a wallet correction is a compensating row; an audit log
-- correction is also a compensating row, there is never a legitimate
-- reason to UPDATE or DELETE a past entry.
create or replace function audit.audit_log_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'audit.audit_log is append-only: % is not permitted.', tg_op;
end;
$$;

drop trigger if exists audit_log_append_only on audit.audit_log;
create trigger audit_log_append_only
  before update or delete on audit.audit_log
  for each row execute function audit.audit_log_append_only();

alter table audit.audit_log enable row level security;
-- Zero policies. Not reachable via PostgREST under the anon or
-- authenticated roles at all — every write goes through a service-role
-- helper (to be added alongside the first caller in Phase 1/2), and every
-- read is an internal/support/admin tool, not a product surface, until
-- there is a reason to build one.

-- A daily root hash, per ARCHITECTURE.md ("A daily root hash is published
-- internally, which turns tampering into something provable rather than
-- suspected"). This view, not a stored table — the root hash for a day is
-- always the row_hash of that day's last entry, so it needs no separate
-- bookkeeping and cannot itself drift out of sync with the chain.
create or replace view audit.daily_root_hash as
select occurred_at::date as day,
       (array_agg(row_hash order by id desc))[1] as root_hash,
       count(*) as entries
  from audit.audit_log
 group by occurred_at::date;

notify pgrst, 'reload schema';

-- ─── VERIFICATION ─────────────────────────────────────────────
--
-- V1. The chain links correctly:
--     insert into audit.audit_log (actor_type, action, subject_type, subject_id)
--       values ('build_agent', 'test.chain.1', 'test', 'a');
--     insert into audit.audit_log (actor_type, action, subject_type, subject_id)
--       values ('build_agent', 'test.chain.2', 'test', 'b');
--     select id, prev_hash, row_hash from audit.audit_log order by id desc limit 2;
--     -- EXPECT: the second row's prev_hash equals the first row's row_hash.
--
-- V2. Tampering is detectable: manually recompute row N's hash from its
--     stored fields and prev_hash; it must match row_hash exactly. If a
--     row's content is edited (which V3 shows is impossible via SQL, but
--     could happen via a storage-level restore), its row_hash no longer
--     recomputes correctly and neither does anything chained after it.
--
-- V3. Append-only actually bites:
--     update audit.audit_log set action = 'tampered' where id = 1;
--     -- EXPECT: ERROR — audit.audit_log is append-only: UPDATE is not permitted.
--     delete from audit.audit_log where id = 1;
--     -- EXPECT: the same error, for DELETE.
--
-- V4. Nothing reachable from the anon/authenticated roles:
--     -- as a normal signed-in user (not service role):
--     select * from audit.audit_log limit 1;
--     -- EXPECT: permission denied, or empty result with zero policies — not real rows.
