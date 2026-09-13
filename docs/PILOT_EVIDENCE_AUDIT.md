# Pilot Evidence Audit — what Loudentify actually persisted

**Date:** 2026-09-10
**Scope:** read-only. No migrations, no schema changes, no writes, no code changes.
**Method:** static trace of write paths in `app/`, `components/`, `lib/`, `scripts/`, plus the
migration files in `docs/` and `MULTI_PERFORMER_SPEC.md`. **No SQL was run against Supabase.**
Everything below is a claim about the *code*; §2 is the SQL that turns each claim into a
claim about the *data*.

> ⚠️ **What this document can and cannot tell you.** Code proves what the app *tries* to
> write. It cannot prove a row exists. Three of the write paths below are fire-and-forget with
> the failure swallowed, and one of those uses the anon key against a table whose RLS policies
> are not visible from the repository. Until §2 has been run, treat every PERSISTED verdict as
> "the app attempts this write", not "the rows are there."

---

## 1. Findings

### 1.1 Chat / comments — **EPHEMERAL (LiveKit data channel)**

**No chat or comments table exists anywhere in the codebase.** The complete inventory of
Supabase tables referenced by any `.from(...)` call in `app/`, `components/`, `lib/` and
`scripts/` is: `shows`, `profiles`, `recordings`, `show_slots`, `broll_clips`,
`camfeed_pairings`, `cue_sheets`, `notifications`, `backing_tracks`, `set_lists`,
`set_list_items`, `payment_intents`, `wallet_transactions`, `health_events`, `participants`,
`follows`, `cashout_requests`, `account_requests`, `webhook_events`, `show_session_state`,
`reaction_events`, `shot_commands`. There is no comments table in that list.

The transport is the LiveKit data channel, and the store is React state:

| Evidence | Location |
|---|---|
| Comments live in component state only | `components/LiveDemo.jsx:1892` — `const [comments, setComments] = useState([]);` |
| Send path: local state + data channel, **no database call** | `components/LiveDemo.jsx:3253-3264` — `setComments(...)` then `send(new TextEncoder().encode(JSON.stringify({ type: 'comment', comment })), {})` |
| The transport is `useDataChannel` | `components/LiveDemo.jsx:2885` — `const { send } = useDataChannel((msg) => {` |
| Receive path also only appends to state | `components/LiveDemo.jsx:2890-2892` |

This is not an inference — the codebase already states it. `components/VODPlayback.jsx:16-20`:

> `// Archived chat is EMPTY, not invented. Live comments are not persisted`
> `// anywhere yet (they exist only in memory over the data channel during a`
> `// show), so there is nothing real to replay`

**Consequence for the pilot record: every comment from every pilot show is gone.** Not
recoverable from Postgres, not recoverable from LiveKit (data-channel payloads are relayed,
not stored), not recoverable from the recording (comments are a DOM overlay in the browser,
and the egress layout is a separate page — see §3.2 for the one caveat on that).

- **PRD row:** Director Experience / Live Show
- **S&I area:** Database *(the gap)*, Real-time media *(the current transport)*

---

### 1.2 Reactions — **PERSISTED: `reaction_events`**

Reactions take **two** paths at once: the data channel for the live animation, and an HTTP
batch for the record.

| Step | Location |
|---|---|
| Both paths fire from one place | `components/LiveDemo.jsx:3215-3252` (`sendReaction`) |
| Live path (ephemeral) | `components/LiveDemo.jsx:3227` — `send(... { type: 'REACTION', reaction })` |
| Record path — enqueue | `components/LiveDemo.jsx:3234-3241` → `lib/reactions.js:70-85` (`logReaction`) |
| Flush, batched | `lib/reactions.js:87-102` — `fetch('/api/reactions', { method: 'POST', keepalive: true })` |
| Flush on tab close | `lib/reactions.js:104-121` — `navigator.sendBeacon`, `fetch(keepalive)` fallback; registered on `pagehide` at `lib/reactions.js:62` |
| The insert | `app/api/reactions/route.js:61` — `await admin.from('reaction_events').insert(rows);` |
| Schema | `docs/overnight2_11_reaction_events.sql:30-64` |

**Columns that carry the evidence:** `show_id` (text), `emoji` (text), `offset_ms` (bigint),
`tokens_spent` (integer), `user_id` (uuid, nullable), `created_at` (timestamptz).

Four caveats, each load-bearing for how this data can honestly be described:

1. **`user_id` is always NULL.** The client's flush sends only `Content-Type`
   (`lib/reactions.js:93-98` and `:110-116` — no `Authorization` header), and the route
   resolves a user *only* when a Bearer token is present
   (`app/api/reactions/route.js:38-40`). So reactions are recorded but **completely
   unattributed** — you can count them and place them in time, but you cannot say how many
   distinct people reacted.
2. **`offset_ms` is measured from the *scheduled* start, not the actual one.**
   `components/LiveDemo.jsx:3233` — `show?.slated_at`. A show that went live twelve minutes
   late has every offset inflated by twelve minutes. Because no actual start time is recorded
   anywhere on `shows` (see §1.5), this skew **cannot be corrected after the fact** from the
   database alone.
3. **`show_id` is the show UUID when known, otherwise the room name.**
   `components/LiveDemo.jsx:3235` — `showId: showId || roomName`. See §1.6 on join keys.
4. **Loss is silent and by design.** A failed flush is dropped and never retried
   (`lib/reactions.js:99-101`), and the queue is bounded, dropping the *oldest*
   (`lib/reactions.js:81-82`).

- **PRD row:** Director Experience / AI Director Layer 1 (the flywheel's audience signal); Token economy / wallet (`tokens_spent`, currently always 0 — `lib/reactions.js:40`)
- **S&I area:** Database, Observability

---

### 1.3 Viewer / participant telemetry — **SPLIT: partly persisted, partly not implemented**

Three separate questions hide under this heading, and they have three different answers.

#### (a) "Who entered a show" — **PERSISTED: `participants`, but join-only and signed-in-only**

| Step | Location |
|---|---|
| Insert | `app/api/participants/route.js:63-71` — `.from('participants').insert({ show_id, email, role: 'viewer', slot: null, consent })` |
| Caller | `components/LiveDemo.jsx:981-1008` (`registerParticipant`), invoked at `components/LiveDemo.jsx:1022` inside `enterShow` |
| Schema | `MULTI_PERFORMER_SPEC.md:65-73` |
| Later promotion to performer | `app/api/performer/claim-slot/route.js:167`, `app/api/performer/join-show/route.js:192` |

Three limits, all provable from the code:

- **A session is mandatory.** `app/api/participants/route.js:37` calls `verifySession`, which
  returns 401 without a `Bearer` header (`lib/verifyArtistAuth.js:58-63`). **An anonymous
  viewer produces no row at all.**
- **There is no exit.** The schema (`MULTI_PERFORMER_SPEC.md:65-73`) is
  `id, show_id, email, role, slot, consent, created_at`. No `left_at`, no `duration`. The
  table answers "did this email arrive", never "how long did they stay".
- **Failure is swallowed.** `components/LiveDemo.jsx:1000-1003` logs a warning and returns
  `null`; the join proceeds regardless. A viewer can be in the show with no row.

#### (b) "How long people stayed" — **PERSISTED indirectly, in `health_events`**

This is the only place duration-shaped evidence exists, and it exists as a by-product of the
reliability instrumentation rather than as an audience metric.

| Step | Location |
|---|---|
| Logger context set inside the room, **for viewers too** | `components/LiveDemo.jsx:1776-1781` — `initHealthLog({ showId: roomName, participantIdentity: room.localParticipant.identity, role })` inside `RoomInner` |
| Connection lifecycle events | `components/LiveDemo.jsx:1793-1800+` — `room_connected`, `room_reconnecting`, `room_reconnected`, `room_disconnected` |
| Queue + batched POST | `lib/healthLog.js:82-99`, flushed by `ensureFlushTimer` / `ensurePageLifecycleFlush` (`lib/healthLog.js:64-65`) |
| The insert | `app/api/health-events/route.js:112` — `admin.from('health_events').insert(rows)` |
| Schema | `docs/health_events_migration.sql:13-22` |

`health_events` rows carry `participant_identity` and `client_ts`, so **a first-`room_connected`
to last-event span per identity is a real, defensible dwell-time proxy** — and, unlike
`participants`, it does not require a signed-in session, because
`app/api/health-events/route.js` has no auth check on its write path.

**Ambiguity, stated rather than resolved:** whether viewer devices actually produced these
rows during the pilot depends on whether they reached `RoomInner` and whether their queue
flushed before the tab closed. The code says they should. §2 query 4 is what tells you whether
they did. Note also the known failure mode this codebase has already hit once —
`logHealthEvent` silently drops anything logged before `initHealthLog`
(`lib/healthLog.js:84-90`), which is counted and reported as
`health_log_dropped_before_init`.

#### (c) "Peak concurrent viewers" — **COMPUTED AND DISPLAYED, NEVER PERSISTED**

> **Correction (2026-09-10).** An earlier revision of this section said nothing computes or
> displays an audience count. That was wrong, and the difference matters for what Pilot 2 has
> to build. The conclusion that nothing is *stored* is unchanged.

A live count **does** exist: `components/PresenceCounter.jsx:32-50` derives performer and
viewer counts from LiveKit room state via `useParticipants()`, correctly excluding
`ParticipantKind.EGRESS`, `contestant-*` and `camfeed-*` identities
(`components/PresenceCounter.jsx:38-41`). It is mounted and on screen at
`components/CommentsPanel.jsx:131`.

It is **purely derived and never written anywhere** — no database call, no health event. The
number is correct, visible during the show, and gone the instant the tab closes.

Separately, `components/TopBar.jsx:25-27` contains a second, unused `{viewerCount} watching`
block: no caller passes the prop (`components/BroadcastStage.jsx:252`,
`components/ViewerStage.jsx:70-75`), so it never renders. That is dead code, not the
count that works.

**Consequence for Pilot 2:** the concurrency curve does not need building from scratch. It
needs *sampling* — periodically writing the number `PresenceCounter` already has.

- **PRD row:** Director Experience / Live Show; Accounts & Identity
- **S&I area:** Database, Observability, Auth

---

### 1.4 LiveKit webhooks — **egress only. Room and participant lifecycle NOT IMPLEMENTED**

There is exactly one LiveKit webhook receiver in the codebase:
`app/api/egress/webhook/route.js` (`WebhookReceiver` imported at `:2`, `receive()` at `:57`).
The only other `/webhook` route, `app/api/wallet/webhook/route.js`, is Stripe.

And that one receiver **discards everything except one event type**:

```
app/api/egress/webhook/route.js:69-71
  if (event?.event !== 'egress_ended') {
    return NextResponse.json({ ok: true, ignored: event?.event || 'unknown' });
  }
```

So `room_started`, `room_finished`, `participant_joined`, `participant_left` and
`track_published` are **never ingested**. LiveKit emits them; nothing in this application
listens. That is the single largest hole in the pilot record: LiveKit's own server-side view
of who was in the room and for how long — the authoritative version of §1.3(b)'s client-side
proxy — was never captured into a durable store the project controls.

**Second, compounding limit:** `app/api/egress/webhook/route.js:29-36` records that LiveKit
cannot reach this route on a deployment-protected preview. If any pilot show ran on a preview
deployment, even the `egress_ended` half did not arrive. `app/api/egress/verify/route.js`
exists as the manual, artist-triggered equivalent.

- **PRD row:** Director Experience / Live Show
- **S&I area:** Observability, Real-time media, Stateless hosting

---

### 1.5 Recordings / egress — **SPLIT: media PERSISTED, database row CONDITIONAL**

#### (a) The media file — **PERSISTED, in Supabase Storage**

| Step | Location |
|---|---|
| Egress starts automatically at the live transition | `components/LiveDemo.jsx:4510` — `triggerEgress('start', roomName, performanceMode)` |
| …and stops at End Show | `components/LiveDemo.jsx:3202` — `triggerEgress('stop', roomName)` |
| Output path | `app/api/egress/start/route.js:121-123` — `filepath: \`recordings/${room}-${Date.now()}.mp4\`` |
| Composite egress call | `app/api/egress/start/route.js:173-174` — `startRoomCompositeEgress(room, { file: output }, { layout })` |
| Bucket | `process.env.LIVEKIT_S3_BUCKET`, default `'recordings'` — `app/api/recordings/sync/route.js:36` |
| Read back through the Supabase Storage API | `lib/egressVerification.js:93` — `admin.storage.from(bucket).list(dir, ...)` |

**The file's existence does not depend on any Postgres row.** Objects can be sitting in the
bucket with nothing in `recordings` pointing at them. §2 query 8 checks exactly that.

#### (b) The `recordings` row — **PERSISTED only if one of two triggers fired**

| Trigger | Location |
|---|---|
| Manual artist-initiated sync | `app/api/recordings/sync/route.js:99-106` — insert; gated by `verifyArtistAuth` at `:41`, and scoped to shows the caller owns (`:88-92`) |
| Automatic, via the webhook's verification | `lib/egressVerification.js:225-227` — `upsert(patch, { onConflict: 'storage_path' })`, but **only** when `artistId` is known; otherwise it `update`s and inserts nothing (`lib/egressVerification.js:213-227`). `artistId` comes from the room-name→`shows` lookup at `app/api/egress/webhook/route.js:85-96` |

Columns: base row at `docs/recordings_migration.sql:132-141`
(`show_id, artist_id, storage_path, title, recorded_at, visibility, created_at`), verification
columns at `docs/overnight2_10_recordings.sql:35-41`
(`duration_ms, size_bytes, egress_id, has_video, verified_at, verification jsonb, ended_reason`).

**Two things worth naming for the business plan:**

- `duration_ms` and `size_bytes` on a verified row are **hard evidence of a real broadcast of a
  real length** — the strongest single artefact the pilot produced, if the rows exist.
- Attribution is a **heuristic, not a key**. The object name embeds only room and epoch-ms, so
  sync matches nearest-by-time among the caller's shows for that room
  (`app/api/recordings/sync/route.js:89-99`, and the route's own header comment at `:14-28`
  says so plainly). It is much safer than it was — every scheduled show now mints its own room
  name — but it is still not exact, and any legacy `pilot-room` object can match several rows.

One more write worth knowing about: every verification also files a health event,
`egress_verified_ok` or `egress_verified_suspect`, with duration/bytes/hasVideo in `detail`
(`lib/egressVerification.js:241-256`). **That means recording evidence may survive in
`health_events` even where the `recordings` row does not.**

- **PRD row:** Director Experience / Live Show; Multi-Camera & Production
- **S&I area:** Database, Stateless hosting (shared storage), Observability

---

### 1.6 Two cross-cutting facts that will bite any query you write

**(i) `show_id` means two different things depending on the table.**

| Table | What `show_id` holds | Proof |
|---|---|---|
| `health_events` | **room name** (text) | `components/LiveDemo.jsx:1776-1777` |
| `shot_commands` | **room name** (text) | `components/LiveDemo.jsx:4745` — `showId={roomName}` passed to the director panel |
| `reaction_events` | **show UUID** (text column) | `components/LiveDemo.jsx:3235` — `showId \|\| roomName` |
| `participants` | **show UUID** (uuid FK) | `app/api/participants/route.js:64` |
| `recordings` | **show UUID** (uuid FK) | `app/api/recordings/sync/route.js:100` |

Every per-show query therefore has to go through `shows` and carry **both** `shows.id` and
`shows.room_name`. The SQL in §2 does this. A query that joins on `show_id` alone will
silently return zero rows from half the tables and look like a finding.

**(ii) `shows` has no actual start or end time.**

A grep for `started_at`, `ended_at` and `went_live` across `docs/*.sql`, `app/`, `lib/` and
`components/` returns **nothing** but LiveKit's own egress fields in `lib/egressVerification.js:73-74`.
The `shows` row carries `slated_at`, `ends_at`, `duration_minutes` and `cancelled_at`
(`docs/scheduling_migration.sql:15-18`, `docs/overnight2_05_shows.sql:16-17`) — all
*scheduling* fields, all written before the show happens.

**So the database cannot answer "did this show actually happen, and for how long".** That has
to be inferred from `health_events` timestamps, or from a verified `recordings.duration_ms`.
This is also why §1.2's `offset_ms` skew is uncorrectable.

---

### 1.7 The director decision log — **PERSISTED: `shot_commands`, with a real risk it is empty**

Not one of the four you asked about, but it is the flywheel's core asset and it shares the
failure mode, so it belongs in the same audit.

| Step | Location |
|---|---|
| Insert | `lib/shotCommands.js:357-377` |
| Called fire-and-forget, warning only | `lib/shotCommands.js:213-215` — `logShotCommand(command).catch((err) => console.warn(...))` |

**The risk:** this insert uses the **anon browser client**
(`lib/shotCommands.js:358-359` — `const { getSupabase } = await import('./supabaseClient')`),
not the service-role admin client that every other durable write in this codebase uses. It
therefore depends entirely on an RLS insert policy on `shot_commands` that **is not visible
anywhere in the repository** — there is no `shot_commands` DDL in `docs/*.sql`, only the
commented-out `create table` inside `lib/shotCommands.js:337-355` and the additive
`docs/mvp3_01_shot_commands_artist.sql`.

If that policy is absent or restrictive, every shot command the pilot ever fired was rejected
and the only trace is a `console.warn` in a browser that has since been closed.
**I cannot tell from code which of those is true.** §2 queries 6 and 7 settle it.

- **PRD row:** Director Experience / AI Director Layer 1
- **S&I area:** Database, Observability

---

### 1.8 Summary table

| # | Question | Verdict | Where |
|---|---|---|---|
| 1 | Chat / comments | **EPHEMERAL** — LiveKit data channel + React state | `components/LiveDemo.jsx:3253-3264`, `:2885`, `:1892` |
| 2 | Reactions | **PERSISTED** — `reaction_events` (`show_id`, `emoji`, `offset_ms`, `created_at`); `user_id` always NULL | `app/api/reactions/route.js:61`; `lib/reactions.js:93-98` |
| 3a | Who entered | **PERSISTED** — `participants` (`show_id`, `email`, `role`, `consent`, `created_at`); signed-in only, join only | `app/api/participants/route.js:63-71`, `:37` |
| 3b | How long they stayed | **PERSISTED (indirect)** — `health_events` (`participant_identity`, `event_type`, `client_ts`) | `components/LiveDemo.jsx:1776-1781`; `app/api/health-events/route.js:112` |
| 3c | Peak concurrent viewers | **COMPUTED + DISPLAYED, NEVER PERSISTED** | `components/PresenceCounter.jsx:32-50`, mounted at `components/CommentsPanel.jsx:131` |
| 4 | LiveKit room/participant webhooks | **NOT IMPLEMENTED** — only `egress_ended` is handled | `app/api/egress/webhook/route.js:69-71` |
| 5a | Recording media | **PERSISTED** — Supabase Storage, `recordings/{room}-{epochms}.mp4` | `app/api/egress/start/route.js:121-123`; `app/api/recordings/sync/route.js:36` |
| 5b | Recording metadata row | **CONDITIONAL** — `recordings` (`duration_ms`, `size_bytes`, `has_video`, `verification`) only if webhook fired or sync was called | `lib/egressVerification.js:225-227`; `app/api/recordings/sync/route.js:99-106` |
| 6 | Actual show start/end | **NOT IMPLEMENTED** — `shows` holds scheduling fields only | `docs/scheduling_migration.sql:15-18` |
| 7 | Director decisions | **PERSISTED, at risk** — `shot_commands` via the anon client, RLS-dependent | `lib/shotCommands.js:357-377`, `:213-215`, `:358-359` |

---

## 2. Read-only SQL pack

Run these **in order** in the Supabase SQL editor. Every statement is a `select`. Nothing here
writes, alters, or deletes. Where a query needs a show, it resolves it through `shows` so both
spellings of `show_id` (§1.6) are covered.

### Q1 — Which of these tables exist at all, and how big are they

A table that does not exist throws in later queries and reads as "no evidence" when it is
actually "no table". Establish this first.

```sql
select
  t.table_name,
  c.reltuples::bigint as approx_rows,
  c.relrowsecurity   as rls_enabled
from information_schema.tables t
join pg_class c on c.relname = t.table_name and c.relnamespace = 'public'::regnamespace
where t.table_schema = 'public'
  and t.table_name in (
    'shows','participants','health_events','reaction_events','shot_commands',
    'recordings','show_session_state','show_slots','notifications','profiles',
    'follows','account_requests','wallet_transactions','payment_intents','webhook_events'
  )
order by t.table_name;
```

`reltuples` is an estimate. Q2 gives exact counts.

### Q2 — Exact row counts, the one-screen answer to "is there anything here"

```sql
select 'shows'              as tbl, count(*) from shows
union all select 'participants',       count(*) from participants
union all select 'health_events',      count(*) from health_events
union all select 'reaction_events',    count(*) from reaction_events
union all select 'shot_commands',      count(*) from shot_commands
union all select 'recordings',         count(*) from recordings
union all select 'show_session_state', count(*) from show_session_state
union all select 'show_slots',         count(*) from show_slots
union all select 'profiles',           count(*) from profiles
union all select 'follows',            count(*) from follows
union all select 'account_requests',   count(*) from account_requests
union all select 'notifications',      count(*) from notifications
union all select 'wallet_transactions',count(*) from wallet_transactions
order by 1;
```

### Q3 — The show inventory, with both join keys side by side

This is the spine. Every later query joins to it.

```sql
select
  s.id                as show_uuid,
  s.room_name,
  s.title,
  s.artist_name,
  s.artist_id,
  s.performance_mode,
  s.slated_at,
  s.duration_minutes,
  s.cancelled_at,
  s.created_at
from shows s
order by s.slated_at desc nulls last;
```

**Read it for:** how many shows were ever scheduled, how many were cancelled, and which
`room_name` values to expect in `health_events` / `shot_commands`. Remember (§1.6) that
`slated_at` is *scheduled*, not actual.

### Q4 — Did each show actually happen? Evidence-based, from `health_events`

The substitute for the missing `started_at`/`ended_at`.

```sql
select
  s.id            as show_uuid,
  s.room_name,
  s.slated_at,
  count(h.id)                                   as health_rows,
  count(distinct h.participant_identity)        as distinct_identities,
  min(h.client_ts)                              as first_event,
  max(h.client_ts)                              as last_event,
  max(h.client_ts) - min(h.client_ts)           as observed_span,
  min(h.client_ts) - s.slated_at                as start_vs_scheduled
from shows s
left join health_events h on h.show_id = s.room_name
group by s.id, s.room_name, s.slated_at
order by s.slated_at desc nulls last;
```

**Read it for:** `observed_span` is your best available evidence of real broadcast duration.
`start_vs_scheduled` is the correction factor that `reaction_events.offset_ms` is missing.

### Q5 — Attendance and dwell time per person, per show

```sql
select
  s.room_name,
  h.participant_identity,
  h.role,
  min(h.client_ts)                     as first_seen,
  max(h.client_ts)                     as last_seen,
  max(h.client_ts) - min(h.client_ts)  as dwell,
  count(*)                             as events
from health_events h
join shows s on s.room_name = h.show_id
where h.participant_identity is not null
group by s.room_name, h.participant_identity, h.role
order by s.room_name, dwell desc;
```

**Read it for:** the closest thing to an audience-retention number the pilot produced. Note
`role` — it separates performers from viewers from `egress` (the recorder's own rows,
`lib/egressVerification.js:245`) and from `camfeed-*` / `kit-check` devices.

### Q6 — Peak concurrency, reconstructed

Not stored (§1.3c), but derivable if `room_connected` / `room_disconnected` rows exist.

```sql
with edges as (
  select show_id, client_ts, 1 as delta
  from health_events where event_type = 'room_connected'
  union all
  select show_id, client_ts, -1
  from health_events where event_type in ('room_disconnected', 'page_hide')
)
select
  show_id,
  max(running) as peak_concurrent,
  count(*)     as edge_events
from (
  select show_id, client_ts,
         sum(delta) over (partition by show_id order by client_ts
                          rows between unbounded preceding and current row) as running
  from edges
) t
group by show_id
order by peak_concurrent desc;
```

⚠️ Treat this as **indicative, not authoritative**. `page_hide` is not a disconnect, a tab
closed without a flush produces no closing edge, and a reconnect produces a second
`room_connected` without an intervening close. If it disagrees with Q5's
`distinct_identities`, Q5 is the more defensible number.

### Q7 — Reactions per show, with the attribution caveat made visible

```sql
select
  coalesce(s.room_name, r.show_id)         as show_key,
  s.title,
  s.slated_at,
  count(*)                                  as reactions,
  count(distinct r.emoji)                   as distinct_emoji,
  count(r.user_id)                          as reactions_with_a_user,   -- expect 0, see §1.2
  count(*) filter (where r.offset_ms is not null) as with_offset,
  min(r.created_at)                         as first_reaction,
  max(r.created_at)                         as last_reaction
from reaction_events r
left join shows s on s.id::text = r.show_id or s.room_name = r.show_id
group by 1, s.title, s.slated_at
order by reactions desc;
```

**Read it for:** `reactions_with_a_user` should be `0`. If it is not, my §1.2 finding is wrong
and the attribution is better than I claimed — tell me.

### Q8 — Reaction shape over a show (the flywheel's actual training signal)

```sql
select
  r.show_id,
  r.emoji,
  count(*)                              as n,
  round(avg(r.offset_ms) / 1000.0)      as avg_offset_seconds,
  min(r.offset_ms), max(r.offset_ms)
from reaction_events r
group by r.show_id, r.emoji
order by r.show_id, n desc;
```

### Q9 — Participants: who registered, and how that compares to who actually showed up

```sql
select
  s.id       as show_uuid,
  s.room_name,
  s.title,
  count(p.id)                    as participant_rows,
  count(distinct p.email)        as distinct_emails,
  count(*) filter (where p.consent) as consented,
  count(*) filter (where p.role = 'performer') as performers,
  count(*) filter (where p.role = 'viewer')    as viewers,
  min(p.created_at), max(p.created_at)
from shows s
left join participants p on p.show_id = s.id
group by s.id, s.room_name, s.title
order by s.slated_at desc nulls last;
```

**Read it against Q5.** `participant_rows` counts only signed-in joiners (§1.3a);
`distinct_identities` in Q4 counts every device in the room. The gap between them is the
anonymous audience — real people, with no email captured.

### Q10 — `shot_commands`: did the flywheel actually record anything

The query that settles §1.7.

```sql
select
  coalesce(s.room_name, sc.show_id) as show_key,
  s.title,
  sc.decision_source,
  count(*)            as commands,
  count(sc.artist_id) as with_artist_attribution,
  min(sc.fired_at), max(sc.fired_at)
from shot_commands sc
left join shows s on s.room_name = sc.show_id or s.id::text = sc.show_id
group by 1, s.title, sc.decision_source
order by show_key, commands desc;
```

**Zero rows here is the single most consequential possible result of this whole audit** — it
would mean the AI-director training set is empty. If it is zero, run Q11 before concluding
anything, because "no rows" and "every insert was rejected by RLS" look identical from here.

### Q11 — Why `shot_commands` might be empty: the RLS posture

```sql
select
  c.relname                      as table_name,
  c.relrowsecurity               as rls_enabled,
  p.polname                      as policy_name,
  p.polcmd                       as command,
  pg_get_expr(p.polqual, p.polrelid)      as using_expr,
  pg_get_expr(p.polwithcheck, p.polrelid) as with_check_expr
from pg_class c
left join pg_policy p on p.polrelid = c.oid
where c.relnamespace = 'public'::regnamespace
  and c.relname in ('shot_commands', 'reaction_events', 'health_events', 'participants')
order by c.relname, p.polname nulls first;
```

**Read it for:** `shot_commands` is written with the **anon** key (§1.7). If `rls_enabled` is
true and there is no `INSERT` policy permitting anon, every command was silently rejected.
`reaction_events`, `health_events` and `participants` are written with the service-role key,
which bypasses RLS — for those three, "RLS on, zero policies" is the intended posture and not
a problem.

### Q12 — Recordings: the rows

```sql
select
  r.id,
  s.room_name,
  s.title,
  r.storage_path,
  r.recorded_at,
  round(r.duration_ms / 60000.0, 1) as duration_minutes,
  round(r.size_bytes / 1048576.0, 1) as size_mb,
  r.has_video,
  r.verified_at,
  r.ended_reason,
  r.verification
from recordings r
left join shows s on s.id = r.show_id
order by r.recorded_at desc;
```

**Read it for:** `duration_ms` + `size_bytes` + `has_video` on a `verified_at`-stamped row is
the strongest single artefact the pilot produced — a machine-checked record that a broadcast
of a specific length, containing video, actually existed.

### Q13 — Recordings: the objects, and whether any are orphaned

Supabase exposes the storage catalogue as `storage.objects`. Adjust `bucket_id` if
`LIVEKIT_S3_BUCKET` is not `recordings`.

```sql
select
  o.bucket_id,
  o.name,
  o.created_at,
  (o.metadata ->> 'size')::bigint as size_bytes,
  o.metadata ->> 'mimetype'       as mimetype,
  r.id                            as recordings_row_id   -- null = orphaned object
from storage.objects o
left join recordings r
  on r.storage_path = o.bucket_id || '/' || o.name
  or r.storage_path = o.name
where o.bucket_id in ('recordings', 'loudentify-recordings')
order by o.created_at desc;
```

**Read it for:** rows where `recordings_row_id` is null are **real recordings the database
does not know about** (§1.5a). They are still evidence — the file is the evidence — they just
need `POST /api/recordings/sync` to be claimed. Also check the bucket list first:

```sql
select id, name, public, created_at from storage.buckets order by created_at;
```

### Q14 — The health-event taxonomy: what the instrumentation actually captured

```sql
select
  h.event_type,
  count(*)                        as n,
  count(distinct h.show_id)       as shows,
  min(h.client_ts), max(h.client_ts)
from health_events h
group by h.event_type
order by n desc;
```

**Read it for:** a fast picture of which instrumented rounds produced data. Look
specifically for `health_log_dropped_before_init` (evidence of a partly-lost capture),
`egress_verified_ok` / `egress_verified_suspect` (recording evidence surviving outside
`recordings`), and `room_connected` (whether Q6 can work at all).

### Q15 — Accounts, follows and demand-side evidence

Not a live-show artefact, but it is pilot evidence and an investor will ask.

```sql
select 'auth_users' as metric, count(*) from auth.users
union all select 'profiles',          count(*) from profiles
union all select 'account_requests',  count(*) from account_requests
union all select 'follows',           count(*) from follows
union all select 'notifications',     count(*) from notifications
union all select 'show_slots',        count(*) from show_slots
union all select 'wallet_transactions', count(*) from wallet_transactions;

-- signup curve
select date_trunc('week', created_at)::date as week, count(*) as signups
from auth.users group by 1 order by 1;
```

### Q16 — Backing tracks, set lists, cue sheets and b-roll: production-work evidence

```sql
select 'backing_tracks' as tbl, count(*) from backing_tracks
union all select 'set_lists',      count(*) from set_lists
union all select 'set_list_items', count(*) from set_list_items
union all select 'cue_sheets',     count(*) from cue_sheets
union all select 'broll_clips',    count(*) from broll_clips
union all select 'camfeed_pairings', count(*) from camfeed_pairings
order by 1;
```

**Read it for:** these show artists *preparing* shows, which is a distinct and useful signal
from artists *performing* them.

---

## 3. What else might hold the record, outside Postgres

Ordered by how likely it is to still contain something, and with the retention risk stated —
because several of these expire.

### 3.1 Supabase Storage — the `recordings` bucket ✅ most valuable

The mp4s themselves, at `recordings/{room}-{epoch-ms}.mp4`
(`app/api/egress/start/route.js:123`). Independent of any database row (§1.5a). **This is the
one place where irreplaceable primary evidence lives, and Q13 is how you enumerate it.** Also
in Storage: the `avatars` bucket (`lib/supabaseAuth.js:242`), the backing-track bucket
(`app/api/tracks/register/route.js`) and the b-roll bucket (`app/api/broll/register/route.js`).

### 3.2 LiveKit Cloud dashboard ⏳ time-sensitive

LiveKit's own console holds session/room history, participant-minutes, and egress job history
— **exactly the room and participant lifecycle data §1.4 shows was never ingested.** This is
the only remaining source for authoritative attendance and duration.

⚠️ **Retention is finite and plan-dependent, and this is the highest-priority thing to
export.** If pilot shows are older than the retention window, this evidence is already gone.
Check and export before anything else in this list.

Note also that the egress recording is composited by `components/EgressPage.jsx`, which is a
separate browser surface from the artist's and viewer's. Whether the comments overlay appears
in the recorded file depends on what that page renders — I have not verified it, and if
comments *do* appear on screen in the mp4s, that is the only surviving trace of pilot chat.
**Worth checking a recording by eye.** I am flagging this as a possibility, not a claim.

### 3.3 Vercel ⏳ time-sensitive

- **Runtime logs.** Every swallowed failure in §1 wrote a `console.warn`/`console.error` —
  `[reactions] insert failed`, `[flywheel] shot log failed`, `[participants] insert failed`,
  `[recordings/sync] insert failed`. These are the *only* record of writes that were attempted
  and rejected. Retention on Vercel logs is short (hours to a few days on most plans); for
  pilot-era shows this is almost certainly already expired, but worth one look.
- **Web Analytics**, if it was enabled — page views and unique visitors on `/live`, which is a
  demand signal no Postgres table holds.

### 3.4 Files already on your machine ✅ safe, check first

The repository working tree currently holds untracked CSV exports:
`countdown.csv`, `countdown2.csv`, `freeze-run-1.csv`, `freeze-run-2.csv`, `task1.csv`, plus
whatever the CPU sessions produced. These are `health_events` exports
(`app/api/health-events/export/route.js`) — already-extracted evidence sitting outside the
database. They are untracked and one `git clean` from gone. **Move them somewhere durable
before doing anything else.**

### 3.5 Stripe

If the wallet was exercised, Stripe holds the authoritative payment record; `payment_intents`,
`wallet_transactions` and `webhook_events` are the local mirror. Stripe retains indefinitely,
so this one is not at risk.

### 3.6 Supabase `auth.users`

Signup timestamps are acquisition evidence and live in the `auth` schema, not `public` — easy
to miss in an export that only walks `public`. Q15 covers it.

### 3.7 Gone, with no recovery path

- **Comments.** Data-channel payloads are relayed by the SFU, never stored (§1.1), subject only
  to the §3.2 caveat.
- **Reaction attribution.** The rows exist; the identity was never sent (§1.2).
- **Anonymous viewer identity.** No row was ever written (§1.3a).

---

## 4. The gap, and the minimum fix

> **This section is design only.** Nothing here has been built, and per the standing rule,
> nothing will be until you approve a plan.

### 4.1 What the gap actually is

The pilot instrumentation was built to answer **"did the broadcast work?"** — and it answers
that well. `health_events` is genuinely rich (135 distinct event types), and the egress
verification path is careful.

It was never built to answer **"was the show any good, and did anyone care?"** Those are the
two questions an investor and a visa business plan need. Specifically, the record cannot
currently answer:

| Question | Why not |
|---|---|
| How many people watched? | The live count is computed and shown but never written down (§1.3c); anonymous viewers leave no row (§1.3a) |
| How long did they stay? | Only inferable from reliability telemetry, and only where it flushed (§1.3b) |
| Did the show actually happen, and for how long? | `shows` holds scheduled times only (§1.6ii) |
| How engaged were they? | Reactions are counted but unattributed (§1.2); comments are gone (§1.1) |
| What did the director do? | `shot_commands` may be empty for an RLS reason (§1.7) — Q10/Q11 decide |

Three of those five are one small table away from being answerable. One is a policy check. One
(comments) is unrecoverable for the pilot but trivial to fix going forward.

### 4.2 The minimum persistence fix — four pieces, in dependency order

Deliberately minimal. Each is additive, each is independently useful, and none requires
touching a populated column.

**Piece 1 — Ingest the LiveKit room/participant webhooks. Biggest return, smallest surface.**

`app/api/egress/webhook/route.js` already verifies LiveKit's signature and already discards
non-`egress_ended` events at `:69-71`. Widening that gate to also handle `room_started`,
`room_finished`, `participant_joined` and `participant_left`, and writing each to one new
append-only `room_events` table (`room_name`, `event`, `participant_identity`, `participant_name`,
`occurred_at`, `raw jsonb`), gives you — **from LiveKit's own server, not a client that might
have closed its tab** — real attendance, real dwell time, real concurrency, and real show
start/end. It replaces the inference in Q4, Q5 and Q6 with fact.

*Prerequisite, and it is a real one:* LiveKit must be configured to send these events to that
URL, and the URL must be publicly reachable. The route's own comment (`:29-36`) records that a
protected preview blocks it. **Verify reachability in production before building anything.**

**Piece 2 — Persist comments.** One `show_comments` table (`show_id`, `author_identity`,
`author_name`, `body`, `sent_at`), written from a new route with the service-role client, on
the same fire-and-forget/batched/beacon pattern `lib/reactions.js` already proves works. The
send path at `components/LiveDemo.jsx:3253-3264` gains one call and changes nothing else — the
data channel stays as the live transport, exactly as reactions do. This also gives
`components/VODPlayback.jsx` something real to replay, which it is currently written to refuse
to fake.

*Design question that needs your decision, not mine:* comments are public in the moment but a
stored comment log is a different privacy object — the same argument `docs/overnight2_11_reaction_events.sql:76-82`
makes about not reading individual audience behaviour. Retention and visibility need deciding
before the table exists, not after.

**Piece 3 — Attribute reactions.** No schema change at all. `reaction_events.user_id` already
exists and is already nullable; the route already reads a Bearer token when one is present
(`app/api/reactions/route.js:38-40`). The fix is **one header** in
`lib/reactions.js:93-98` and `:110-116`. That turns "1,400 reactions" into "1,400 reactions
from 96 distinct people", which is a completely different sentence in a business plan.

*Caveat, stated because it materially affects the number:* anonymous viewers still land as
NULL, and that is correct — the alternative is fabricating a device fingerprint.

**Piece 4 — Record actual show start and end.** Two nullable columns on `shows`
(`started_at`, `ended_at`), written at the same two points that already trigger egress:
`components/LiveDemo.jsx:4510` (start) and `:3202` (End Show). Additive, no backfill —
existing rows genuinely do not know, and `mvp3_01`'s reasoning about not backfilling a guess
into an attribution column applies identically here.

This makes `reaction_events.offset_ms` meaningful going forward and lets any "did it happen"
query stop inferring. **Piece 1 makes this redundant** if the webhooks land — Piece 4 is the
client-side fallback for the case where they do not, and is worth doing anyway because it is
the cheapest of the four.

**Explicitly out of scope of "minimum":** a viewer-count surface, an analytics dashboard, a
retention-curve view, per-artist director models. All are downstream of having the data and
none of them are what is blocking you.

### 4.3 Do this before building any of it

1. **Run §2.** Especially Q10 and Q11 — if `shot_commands` is empty for an RLS reason, that is
   a one-line policy fix that recovers the flywheel going forward, and it outranks all four
   pieces above.
2. **Export the LiveKit Cloud session history** (§3.2). It is the only time-sensitive item on
   this list and it holds the data Piece 1 is designed to start capturing. Every day of delay
   is potentially evidence lost.
3. **Move the CSVs out of the working tree** (§3.4).

### 4.4 PRD and S&I coverage

| Finding | PRD row | S&I area |
|---|---|---|
| §1.1 comments ephemeral | Director Experience / Live Show | Database, Real-time media |
| §1.2 reactions unattributed | AI Director Layer 1; Token economy | Database, Observability |
| §1.3 viewer telemetry partial | Live Show; Accounts & Identity | Database, Observability, Auth |
| §1.4 webhooks not ingested | Live Show | Observability, Real-time media, Stateless hosting |
| §1.5 recordings conditional | Live Show; Multi-Camera & Production | Database, Stateless hosting, Observability |
| §1.6 no actual show times | Live Show | Database |
| §1.7 shot_commands at risk | AI Director Layer 1 | Database, Observability |

As expected, **Database** and **Observability** carry almost everything. The one that was not
expected is **Auth** — §1.2 and §1.3a are both, at root, cases where a write path either did
not send a credential it had, or required one it should not have.
