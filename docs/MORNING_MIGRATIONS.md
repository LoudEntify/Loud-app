# MORNING MIGRATIONS — overnight build #2

**Everything you need to run, in order, with the answer you should get.**
Paste a file, run it, paste the verification block underneath, compare. No
thinking required. If a verification does not match, stop at that step — the
files after it assume this one worked.

- **11 files**, `docs/overnight2_01_*.sql` → `docs/overnight2_11_*.sql`.
- **Every file is idempotent.** Re-running any of them is a no-op.
- **Every file ends with `notify pgrst, 'reload schema'`.** Without it PostgREST
  keeps serving the old column list and the app 400s on columns that exist.
- **Run them in the Supabase SQL editor, as the project owner.** They are not
  applied by the app and never will be.

**Before you start**, note what already works WITHOUT any of this. The branch
preview renders and is usable right now; every schema-dependent capability
probes for its columns and degrades with a sentence on screen rather than an
error. So there is no rush, and no half-state to be afraid of — you can run
one file, check the app, and stop.

**Total time**: about 15 minutes including verification.

---

## Run order at a glance

| # | File | Adds | Switches on |
|---|------|------|-------------|
| 01 | `overnight2_01_camfeed_pairings.sql` | 8 columns, 2 indexes | Multi-camera pairing + cameras following you into the show |
| 02 | `overnight2_02_profiles.sql` | 6 columns, 1 check, 1 index | Onboarding progress, account closure, cash-out eligibility |
| 03 | `overnight2_03_follows.sql` | new table `follows` | The FOLLOW button, follow suggestions |
| 04 | `overnight2_04_account_requests.sql` | new table `account_requests` | Data-export rate limiting + audit trail |
| 05 | `overnight2_05_shows.sql` | 2 columns, 1 index | Cancelled ≠ ended, for account closure |
| 06 | `overnight2_06_wallet_transactions.sql` | 4 columns, 1 index, new kinds, **append-only trigger** | Payments into the ledger, safely |
| 07 | `overnight2_07_payment_intents.sql` | new table `payment_intents` | Buying tokens |
| 08 | `overnight2_08_webhook_events.sql` | new table `webhook_events` | Webhook idempotency — no double credits |
| 09 | `overnight2_09_cashout_requests.sql` | new table `cashout_requests` | KYC-gated cash-out requests |
| 10 | `overnight2_10_recordings.sql` | 9 columns, 1 check, 2 indexes | "Did the recording actually work", saved clip ranges |
| 11 | `overnight2_11_reaction_events.sql` | new table `reaction_events` | Recording reactions (the feature itself needs no DB) |

Dependency notes: **02 must run before 09** (cash-out reads `profiles.kyc_status`)
and **before 05** is convenient but not required. **06 must run before 07/08/09**
(they all write ledger rows). Everything else is independent — but the numbered
order is safe end to end, so just go 01 → 11.

---

## 01 · `overnight2_01_camfeed_pairings.sql`

**Switches on:** pairing more than one camera, and paired phones following you
from Kit Check into the live show without being touched.

Paste the file. Then:

```sql
-- V1 · columns
select column_name, data_type, is_nullable, column_default
  from information_schema.columns
 where table_name = 'camfeed_pairings'
   and column_name in ('role','context','target_room','generation',
                       'device_secret_hash','device_identity',
                       'revoked_at','last_seen_at')
 order by column_name;
```
**EXPECT 8 rows.** `context` text NO `'rehearsal'::text` · `device_identity` text YES · `device_secret_hash` text YES · `generation` integer NO `1` · `last_seen_at` timestamptz YES · `revoked_at` timestamptz YES · `role` text YES · `target_room` text YES.

```sql
-- V2 · indexes
select indexname from pg_indexes where tablename = 'camfeed_pairings' order by indexname;
```
**EXPECT** to include `camfeed_pairings_code_idx`, `camfeed_pairings_device_idx`, `camfeed_pairings_owner_live_idx`, `camfeed_pairings_pkey`, `camfeed_pairings_show_idx`.

```sql
-- V3 · RLS on, ZERO policies (a pairing row is a camera credential)
select relrowsecurity from pg_class where relname = 'camfeed_pairings';
select count(*) as policy_count from pg_policies where tablename = 'camfeed_pairings';
```
**EXPECT** `t`, then `0`. **Any policy here is wrong** — it would let a browser read a camera credential.

```sql
-- V4 · the migration semantics the handover depends on
begin;
  insert into camfeed_pairings (slot, code, created_by, expires_at, role, context)
    select 'a', 'ZZPROBE', id, now() + interval '10 minutes', 'wide', 'rehearsal'
      from auth.users limit 1
    returning generation, target_room;
  -- EXPECT: generation 1, target_room null
  update camfeed_pairings set target_room = 'show-probe', generation = generation + 1
   where code = 'ZZPROBE' returning generation, target_room;
  -- EXPECT: generation 2, target_room 'show-probe'
rollback;
```

---

## 02 · `overnight2_02_profiles.sql`

**Switches on:** onboarding progress that follows the account across devices,
account closure, and cash-out eligibility.

Paste the file. Then:

```sql
-- V1 · columns
select column_name, data_type, is_nullable, column_default
  from information_schema.columns
 where table_name = 'profiles'
   and column_name in ('onboarding','deactivated_at','deactivation_reason',
                       'retained_stage_name','kyc_status','kyc_updated_at')
 order by column_name;
```
**EXPECT 6 rows.** `deactivated_at` timestamptz YES · `deactivation_reason` text YES · `kyc_status` text **NO** `'none'::text` · `kyc_updated_at` timestamptz YES · `onboarding` jsonb **NO** `'{}'::jsonb` · `retained_stage_name` text YES.

```sql
-- V2 · the kyc check exists and is valid
select conname, convalidated from pg_constraint where conname = 'profiles_kyc_status_valid';
```
**EXPECT** 1 row, `convalidated = t`.

```sql
-- V3 · and it bites
begin;
  update profiles set kyc_status = 'verifed' where id = (select id from profiles limit 1);
rollback;
```
**EXPECT: ERROR** — violates check constraint `profiles_kyc_status_valid`. (A silent success here means cash-out could be gated on a typo.)

```sql
-- V4 · index
select indexname, indexdef from pg_indexes
 where tablename = 'profiles' and indexname = 'profiles_active_idx';
```
**EXPECT** 1 row, indexdef containing `WHERE (deactivated_at IS NULL)`.

```sql
-- V5 · policies UNCHANGED — four, no more
select policyname, cmd from pg_policies where tablename = 'profiles' order by policyname;
```
**EXPECT exactly 4:** `profiles_insert_own` INSERT · `profiles_select_own` SELECT · `profiles_select_public_artists` SELECT · `profiles_update_own` UPDATE.
**If there are five, something added one that this file did not.**

---

## 03 · `overnight2_03_follows.sql`

**Switches on:** the FOLLOW button on artist profiles, and viewer onboarding's
follow step.

Paste the file. Then:

```sql
-- V1 · table and keys
select conname, contype, pg_get_constraintdef(oid)
  from pg_constraint where conrelid = 'follows'::regclass order by conname;
```
**EXPECT 3 rows:** `follows_pkey` (p) `PRIMARY KEY (follower_id, artist_id)`, plus two foreign keys to `auth.users`, both `ON DELETE CASCADE`.

```sql
-- V2 · RLS on, four policies, NO update
select relrowsecurity from pg_class where relname = 'follows';
select policyname, cmd from pg_policies where tablename = 'follows' order by policyname;
```
**EXPECT** `t`, then **exactly 4:** `follows_delete_own` DELETE · `follows_insert_own` INSERT · `follows_select_as_artist` SELECT · `follows_select_own` SELECT.
**Any UPDATE row is wrong** — it would be a way to rewrite who followed whom.

```sql
-- V3 · the conflict target the app uses is inferrable
--      (skip if you have fewer than 2 auth.users rows)
begin;
  insert into follows (follower_id, artist_id)
    select a.id, b.id from auth.users a, auth.users b where a.id <> b.id limit 1
    on conflict (follower_id, artist_id) do nothing;
  insert into follows (follower_id, artist_id)
    select a.id, b.id from auth.users a, auth.users b where a.id <> b.id limit 1
    on conflict (follower_id, artist_id) do nothing;
rollback;
```
**EXPECT** both statements succeed; the second inserts 0 rows. **A `42P10` here means the key is not what the app thinks it is.**

---

## 04 · `overnight2_04_account_requests.sql`

**Switches on:** the rate limit and audit trail behind "request my data" and
"close my account".

Paste the file. Then:

```sql
-- V1 · shape
select column_name, data_type, is_nullable, column_default
  from information_schema.columns
 where table_name = 'account_requests' order by ordinal_position;
```
**EXPECT 7 rows:** `id` uuid NO `gen_random_uuid()` · `user_id` uuid NO · `kind` text NO · `status` text NO `'completed'::text` · `detail` jsonb NO `'{}'::jsonb` · `created_at` timestamptz NO `now()` · `completed_at` timestamptz YES.

```sql
-- V2 · RLS on, exactly ONE policy, and it is a SELECT
select relrowsecurity from pg_class where relname = 'account_requests';
select policyname, cmd from pg_policies where tablename = 'account_requests';
```
**EXPECT** `t`, then **exactly 1:** `account_requests_select_own` SELECT.
**An INSERT policy here silently breaks the rate limit** — a client that can write rows can also write zero of them.

```sql
-- V3 · indexes
select indexname from pg_indexes where tablename = 'account_requests' order by indexname;
```
**EXPECT** `account_requests_pkey`, `account_requests_user_kind_idx`.

---

## 05 · `overnight2_05_shows.sql`

**Switches on:** a cancelled show reading as cancelled rather than as one that
happened and ended.

Paste the file. Then:

```sql
-- V1 · columns
select column_name, data_type, is_nullable
  from information_schema.columns
 where table_name = 'shows' and column_name in ('cancelled_at','cancelled_reason')
 order by column_name;
```
**EXPECT 2 rows:** `cancelled_at` timestamptz YES · `cancelled_reason` text YES.

```sql
-- V2 · index is partial
select indexname, indexdef from pg_indexes
 where tablename = 'shows' and indexname = 'shows_cancelled_idx';
```
**EXPECT** 1 row, indexdef containing `WHERE (cancelled_at IS NOT NULL)`.

```sql
-- V3 · policies UNCHANGED — this file adds none
select policyname, cmd from pg_policies where tablename = 'shows' order by policyname;
```
**EXPECT** the same set as before tonight (`insert_shows` INSERT, `update_shows` UPDATE, plus whatever SELECT policy the project already had). **Nothing named "cancel" should appear.**

---

## 06 · `overnight2_06_wallet_transactions.sql`

**Switches on:** money into the ledger, safely. **This is the most important
file in the run.** Do not skip V5.

Paste the file. Then:

```sql
-- V1 · columns
select column_name, data_type, is_nullable, column_default
  from information_schema.columns
 where table_name = 'wallet_transactions'
   and column_name in ('idempotency_key','amount_minor','currency','metadata')
 order by column_name;
```
**EXPECT 4 rows:** `amount_minor` **bigint** YES · `currency` text YES · `idempotency_key` text YES · `metadata` jsonb NO `'{}'::jsonb`.
**If `amount_minor` is `numeric` or `double precision`, stop** — money must be an integer.

```sql
-- V2 · the idempotency index exists and is NOT partial
select indexname, indexdef from pg_indexes
 where tablename = 'wallet_transactions' and indexname = 'wallet_tx_idempotency_idx';
```
**EXPECT** 1 row, and **the indexdef must contain NO `WHERE` clause.** A partial index here 400s every payment webhook.

```sql
-- V3 · the conflict target is inferrable (the webhook's own query)
begin;
  insert into wallet_transactions (user_id, amount_tokens, kind, idempotency_key)
    select id, 100, 'purchase', 'zz-probe-1' from auth.users limit 1
    on conflict (idempotency_key) do nothing;
  insert into wallet_transactions (user_id, amount_tokens, kind, idempotency_key)
    select id, 100, 'purchase', 'zz-probe-1' from auth.users limit 1
    on conflict (idempotency_key) do nothing;
  select count(*) from wallet_transactions where idempotency_key = 'zz-probe-1';
rollback;
```
**EXPECT** count `1`. A `42P10` means the index is partial — go back to V2.

```sql
-- V4 · the new kinds are accepted, nonsense is not
begin;
  insert into wallet_transactions (user_id, amount_tokens, kind)
    select id, -5, 'reaction_spend' from auth.users limit 1;
  -- EXPECT: succeeds
  insert into wallet_transactions (user_id, amount_tokens, kind)
    select id, -5, 'not_a_real_kind' from auth.users limit 1;
  -- EXPECT: ERROR violates check constraint "wallet_transactions_kind_check"
rollback;
```

```sql
-- V5 · ★ APPEND-ONLY ACTUALLY BITES ★ (run as the SQL editor, i.e. the
--      most privileged caller there is — that is the point)
begin;
  insert into wallet_transactions (user_id, amount_tokens, kind)
    select id, 1, 'adjustment' from auth.users limit 1;
  update wallet_transactions set amount_tokens = 999999
   where kind = 'adjustment' and amount_tokens = 1;
rollback;
```
**EXPECT: ERROR** — `wallet_transactions is append-only: UPDATE is not permitted.`

```sql
begin;
  delete from wallet_transactions where kind = 'adjustment';
rollback;
```
**EXPECT: the same error, for DELETE.**

**If either of those succeeds, the trigger did not install.** Nothing else in this run matters as much: it is the difference between a ledger and a spreadsheet.

```sql
-- V6 · policies unchanged — exactly one, a SELECT
select policyname, cmd from pg_policies where tablename = 'wallet_transactions';
```
**EXPECT exactly 1:** `wallet_tx_select_own` SELECT.

---

## 07 · `overnight2_07_payment_intents.sql`

**Switches on:** buying tokens.

Paste the file. Then:

```sql
-- V1 · money is integer, and nothing here could hold a card
select column_name, data_type, is_nullable
  from information_schema.columns
 where table_name = 'payment_intents' order by ordinal_position;
```
**EXPECT** `amount_minor` **bigint** NOT NULL, `tokens` **bigint** NOT NULL, `currency` text NOT NULL.
**EXPECT no column** named anything like card / pan / cvc / number / expiry.

```sql
-- V2 · RLS on, exactly one policy, SELECT only
select relrowsecurity from pg_class where relname = 'payment_intents';
select policyname, cmd from pg_policies where tablename = 'payment_intents';
```
**EXPECT** `t`, then **exactly 1:** `payment_intents_select_own` SELECT.
An INSERT policy here would let a browser mint itself a paid intent.

```sql
-- V3 · indexes, and provider_ref is NOT partial
select indexname, indexdef from pg_indexes
 where tablename = 'payment_intents' order by indexname;
```
**EXPECT** `payment_intents_pkey`, `payment_intents_provider_ref_idx`, `payment_intents_user_idx`. The provider_ref indexdef must have no `WHERE`.

---

## 08 · `overnight2_08_webhook_events.sql`

**Switches on:** webhook idempotency. Without this, a redelivered payment event
double-credits.

Paste the file. Then:

```sql
-- V1 · RLS on, ZERO policies
select relrowsecurity from pg_class where relname = 'webhook_events';
select count(*) as policy_count from pg_policies where tablename = 'webhook_events';
```
**EXPECT** `t`, then `0`. Any policy here exposes raw payment payloads to a browser.

```sql
-- V2 · the idempotency index is NOT partial
select indexname, indexdef from pg_indexes
 where tablename = 'webhook_events' order by indexname;
```
**EXPECT** `webhook_events_pkey`, `webhook_events_provider_event_idx`, `webhook_events_recent_idx`. The provider_event indexdef must have **no `WHERE`**.

```sql
-- V3 · ★ THE GUARD BITES ★
begin;
  insert into webhook_events (provider, event_id, event_type)
    values ('dev', 'evt_zz_probe', 'checkout.completed');
  insert into webhook_events (provider, event_id, event_type)
    values ('dev', 'evt_zz_probe', 'checkout.completed');
rollback;
```
**EXPECT: the SECOND insert errors** — duplicate key on `webhook_events_provider_event_idx`.
**If both succeed, a redelivered payment event will double-credit somebody.**

```sql
-- V4 · the ON CONFLICT form the route uses is inferrable
begin;
  insert into webhook_events (provider, event_id) values ('dev','evt_zz_probe2')
    on conflict (provider, event_id) do nothing;
  insert into webhook_events (provider, event_id) values ('dev','evt_zz_probe2')
    on conflict (provider, event_id) do nothing;
  select count(*) from webhook_events where event_id = 'evt_zz_probe2';
rollback;
```
**EXPECT** count `1`.

---

## 09 · `overnight2_09_cashout_requests.sql`

**Switches on:** KYC-gated cash-out requests. **Requires 02 and 06.**

Paste the file. Then:

```sql
-- V1 · money is integer
select column_name, data_type, is_nullable
  from information_schema.columns
 where table_name = 'cashout_requests' order by ordinal_position;
```
**EXPECT** `amount_tokens` bigint NOT NULL, `amount_minor_estimate` bigint NOT NULL, `currency` text NOT NULL, `kyc_status_at_request` text NOT NULL.

```sql
-- V2 · constraints
select conname, pg_get_constraintdef(oid) from pg_constraint
 where conrelid = 'cashout_requests'::regclass and contype = 'c' order by conname;
```
**EXPECT 2 CHECKs:** `amount_tokens > 0`, and the status enumeration.

```sql
-- V3 · ★ RLS on, exactly ONE policy, and it is SELECT ★
select relrowsecurity from pg_class where relname = 'cashout_requests';
select policyname, cmd from pg_policies where tablename = 'cashout_requests';
```
**EXPECT** `t`, then **exactly 1:** `cashout_requests_select_own` SELECT.
**AN INSERT POLICY HERE DEFEATS THE KYC GATE** — a client could insert with `kyc_status_at_request = 'verified'` and skip it entirely. If one exists, remove it before going further.

---

## 10 · `overnight2_10_recordings.sql`

**Switches on:** "did the recording actually work", and clip ranges that
survive the page.

Paste the file. Then:

```sql
-- V1 · columns
select column_name, data_type, is_nullable, column_default
  from information_schema.columns
 where table_name = 'recordings'
   and column_name in ('duration_ms','size_bytes','egress_id','has_video',
                       'verified_at','verification','ended_reason',
                       'clip_start_ms','clip_end_ms')
 order by column_name;
```
**EXPECT 9 rows.** `duration_ms` / `size_bytes` / `clip_start_ms` / `clip_end_ms` all **bigint**; `has_video` boolean; `verification` jsonb NOT NULL `'{}'::jsonb`.

```sql
-- V2 · the clip-range check exists
select conname, convalidated from pg_constraint where conname = 'recordings_clip_range_sane';
```
**EXPECT** 1 row. `convalidated = false` is **expected** (added NOT VALID so old rows cannot block it).

```sql
-- V3 · and it bites, all three ways (skip if you have no recordings rows)
begin;
  update recordings set clip_start_ms = 1000 where id = (select id from recordings limit 1);
rollback;   -- EXPECT: ERROR (half-set range)
begin;
  update recordings set clip_start_ms = 5000, clip_end_ms = 1000
   where id = (select id from recordings limit 1);
rollback;   -- EXPECT: ERROR (end before start)
begin;
  update recordings set clip_start_ms = 0, clip_end_ms = 120000
   where id = (select id from recordings limit 1);
rollback;   -- EXPECT: ERROR (longer than 90 seconds)
begin;
  update recordings set clip_start_ms = 12000, clip_end_ms = 42000
   where id = (select id from recordings limit 1);
rollback;   -- EXPECT: succeeds
```

```sql
-- V4 · ★ the conflict target the egress webhook depends on ★
select indexname, indexdef from pg_indexes
 where tablename = 'recordings' and indexdef ilike '%storage_path%';
```
**EXPECT** a **UNIQUE** index on `(storage_path)` with **no `WHERE` clause**.
If it is missing or partial, the egress webhook's upsert 400s and no recording is ever marked verified.

```sql
-- V5 · policies UNCHANGED — four
select policyname, cmd from pg_policies where tablename = 'recordings' order by policyname;
```
**EXPECT:** `recordings_insert_own` INSERT · `recordings_select_own` SELECT · `recordings_select_public` SELECT · `recordings_update_own` UPDATE.

---

## 11 · `overnight2_11_reaction_events.sql`

**Switches on:** recording reactions. (The reactions themselves already work
without this — they travel over the data channel.)

Paste the file. Then:

```sql
-- V1 · RLS on, ZERO policies
select relrowsecurity from pg_class where relname = 'reaction_events';
select count(*) as policy_count from pg_policies where tablename = 'reaction_events';
```
**EXPECT** `t`, then `0`.

```sql
-- V2 · emoji survive intact (this is the one that catches an encoding
--      problem, which would otherwise show up as mojibake months later)
begin;
  insert into reaction_events (show_id, emoji, offset_ms)
    values ('probe', '🔥', 42000) returning emoji, char_length(emoji);
  -- EXPECT: 🔥 and char_length 1
  insert into reaction_events (show_id, emoji) values ('probe', '👨‍👩‍👧‍👦')
    returning emoji, char_length(emoji);
  -- EXPECT: the family emoji intact, char_length 7 (a ZWJ sequence —
  --         which is exactly why the cap is 16 and not 1)
rollback;
```

```sql
-- V3 · the length cap bites
begin;
  insert into reaction_events (show_id, emoji) values ('probe', repeat('x', 40));
rollback;
```
**EXPECT: ERROR** — violates check constraint.

---

## After all 11 · one whole-database sweep

```sql
-- Every table created or touched tonight, with its RLS state and policy count.
select c.relname as table_name,
       c.relrowsecurity as rls_on,
       count(p.policyname) as policies
  from pg_class c
  left join pg_policies p on p.tablename = c.relname
 where c.relname in ('camfeed_pairings','profiles','follows','account_requests',
                     'shows','wallet_transactions','payment_intents',
                     'webhook_events','cashout_requests','recordings',
                     'reaction_events','health_events')
   and c.relkind = 'r'
 group by c.relname, c.relrowsecurity
 order by c.relname;
```

**EXPECT exactly this:**

| table | rls_on | policies |
|---|---|---|
| `account_requests` | t | 1 |
| `camfeed_pairings` | t | **0** |
| `cashout_requests` | t | 1 |
| `follows` | t | 4 |
| `health_events` | t | **0** |
| `payment_intents` | t | 1 |
| `profiles` | t | 4 |
| `reaction_events` | t | **0** |
| `recordings` | t | 4 |
| `shows` | t | *(unchanged from before tonight)* |
| `wallet_transactions` | t | 1 |
| `webhook_events` | t | **0** |

**Every `rls_on` must be `t`.** The four zero-policy tables are deliberate —
they are service-role only, and a policy appearing on any of them is a
regression, not an improvement.

```sql
-- And one last look at the thing that matters most.
select tgname, tgenabled from pg_trigger
 where tgrelid = 'wallet_transactions'::regclass and not tgisinternal;
```
**EXPECT** `wallet_tx_append_only`, `tgenabled = 'O'` (enabled).

---

## If something goes wrong

- **A verification returns nothing where it should return rows.** You are
  probably looking at a different schema — check the SQL editor is on the right
  project.
- **`notify pgrst` seemed to do nothing.** It is asynchronous. Wait ten seconds
  and retry the app; if it persists, restart the PostgREST service from the
  Supabase dashboard.
- **The app still says "needs a pending database update" after a file ran.**
  The server caches its capability probe per process (deliberately — see
  `lib/camfeedPairing.js`). Redeploy the preview, or just wait a few minutes for
  the functions to cycle.
- **You want to undo one.** Every file is additive: new columns, new tables, new
  indexes, one trigger. Nothing is dropped and nothing is rewritten, so the
  reverse of any of them is a `drop`/`alter … drop column` you can write in a
  line. The one to be careful with is 06's trigger — dropping it removes the
  append-only guarantee.
