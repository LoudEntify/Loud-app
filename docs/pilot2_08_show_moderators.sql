-- pilot2_08_show_moderators.sql
-- Pilot 2, item 7 — a third role: not a performer, not the audience.
--
-- PRD: Live Show / Director Experience, Accounts & Identity
-- S&I: Auth, Real-time media, Database
--
-- ⚠️ PRODUCTION MIGRATION. New table. Nothing existing is touched.
--
-- ── WHY A TABLE RATHER THAN "THE OWNER OPERATES" ──────────────
-- On 20 September the operator is in a different location from both
-- artists and happens to own the show. On 27 September, at a third
-- party's venue, the artist will almost certainly own their own show and
-- the operator will not. Building the cheap version means rebuilding it
-- in the seven days between the two pilots, which is the worst week
-- available.
--
-- So moderation is a GRANT against a show, not a property of ownership.
-- The show's owner is implicitly a moderator and needs no row here; this
-- table is how anyone else becomes one.
--
-- ── CAPABILITIES ARE COLUMNS, NOT A ROLE NAME ─────────────────
-- Go Live and End Show sit with the operator on the 20th and may sit
-- with the performing artist on the 27th. If that were hardcoded to a
-- role name, the 27th is a code change under freeze pressure. It is a
-- boolean instead:
--
--   can_direct            the director console — shot commands, camera
--                         control, prompts.
--   can_moderate          pin a prompt, soft-delete a comment.
--   can_control_lifecycle Go Live and End Show. DEFAULTS FALSE, because
--                         ending somebody else's broadcast is the single
--                         most destructive capability in this product
--                         and should be granted deliberately, one show
--                         at a time.
--
-- ── THIS TABLE IS WHY SENDER VALIDATION IS NOW REQUIRED ───────
-- components/LiveDemo.jsx:2900-2910 applies a SHOT_COMMAND from ANY
-- sender, with no check on msg.from. Every viewer has canPublishData
-- (comments need it). That has never mattered because the only client
-- that sends one is a performer publishing into their own slot.
--
-- A moderator is a SECOND legitimate sender, and one who is not in the
-- room as a performer — so "the sender is a contestant-*" stops being a
-- usable rule at the same moment this table starts being used. Receivers
-- must check msg.from?.identity against the performer prefixes AND the
-- moderator identity for this show. That work ships WITH item 7, not
-- after it.

-- ══════════════════════════════════════════════════════════════
-- PRE-FLIGHT · FK TYPE CHECK
-- ══════════════════════════════════════════════════════════════
--   select table_name, column_name, data_type from information_schema.columns
--    where (table_name = 'shows' and column_name = 'id')
--       or (table_schema = 'auth' and table_name = 'users' and column_name = 'id');
--   -- EXPECT both uuid. A text/uuid mismatch here fails at grant time,
--   -- which is five minutes before a show.

-- ══════════════════════════════════════════════════════════════
-- THE MIGRATION
-- ══════════════════════════════════════════════════════════════

create table if not exists show_moderators (
  id bigint generated always as identity primary key,

  show_id uuid not null references shows(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,

  can_direct            boolean not null default true,
  can_moderate          boolean not null default true,
  can_control_lifecycle boolean not null default false,

  -- Who granted this. An operator appearing on somebody's show with
  -- camera control is a thing that should be attributable after the
  -- fact, not just effective.
  added_by   uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),

  -- Revocation is a timestamp, not a delete: the resolve path filters on
  -- it, and a removed moderator leaves a record that they were one.
  revoked_at timestamptz
);

-- THE CONFLICT TARGET. Referenced by the grant route's
-- `on conflict (show_id, user_id) do update`, so re-granting someone who
-- is already a moderator updates their capabilities instead of erroring
-- or creating a second row with different permissions — which would make
-- "what can this person do" depend on which row was read first.
create unique index if not exists show_moderators_show_user_uidx
  on show_moderators (show_id, user_id);

-- THE HOT PATH: "is this user a moderator on this show", resolved
-- server-side at entry, once per join.
create index if not exists show_moderators_lookup_idx
  on show_moderators (show_id, user_id) where revoked_at is null;

-- ─── RLS: on, with ZERO policies ──────────────────────────────
-- Service-role only, and this one is a security boundary rather than a
-- privacy posture. The client is never trusted to say what it may do:
-- the entry route resolves the grant with the admin client and returns a
-- role, the same way app/api/performer/claim-slot already decides who
-- may publish. A read policy would let a client enumerate who can
-- control a show; a write policy would let it grant itself the right to
-- end one.
alter table show_moderators enable row level security;

notify pgrst, 'reload schema';

-- ══════════════════════════════════════════════════════════════
-- VERIFICATION
-- ══════════════════════════════════════════════════════════════
--
-- V1. Table shape:
--     select column_name, data_type, is_nullable, column_default
--       from information_schema.columns
--      where table_name = 'show_moderators' order by ordinal_position;
--     -- EXPECT 10 rows. can_direct/can_moderate default true;
--     -- (1 of those is `env`, added by docs/pilot2_env_stamp.sql,
--     -- which runs before item 4. Against a database where that has
--     -- not run yet, expect 9.)
--     -- can_control_lifecycle DEFAULT FALSE — check this one
--     -- specifically, it is the destructive capability.
--
-- V2. FKs, and both cascades:
--     select conname, pg_get_constraintdef(oid) from pg_constraint
--      where conrelid = 'show_moderators'::regclass and contype = 'f';
--     -- EXPECT 3: show_id -> shows CASCADE, user_id -> auth.users
--     -- CASCADE, added_by -> auth.users SET NULL. The two CASCADEs
--     -- matter: a deleted show or a closed account must not leave a
--     -- live grant behind.
--
-- V3. THE CONFLICT TARGET — re-granting updates rather than duplicating:
--     begin;
--       insert into show_moderators (show_id, user_id)
--         values ((select id from shows limit 1), (select id from auth.users limit 1));
--       insert into show_moderators (show_id, user_id, can_control_lifecycle)
--         values ((select id from shows limit 1), (select id from auth.users limit 1), true)
--         on conflict (show_id, user_id) do update
--            set can_control_lifecycle = excluded.can_control_lifecycle;
--       select count(*) as rows, bool_or(can_control_lifecycle) as lifecycle
--         from show_moderators where show_id = (select id from shows limit 1);
--       -- EXPECT: rows = 1, lifecycle = t. Two rows means "what can this
--       -- person do" has two answers.
--     rollback;
--
-- V4. RLS on, zero policies. THIS IS THE SECURITY CHECK, not a
--     formality — a SELECT policy here leaks who controls a show, and an
--     INSERT policy lets a viewer grant themselves End Show:
--     select relrowsecurity from pg_class where relname = 'show_moderators'; -- EXPECT t
--     select count(*) from pg_policies where tablename = 'show_moderators';  -- EXPECT 0
--
-- V5. Anon cannot read it. Run from the app's anon key, not the SQL
--     editor (the editor is service-role and will always succeed):
--       curl "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/show_moderators?select=*" \
--         -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY"
--     -- EXPECT: an empty array or a permission error. NOT rows.
--
-- V6. Indexes:
--     select indexname from pg_indexes where tablename = 'show_moderators' order by 1;
--     -- EXPECT show_moderators_lookup_idx, show_moderators_pkey,
--     -- show_moderators_show_user_uidx.
--
-- V7. Round-trip, before the dress rehearsal. Grant yourself moderator
--     on a show you do NOT own, from a second account, and confirm the
--     entry path returns the moderator role:
--     select s.room_name, m.can_direct, m.can_moderate, m.can_control_lifecycle
--       from show_moderators m join shows s on s.id = m.show_id
--      where m.revoked_at is null;
--     -- EXPECT your grant. Then join that show and confirm you get the
--     -- director console and DO NOT get a publish token.
