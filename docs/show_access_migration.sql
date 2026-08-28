-- show access model: codes retired, accounts and invites take over
-- Run manually in the Supabase SQL editor. Idempotent.
--
-- WHAT CHANGES
--   Solo: performer codes are GONE. The scheduling artist's account is
--     the authorization -- logged in + owns the show + inside the window.
--     There is no code to type, lose, or share by accident.
--   Versus: the code is replaced by a single-use INVITE bound to slot B.
--     The opponent accepts while logged in, which binds the slot to their
--     user id. Same first-claim-wins and 403-on-mismatch semantics the
--     code flow already had -- that machinery is reused, only what
--     proves identity changed.
--
-- `code` is kept as a nullable legacy column rather than dropped: old
-- rows still carry one, and dropping a column is the one migration you
-- cannot walk back.

-- ─── 1. show_slots: invites replace codes ─────────────────────
alter table show_slots add column if not exists invite_token       uuid;
alter table show_slots add column if not exists invited_username   text;
alter table show_slots add column if not exists invite_accepted_at timestamptz;

-- A slot row is created for every scheduled show now (solo: one row,
-- pre-bound to the scheduling artist; versus: two, with slot B carrying
-- an invite). `code` must therefore be nullable.
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_name = 'show_slots' and column_name = 'code' and is_nullable = 'NO'
  ) then
    alter table show_slots alter column code drop not null;
  end if;
end $$;

-- Invite tokens are looked up directly by the accept flow, and must be
-- unique -- a token that matches two slots is an ambiguity you find out
-- about live.
create unique index if not exists show_slots_invite_token_idx
  on show_slots (invite_token) where invite_token is not null;

create index if not exists show_slots_show_idx on show_slots (show_id, slot);

-- One claim per (show, slot). This is the first-claim-wins guarantee
-- expressed as a constraint rather than as application timing.
create unique index if not exists show_slots_show_slot_idx
  on show_slots (show_id, slot);

-- ─── 2. camfeed device pairing ────────────────────────────────
-- Extra cameras are DEVICES, not people. A phone gaffer-taped to a mic
-- stand has no account and should not need one, so it pairs with a
-- short-lived code scoped to one show and one slot -- deliberately a
-- different job from the retired performer code, which proved WHO you
-- were. This proves only that the device was handed the code by someone
-- who could already see the artist's dashboard.
create table if not exists camfeed_pairings (
  id          uuid primary key default gen_random_uuid(),
  show_id     uuid not null references shows(id) on delete cascade,
  slot        text not null,
  code        text not null,
  created_by  uuid references auth.users(id) on delete cascade,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);

create unique index if not exists camfeed_pairings_code_idx on camfeed_pairings (code);
create index if not exists camfeed_pairings_show_idx on camfeed_pairings (show_id);

alter table camfeed_pairings enable row level security;
-- Zero policies: only the service-role routes touch this, same posture
-- as show_slots. A pairing code must never be readable by the anon key,
-- or the code stops meaning anything.

notify pgrst, 'reload schema';

-- ─── VERIFICATION ─────────────────────────────────────────────
-- 1. New columns:
--    select column_name, data_type, is_nullable from information_schema.columns
--     where table_name='show_slots'
--       and column_name in ('invite_token','invited_username','invite_accepted_at','code')
--     order by column_name;
--    -- expect 4 rows; `code` is_nullable = YES.
--
-- 2. Indexes:
--    select indexname from pg_indexes where tablename='show_slots' order by indexname;
--    -- expect show_slots_invite_token_idx and show_slots_show_slot_idx present.
--
-- 3. One claim per slot really is enforced (should ERROR on the second):
--    begin;
--      insert into show_slots (show_id, slot) select id, 'zz' from shows limit 1;
--      insert into show_slots (show_id, slot) select id, 'zz' from shows limit 1;
--    rollback;
--    -- expect: duplicate key value violates unique constraint
--    -- (skip if you have no shows yet.)
--
-- 4. Pairings table + locked down:
--    select count(*) from information_schema.tables where table_name='camfeed_pairings';
--    -- expect 1
--    select count(*) from pg_policies where tablename='camfeed_pairings';
--    -- expect 0 -- service-role only, by design.
--
-- 5. End to end, after scheduling a VERSUS show on the app:
--    select slot, claimed_by_user_id is not null as bound,
--           invite_token is not null as has_invite, invite_accepted_at
--      from show_slots
--     where show_id = (select id from shows order by created_at desc limit 1)
--     order by slot;
--    -- expect slot a: bound=true, has_invite=false
--    --        slot b: bound=false, has_invite=true, accepted_at null
--    -- then after your opponent accepts, slot b flips to bound=true with
--    -- a timestamp, and has_invite goes false (the token is consumed).
