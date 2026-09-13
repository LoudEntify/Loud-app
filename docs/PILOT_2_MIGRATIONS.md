# Pilot 2 — Migrations to run

**Eight files, `docs/pilot2_01_*.sql` → `docs/pilot2_08_*.sql`.**
Run in the Supabase SQL editor, as the project owner, in numbered order.

- **Every file is idempotent.** Re-running any of them is a no-op.
- **Every file ends with `notify pgrst, 'reload schema'`.** Without it PostgREST
  keeps serving the old column list and the app 400s on columns that exist.
- **Every file carries its own verification block**, commented out at the bottom.
  Paste it underneath after running and compare against the stated expectation.
- **Production and preview share one Supabase project.** Every one of these is a
  production migration.

**Total time:** about 20 minutes including verification.

---

## Run order

| # | File | Adds | Switches on | Depends on |
|---|------|------|-------------|-----------|
| 01 | `pilot2_01_shows_actual_times.sql` | 3 columns, 1 check, 1 index on `shows` | Real show timings; every offset in the product | — |
| 02 | `pilot2_02_viewer_sessions.sql` | new table | Unique viewers, watch time, join/leave | — |
| 03 | `pilot2_03_show_comments.sql` | new table | Chat persistence | — |
| 04 | `pilot2_04_reaction_events_keys.sql` | 2 columns, 1 index | Attributed reactions; fixes a key ambiguity | 02 (conceptually) |
| 05 | `pilot2_05_room_events.sql` | new table | LiveKit webhook ingestion, idempotent | — |
| 06 | `pilot2_06_show_prompts.sql` | new table | Questions pushed live | — |
| 07 | `pilot2_07_prompt_responses.sql` | new table | Answers | **06** |
| 08 | `pilot2_08_show_moderators.sql` | new table | The moderator role | — |

**Only one hard dependency: 07 must run after 06** (its foreign key points at
`show_prompts.id`). Everything else is independent, and the numbered order is safe
end to end.

**Corrective, only if 02 or 07 were already run:** `pilot2_fix_conflict_targets.sql`.
The original 02 and 07 created their ON CONFLICT targets as *partial* unique indexes,
which Postgres will not infer as a conflict target and supabase-js cannot qualify —
every upsert against those two tables failed with `42P10`. Both files are now fixed
in place, so a fresh database needs nothing extra; an already-migrated one needs this.

**Run before item 4 (Sun 14):** `pilot2_env_stamp.sql`. Adds one column, `env`, to the
six pilot tables so a device test on a preview URL can be excluded from the 21st's
analysis — production and preview share one Supabase project on purpose, so
attribution replaces separation. Additive and defaulted to `'production'`: no existing
row changes value and no un-updated write path is excluded. It changes the V1 column
counts in 02/03/05/06/07/08 by one; each of those files notes the new and old number.

**Deferred to the window between the two pilots (21–26 September), not written yet:**
`pilot2_09_shot_commands_show_uuid.sql` and `pilot2_10_shot_commands_select_policy.sql`.
Both are additive, neither affects either show night, and the 21st's analysis runs
service-role so the SELECT policy is not needed for it.

---

## Before you start

Nothing here is required for the app to keep working. Every capability built on top
of these tables degrades to exactly today's behaviour if the migration has not run —
the same posture as `docs/MORNING_MIGRATIONS.md`. You can run one file, check the
app, and stop.

**One query to run first, before file 04**, because it decides whether a code fix is
needed at all:

```sql
-- Has the reactions write path EVER worked in production?
select count(*) as rows, min(created_at) as first_row, max(created_at) as last_row
  from reaction_events;
```

`rows = 0` means it never has. The insert fails silently by design
(`app/api/reactions/route.js:64-68` warns to a log; `lib/reactions.js:96-101` ignores
the response), so nothing would ever have surfaced it. Check the answer against when
`docs/overnight2_11_reaction_events.sql` was actually run before assuming a code
fault — a table that did not exist yet is the likelier explanation than broken code.

**And one query that gates item 11d**, per the finding that `artist_id` shipped
2026-09-04 and the rows run from 31 July:

```sql
-- Is artist_id populated on rows fired SINCE the column existed?
select date(fired_at) as day,
       count(*) as commands,
       count(artist_id) as attributed,
       round(100.0 * count(artist_id) / count(*), 1) as pct
  from shot_commands
 where fired_at >= '2026-09-01'
 group by 1 order by 1;
```

If `pct` is at or near 100 from 4 September onward, the headline 4.6% is arithmetic
across the whole table and **there is nothing to fix** — do not change code. If it is
low on recent days, the cause is a director client with no Supabase session, which is
a different fix and a different file.

---

## ⚠️ The one thing that will make a query come back empty

`health_events.show_id` holds the **room name** (`show-xxxxxxxx`), not `shows.id`.
`components/LiveDemo.jsx`'s `initHealthLog` passes `roomName`. `reaction_events.show_id`
holds **either**, depending on whether the client had resolved a show
(`LiveDemo.jsx:3235` — `showId || roomName`).

Every table added in this set carries **both** `show_id uuid` and `room_name text`
for exactly this reason. When you query across the old tables and the new ones,
bridge them explicitly:

```sql
with s as (select id, room_name from shows where id = :show_id)
select ... from health_events h join s on h.show_id = s.room_name
```

A query that filters `health_events.show_id = '<uuid>'` returns zero rows and looks
identical to a write path that never ran.
