# Pilot 2 — Build Plan

**Pilot:** Sunday 20 September 2026. **Freeze:** Friday 18 September EOD.
**Dress rehearsal:** Saturday 19 September. **Second outing:** Sunday 27 September,
third-party physical event.
**Planned:** Friday 11 September 2026. **Seven build days.**
**Status:** PLAN ONLY — no code written, no migrations written.

`pilot-freeze-v2` stays bootable and untouched throughout.

This supersedes the six-piece scope of `PILOT_2_PLAN.md` and keeps its §0 findings,
its §1.3 `ended_by` ruling and its §4.2 layer model. Where the two disagree, this
document wins.

---

## 0. What I checked before planning, and what it changes

Every historical claim below was checked against commit dates. Three items in the
brief change shape as a result.

### 0.1 `shot_reselect` is already persisted durably — item 1c is verification, not building

- `health_events` (table, route, logger) shipped **2026-08-18**, `32c1cee`.
- `logHealthEvent('shot_reselect', {reason, from, to})` shipped **2026-08-22**,
  `9d6c19f` ("add liveness telemetry (Finding A)"). Wired at
  `components/LiveDemo.jsx:1571`, passed to `ShotVideo` at `:3632`.
- `countdown.csv`'s header **is** the `health_events` column list
  (`created_at, client_ts, event_type, …, from, to, reason, …`). It is an export of
  that table, not an incidental local capture. The 29 August event was in the
  database.

So the mechanism exists and worked. What is genuinely missing:

| Gap | Consequence |
|---|---|
| No live-side equivalent of `egress_stale_command_dropped` | We can see a re-select, never a stale framing applied to a replacement |
| Camfeed pages log no room lifecycle at all (§7.5 of the old plan) | A paired phone still cannot be diagnosed after the fact |
| `health_events.show_id` holds the **room name**, not `shows.id` | Every 21 September query must join through `shows.room_name`. This is the single most likely way the post-show analysis returns an empty result that looks like a missing write |

**Item 1c becomes:** prove rows exist in production, add the two missing event
types, and write the joins correctly in the checklist.

### 0.2 Item 11d (`artist_id` at 4.6%) is very likely not a bug

`shot_commands.artist_id` shipped **2026-09-04**, `6712a97`. The 3,061 rows span
31 July – 5 September, so all but ~2 days of them **predate the column** and are
NULL by the deliberate no-backfill rule in `docs/mvp3_01_shot_commands_artist.sql:43-48`.
All three `buildShotCommand` call sites already pass it (`:3426`, `:3813`, `:4005`)
from `session?.user?.id` (`:1432`).

**Action:** run the by-day query in §8 first. If post-04-09 rows are populated,
there is nothing to fix and the 4.6% is arithmetic. If they are not, the cause is a
director client with no Supabase session, which is a different fix.

### 0.3 Item 11b is already shipped

`components/ScheduleShow.jsx:127` mints `show-${random}` per show; `/api/token`
400s without a room and has no default (`app/api/token/route.js:30-37`);
`countdown.csv` shows `show-tjtd0pyo`. **Verification query only.**

### 0.4 Item 4's premise needs one correction

`components/LiveDemo.jsx:1143` mints `viewer-${userId8 || 'anon'}-${Date.now()}` —
unique **per connection**, not per person. Registering it alone yields sessions, not
unique viewers and not watch time per person. A viewer who reloads once counts twice.

The design in `PILOT_2_PLAN.md §2.1` is still correct and this plan keeps it: a
device-scoped `viewer_id` in `localStorage`, never sent over the wire, with the
LiveKit identity as the join key to `health_events` and the webhooks. Item 11f's
name-and-email entry adds a third, stronger key for the people who give it.

One mechanism, three keys, each with a stated meaning:

| Key | Scope | Answers |
|---|---|---|
| `viewer_id` (localStorage UUID) | device, across shows | unique viewers, watch time per person |
| `livekit_identity` | one connection | joins to `health_events` + webhooks |
| `email` (if given at entry) | person | follow-up, cross-referencing the July survey |

### 0.5 Items 1a, 10 and 11a are one mechanism, and the naive port would cause a regression

See §1. Building them separately would be three changes to the same twelve lines.

### 0.6 Item 9 has a precedent in the repo already

`docs/overnight2_08_webhook_events.sql` exists for the payments webhook. Reuse the
shape. Also: `app/api/egress/webhook/route.js` already verifies LiveKit's signature
against the **raw body bytes** and early-returns on any event that is not
`egress_ended` (`:68-71`). Room/participant ingestion is an insert placed **after**
signature verification and **before** that early return. The raw-body read must not
be touched.

Note also that egress webhooks are attached **per request**
(`app/api/egress/start/route.js:168-171`), so recording verification does not depend
on the dashboard webhook at all. Deleting `loud-app-umber` cannot break it.

### 0.7 Two config items nobody has listed, both with real consequences

1. **`EGRESS_TEMPLATE_BASE_URL` — the value cannot be read back, and the metadata
   says what it almost certainly is.** `vercel env ls` reports it as **Sensitive,
   Production only, created 33 days ago** (≈ 9 August 2026) and never updated since.
   Sensitive is write-only by design: `vercel env pull` returns `"[SENSITIVE]"`, so
   neither I nor you can read it without overwriting it.

   Your test proves it currently resolves — the recording captured the show, not a
   login page. Your own reading is the right one: it predates `loudentify.app`
   becoming production by weeks, so it is working because the `vercel.app` origin
   still serves, and it will break **silently** when you remove that domain. The
   failure mode is a recording of a 404, discovered afterwards.

   Since the value is unreadable, overwriting is the only way to be certain:

   ```
   vercel env rm  EGRESS_TEMPLATE_BASE_URL production
   vercel env add EGRESS_TEMPLATE_BASE_URL production   # https://loudentify.app
   ```

   **Sequenced for Friday's deploy, not now.** It needs a redeploy to take effect,
   there is one scheduled on the 18th anyway, and Saturday's dress rehearsal is the
   test that proves it. Changing it mid-week means an unverified recording config
   sitting through four days of device testing. Not after the 27th — before the 20th,
   so the pilot's own recording proves the new value.
2. **There is no `vercel.json` in this repo.** Both the `lhr1` region pin and any
   Layer D cron need one. Adding a `regions` key affects every function in the
   deployment, so it lands early in the week, not on the 17th.

### 0.8 `SHOT_COMMAND` is applied from any sender

`components/LiveDemo.jsx:2900-2910` applies `SHOT_COMMAND` with no check on
`msg.from`. Every viewer has `canPublishData: true` (needed for comments). Today the
only client that sends one is a performer, so this has never mattered. **Item 7 adds
a second legitimate sender, which is what makes sender validation part of that item
rather than a refactor.** Same for `SHOW_ENDED`.

---

## 1. Item 1 — Publisher rejoins under a new identity

**PRD:** Live Show / Director Experience · **S&I:** Real-time media, Observability
**Ships first. It is the on-air risk and the evidence-integrity risk in one.**

### 1.1 The regression a straight port would cause

`EgressPage.jsx:248-271` drops the whole command when its `targetIdentity` leaves the
pool. A recorder can afford that. **The live stage cannot**, because of something that
works today and is easy to destroy:

A camfeed that drops and comes back returns under the **same identity** — the session
route reuses the stored `device_identity` (`app/api/camfeed/session/route.js:130`).
The command is still in `activeShot`, so `matched` becomes truthy again and the shot
**re-acquires by itself**. Delete the command and that self-healing is gone; the
director would have to re-cut manually for every transient camera drop.

### 1.2 What I will build instead

On every pool change, for each slot whose `cmd.targetIdentity` is not in the live pool:

1. **Keep the command and its target.** Same-identity return still re-acquires. Free.
2. **Suspend the framing** — set `framingSuspended`, so the fallback renders
   untransformed. This is item 11a, arrived at through item 1a: a replacement camera
   is never wearing a crop composed for a camera that no longer exists.
3. **Log `stale_command_suspended`** to `health_events` with slot, target, and the
   fallback actually chosen. This is the live-side twin of
   `egress_stale_command_dropped`, and it is the missing half of item 1c.
4. **After a TTL (proposed 20s) with the target still gone, downgrade** the slot to
   `wide` on the best live camera — `SHOT_TYPES.wide.transform` is `null`
   (`lib/shotTypes.js:70-77`), so this is the neutral frame by construction. **This is
   item 10**: if the director stops for any reason, every client independently lands
   on a plain, live, unzoomed shot instead of holding a dead target.

Steps 1–3 are ~15 lines in `RoomInner`. Step 4 is a timer on the same effect. One
device test covers all four.

### 1.3 Item 1b — what a manually directed show does after a performer rejoin

**Answer: it recovers automatically in every case except one, and that one should be
a runbook step, not code.**

| What the command targeted | What happens today | Verdict |
|---|---|---|
| The performer's own main camera | The performer rejoins as a new identity (`contestant-${slot}-${uuid8}`, `app/api/performer/join-show/route.js:150`). `matched` goes undefined, the fallback's second branch picks `roleOfTrack === 'main'` — **the new main camera**. Correct shot, wrong framing. | Framing fixed by §1.2. Nothing else needed. |
| A camfeed that is still live | Unaffected. A performer rejoin does not disturb it. | Nothing needed. |
| A camfeed that dropped and returned | Same identity, so the command re-matches and the shot **re-acquires on its own**. | Already works. §1.2 step 1 exists to protect it. |
| A camfeed re-paired under a **new** pairing | Nothing re-acquires it. It appears in `availableRoles`; auto-director will find it on its next cut; a manual show will not. | **Runbook step.** |

I do **not** recommend upward re-acquisition by role for the last row. Re-targeting a
command to a different participant because it happens to share a role means the
audience's view moves without the director choosing it — and it would fire precisely
during the churn of a camera being re-paired, which is when the operator is least
likely to want a surprise cut. On the 20th you are operating, in the room, with the
console in front of you. The runbook line is:

> **After re-pairing a camera mid-show, tap the shot you want. The new camera does
> not inherit the old one's cut.**

Cost of the alternative: ~half a day plus a behaviour that is unpredictable under
exactly the conditions it fires in. Not worth it before a freeze.

### 1.4 Item 1c — final shape

- Verify `shot_reselect` rows exist in production (§8, query V6).
- Add `stale_command_suspended` (§1.2 step 3).
- Add camfeed room lifecycle — `room_connected` / `room_disconnected` **with the
  `DisconnectReason`** / `room_reconnecting` — to `CamViewfinder.jsx`, matching what
  `LiveDemo.jsx:1793-1800` already does. Four lines, and it is the difference between
  diagnosing the 27th from our own data or from LiveKit's console again.

**No migration.** All of this lands in `health_events`.

---

## 2. Item 2 — The pairing cap

**PRD:** Multi-camera / Kit Check · **S&I:** Database
**Ships same day as item 1. No migration, no schema change.**

`app/api/camfeed/pair/route.js:210-218` counts `created_by = user AND revoked_at IS
NULL` with no filter on `used_at` or `expires_at`, and nothing anywhere prunes. Every
code ever minted counts against the cap of six, forever.

**The fix is a filter, and the filter has to say what "live" means.** Three states are
different and only two of them are a camera:

| Row state | Counts? | Why |
|---|---|---|
| `used_at IS NULL AND expires_at > now()` | **Yes** | An outstanding code. A camera is about to exist. |
| `used_at IS NOT NULL` and seen recently | **Yes** | A camera that exists. |
| `used_at IS NULL AND expires_at < now()` | No | A code nobody redeemed. Not a camera and never was. |
| `used_at IS NOT NULL` and not seen for hours | No | A phone from a previous rehearsal. The 6-hour window is the same order as the migrate call's `expires_at` push (`route.js:314`). |

Implemented in the route, not in PostgREST: select the caller's non-revoked rows
(bounded, a few dozen at most) and count in JS. Clearer than an `.or()` chain and it
puts the definition in one readable place.

**Also, before the dress rehearsal:** one `UPDATE` setting `revoked_at` on the
operator's stale rows, so the 20th starts from a clean rig regardless. The code fix
still ships — the rehearsals between now and the 27th will refill it otherwise.

---

## 3. Item 3 — Actual show timings

**PRD:** Live Show / Director Experience · **S&I:** Database, Observability
**Lands before items 4, 5 and 6 — they all measure against it.**

Unchanged from `PILOT_2_PLAN.md §1`, which you have accepted: three-state `ended_by`
(`artist` / `window_sweep` / `webhook`), first-write-wins enforced in the `UPDATE`
with `.is('actual_started_at', null)` rather than trusted to a client ref.

**One boundary worth stating explicitly, because getting it wrong is silent:** only
**offset** computations move to `actual_started_at`. Scheduling semantics stay on
`slated_at` — `lib/showWindow.js`, `lib/showState.js` and `lib/scheduling.js` decide
when the door opens and when the window closes, and those must not wait for a show to
start. One helper, `showOriginMs(show)` in `lib/showState.js`, returns
`actual_started_at ?? slated_at`, and only offset writers call it.

Offset call sites today: `components/LiveDemo.jsx:3233` (reactions). Items 5 and 6
add two more; all three go through the helper.

**Migration:** `pilot2_01_shows_actual_times.sql`.

---

## 4. Item 4 — Viewer identity, join and leave

**PRD:** Live Show, Accounts & Identity · **S&I:** Database, Auth, Observability

Per `PILOT_2_PLAN.md §2`, with §0.4 above as the correction. **Two** leave sources,
not three, with labelled provenance in `left_source`:

| Source | Rank | Note |
|---|---|---|
| `participant_left` webhook (item 9) | **Authoritative** — promoted, per your reordering | Server-side, survives a killed tab, overwrites a beacon value when both arrive |
| `pagehide` beacon | Primary on day one | Same mechanism `lib/reactions.js:104-121` already proves works. Does not fire on every mobile kill path |

The stale-session sweep is cut (§14). With the webhook promoted, it only ever
produced an upper bound that was already labelled as one.

Name and email from item 11f are stored **on `viewer_sessions`**, not in a separate
table — one fewer migration, and they belong to the session in which they were given.

**Presence sampler: cut**, and you are right that it should be. It writes down a
number `PresenceCounter.jsx:32-50` already computes and displays; `participant_joined`
and `participant_left` give a concurrency curve derived from what LiveKit's server
observed, which survives a client bug that a self-reported sample does not.

**Migrations:** `pilot2_02_viewer_sessions.sql`, `pilot2_04_reaction_events_keys.sql`.

---

## 5. Item 5 — Comment persistence

**PRD:** Live Show / Director Experience · **S&I:** Database, Real-time media

`lib/comments.js` modelled on `lib/reactions.js`: batched, fire-and-forget,
`pagehide` beacon, fail-silent. Added **after** the two existing lines in
`sendComment` (`components/LiveDemo.jsx:3253-3264`); the live delivery path is not
touched. Each client persists only its own comments, so there is no dedup question.

Row: `show_id, viewer_id, livekit_identity, author_name, body, offset_ms
(showOriginMs), client_ts, created_at`. 1,000-char cap in the schema. Service-role
only, zero read policies, same posture as `reaction_events`.

**Migration:** `pilot2_03_show_comments.sql`.

---

## 6. Item 6 — In-show questionnaire

**PRD:** Live Show / Audience · **S&I:** Database, Real-time media
**Built as a keeper: this is the Versus live-voting mechanism.**

**DECIDED: free-form is the primary path, saved prompts are a shortcut on top of
it.** Not a fixed list with an escape hatch — the same mechanism either way, so a
question typed on the night is exactly as queryable on the 21st as a planned one.

**Compose and push.** Type the question, choose the answer type — multiple choice
with 2–4 options you type, or open text — and send it to the room. The `options`
CHECK in the schema enforces 2–4 on a choice prompt and zero on a text prompt, so a
broken question cannot reach a live room from any route.

**Saved prompts.** The four below preloaded in the client, fired with one tap, no
typing mid-show. They are not seeded as rows: a row in `show_prompts` means a
question that was actually pushed into a specific show, and seeding four unpushed
rows per show would stop `count(*)` meaning "what the audience was asked".

| When | Source | Question | Answers |
|---|---|---|---|
| ~10 min | new | How does this compare to a normal phone live stream? | Better / About the same / Worse |
| ~25 min | **July survey, verbatim** | Watching would be free. Would you ever buy tokens to power-vote or tip an artist you loved? | Definitely / Only for an artist I really love / No, never |
| ~40 min | **July survey, verbatim** | Which would you most likely try first? | Free votes only / £10 token pack / £20 token pack |
| End | new, open text | What would make you come back for another show? | — |

Order is as you set it and is load-bearing: the comparison question needs them to
have watched enough to judge, and the two survey questions need to be late enough
that the answers reflect the experience rather than the idea. The two verbatim
strings live in one client constant with a comment saying, in as many words, that
editing a character invalidates the comparison with July.

**The question text is stored on every response**, not only on the prompt —
`prompt_body` and `choice_label`, frozen at the moment of answering. A response
reachable only through a join is one edit away from meaning something else, and a
spontaneous question is useless later if the answer cannot recall what was asked.
This is the single most important line in item 6.

Delivery: the operator pushes; the server writes the `show_prompts` row and the
client broadcasts `{type:'PROMPT'}` over the data channel that is already open. An
answer writes through a route, not the channel — a response is data, not an event
everyone needs. The card pins to the top of chat until answered or dismissed, and
the pin is a column so a reload restores it.

Versus voting needs no schema change on top of this: a vote is a `choice` prompt
whose results are read back live, and `prompt_responses` is already one-answer-
per-viewer with last-one-wins, which is what stops an enthusiastic tapper outvoting
three people.

**Migrations:** `pilot2_06_show_prompts.sql`, `pilot2_07_prompt_responses.sql`.

---

## 7. Item 7 — Moderator role

**PRD:** Live Show / Director Experience, Accounts & Identity · **S&I:** Auth, Real-time media
**The largest new surface in this plan, and the one I most want scoped down.**

The problem is one boolean. `components/LiveDemo.jsx:2092`:

```js
const isMainPerformer = role !== 'viewer' && role !== 'performer' && !role.startsWith('camfeed-');
```

That single flag gates the director console **and** the audio graph, Go Live, End
Show, the egress trigger, capability monitoring and the wake lock. A moderator needs
the first and none of the rest.

**The change:** split it into two derived booleans — `directsShow` (console, shot
commands, prompts, moderation) and `publishesVideo` (everything that touches capture,
audio and egress). `isMainPerformer` becomes `directsShow && publishesVideo` at the
call sites that genuinely mean both. This is contained, but it touches the most
load-bearing conditional in the file, so it lands **Tuesday, not Thursday**.

**DECIDED: the real table ships, not owner-as-moderator.**
`docs/pilot2_08_show_moderators.sql`. The reasoning is yours and it is right: on the
27th the artist will own their own show at a physical venue and the operator will
not, so the cheap version would have to be rebuilt in the seven days between the two
pilots — the worst week available.

Moderation is a **grant against a show**, not a property of ownership. The owner is
implicitly a moderator and needs no row; the table is how anyone else becomes one.

**Capabilities are columns, not a role name**, per answer 4 — Go Live and End Show
sit with the operator on the 20th and may sit with the artist on the 27th, and that
must not be a code change under freeze pressure:

| Column | Grants | Default |
|---|---|---|
| `can_direct` | Director console, shot commands, camera control, prompts | true |
| `can_moderate` | Pin a prompt, soft-delete a comment | true |
| `can_control_lifecycle` | Go Live, End Show | **false** — ending someone else's broadcast is granted deliberately, one show at a time |

**Sender validation is now a requirement, not tidiness** (§0.8). A moderator is a
second legitimate `SHOT_COMMAND` sender **who is not in the room as a performer**, so
"the sender is a `contestant-*`" stops being a usable rule at the same moment this
table starts being used. Receivers check `msg.from?.identity` against the performer
prefixes and this show's moderator identity, for `SHOT_COMMAND` and `SHOW_ENDED`
both. Ships with item 7, in the same commit.

Moderation actions for the 20th: delete a comment (broadcast + soft-delete column on
`show_comments`), pin a prompt. Not: ban, mute, timeout.

---

## 8. Item 8 — Close the room when the show ends

**PRD:** Live Show · **S&I:** Real-time media, Stateless hosting, Database
**The cost bug. 2.54GB up / 12.8GB down of pilot 1 waste.**

Layers A–C exactly as `PILOT_2_PLAN.md §4.2`, with Layer D now viable on Pro.

**§4.3 is a hard prerequisite and ships first.** `components/ReleaseOnShowEnd.jsx:105`
is still `function onDisconnected() { release('room_disconnected'); }` — it reads no
reason and treats all eight identically. Layer B introduces `ROOM_DELETED`, a
disconnect reason this system has never produced. Until the split lands, adding Layer
B means a transport blip and a deliberate teardown are indistinguishable, which is the
standing rule violated in the one place it is most expensive.

| Reason | Meaning | Action |
|---|---|---|
| `CLIENT_INITIATED`, `ROOM_DELETED`, `PARTICIPANT_REMOVED` | Intent | Release. Terminal. |
| `DUPLICATE_IDENTITY`, `SIGNAL_CLOSE`, `STATE_MISMATCH`, `JOIN_FAILURE`, `MIGRATION`, `SERVER_SHUTDOWN`, `UNKNOWN_REASON` | Transport failure | Do **not** release. Keep the poll alive. |

**Ordering that is not obvious:** egress stop must complete before the room is
deleted, or the recorder is evicted mid-file. `triggerEgress` is fire-and-forget today
(`components/LiveDemo.jsx:3202`); Layer B awaits the stop with a ~5s bounded timeout,
then closes regardless. Losing the last two seconds of a recording beats a six-hour
room.

**Layer C must also stop egress**, not only close the room — §0.3 of the old plan
means an unattended end stops nothing today, and that is what produced the 5h39m
publish.

**Layer D: cut** (§14). Pro is pending, so minute-level cron is not available and a
daily cron is useless here. `vercel.json` still gets written on Sunday with
`regions: ["lhr1"]` so the region move is one confirmation away rather than a
freeze-week change — but it is **inert until you confirm the upgrade**, and nothing
this week depends on either it or `lhr1` being live.

The gap Layer D would have closed is "every browser is gone and the room is still
open". On the 20th you are operating, you hold End Show, and you have said you can
close the room by hand. That is the mitigation, and it is written into the runbook
rather than assumed.

---

## 9. Item 9 — Room webhook ingestion

**PRD:** Live Show · **S&I:** Observability, Database

`room_started`, `room_finished`, `participant_joined`, `participant_left` into
`room_events`, inserted in `app/api/egress/webhook/route.js` after signature
verification and before the `egress_ended` early return.

**Idempotency:** unique index on LiveKit's own event `id`, insert with
`on conflict do nothing`. This is what makes a duplicate delivery a no-op even while
both webhooks are still configured — so the fix does not depend on you having deleted
`loud-app-umber` first, and a LiveKit redelivery after a 5xx cannot double-count a
join.

`participant_left` overwrites `viewer_sessions.left_at` and sets
`left_source = 'webhook'`, keeping the beacon's value when no webhook arrives.

**Migration:** `pilot2_05_room_events.sql`.

---

## 10. Item 10 — Graceful failure

Delivered by §1.2 step 4. No separate work, no migration. Stated as its own line in
the dress-rehearsal script because it needs its own test: kill the director's tab
mid-show and confirm every other client lands on a live, unzoomed, plain shot rather
than a frozen frame.

---

## 11. Item 11 — Smaller items

| # | Item | Status |
|---|---|---|
| a | Cameras reset to a neutral unzoomed frame | **Delivered by §1.2 step 2.** Not cosmetics — it is the same twelve lines |
| b | Room name per show | **Already shipped.** Verification query only (§0.3) |
| c | Show UUID on `shot_commands` | `pilot2_07_shot_commands_show_uuid.sql` — additive nullable column + index, written alongside the existing room-name `show_id`, no backfill |
| d | `artist_id` populated | **Verify before fixing** (§0.2) |
| e | SELECT policy on `shot_commands` | `pilot2_06_shot_commands_select_policy.sql` — scoped to the show's owner through `shows.room_name`; rows whose room no longer resolves stay service-role-only |
| f | Landing page: countdown, name + email, data notice, 18+ | **Extends the existing holding screen** (`components/LiveDemo.jsx:1474`, countdown already at `:4675`) rather than a new page. Cheaper, and it is already the one screen where nobody is mid-show |

Copy for the data notice and the 18+ line comes to you for approval before it ships.

---

## 12. Recording

**Does it stop when the show ends?** Partly, today.

- `endShow` calls `triggerEgress('stop', roomName)` — `components/LiveDemo.jsx:3202`.
  Confirmed present and correct for the intentional path.
- If nobody presses End Show, **nothing stops it** (§0.3 of the old plan). Layer C
  gains the egress stop for that path (§8).
- Layer B awaits the stop before deleting the room, so the file is closed before the
  recorder is evicted.

**Does the upload complete?** It writes straight to Supabase Storage over the
S3-compatible endpoint (`app/api/egress/start/route.js:120-135`, `forcePathStyle:
true`), MP4, `recordings/${room}-${Date.now()}.mp4`, canvas pinned to 1080×1920. The
10GB single-file limit removes the constraint for any plausible show length — at the
current encoder settings a 60-minute portrait recording is on the order of 1–2GB.

**The only proof is a completed object.** `info.status` from the start call reflects
the synchronous start only; a bad credential or a bucket limit surfaces at stop or
later. So this is a dress-rehearsal gate, not a code question: record a full-length
rehearsal, confirm the object exists with a plausible byte count, and confirm the
`recordings` row (§13, query V9).

**And check `EGRESS_TEMPLATE_BASE_URL` first** (§0.7). If it points anywhere but
`https://loudentify.app`, the recording is a screenshot of a login page.

---

## 13. Post-show verification checklist

**Delivered in full as `docs/PILOT_2_VERIFICATION.md` and as
`scripts/verify-write-paths.mjs`**, a service-role script that runs every query below
and prints one table: write path, row count, verdict. It runs three times — after the
dress rehearsal, during the pre-show canary, and on the 21st.

The reason it is a script and not a document: reactions looked correct in code for
weeks and wrote nothing, and the failure was invisible because the route warns to a
log nobody reads and the client ignores the response by design
(`app/api/reactions/route.js:64-68`, `lib/reactions.js:96-101`). **An empty table and
correct code are indistinguishable from the outside. Only a query tells you.**

Every query below must return a non-zero count for the pilot show. A zero is a defect
report, not an observation.

### ⚠️ READ THIS BEFORE RUNNING ANY QUERY — two `show_id` namespaces

This is not a footnote. It is the most likely way a query comes back empty on the
21st and is mistaken for a missing write.

| Table | What `show_id` holds |
|---|---|
| `health_events` | **The room name** (`show-xxxxxxxx`). `initHealthLog` passes `roomName` |
| `reaction_events` | **Either** — the show UUID when the client resolved one, the room name when it did not (`LiveDemo.jsx:3235`, `showId \|\| roomName`) |
| `shot_commands` | **The room name** (`buildShotCommand({ showId: roomName })`) |
| `viewer_sessions`, `show_comments`, `room_events`, `show_prompts`, `prompt_responses` | **The show UUID**, plus a `room_name` column carried alongside for exactly this reason |

So every query below takes **both** keys, and the pack starts by resolving them once:

```sql
-- Run this first. Every query below uses :show (uuid) and :room (text).
select id as show_uuid, room_name, actual_started_at, actual_ended_at
  from shows where id = '<the pilot show>';
```

A query filtering `health_events.show_id = '<uuid>'` returns zero rows against a
table containing thousands. It looks exactly like a write path that never ran.

### ⚠️ READ THIS TOO — production and preview share one database

Deliberately: two Supabase projects means every migration runs twice, and they drift
the first time one run is skipped. So a device test on a preview URL writes **real
rows into these same tables**, and every query below has to exclude them or the
pilot's numbers include the week's rehearsals.

`docs/pilot2_env_stamp.sql` adds one column, `env`, to the six pilot tables, written
by `rowEnv()` (`lib/rowEnv.js`) from `VERCEL_ENV`. **It defaults to `'production'`,
so no existing row changed and no un-updated write path is excluded** — a row has to
explicitly say it is not production to be filtered out. Inflated numbers are
recoverable; lost ones are not.

**Every query below filters `env = 'production'` by default.** To see what a device
test wrote instead, swap the filter to `env <> 'production'` — the same query answers
both questions.

Three tables predate this and have **no `env` column**: `health_events`,
`reaction_events`, `shot_commands` (V4, V6, V7, V10 below). They are keyed by **room
name**, so a test show is a different room and separates naturally — as long as
device tests use their own show, never the pilot's show row. That is a runbook rule,
not a constraint the schema enforces.

| # | Write path | Query |
|---|---|---|
| V1 | `shows` timings | `select id, room_name, slated_at, actual_started_at, actual_ended_at, ended_by from shows where id = :show;` — expect all three non-null, `ended_by = 'artist'` |
| V2 | `viewer_sessions` join | `select count(*), count(distinct viewer_id) from viewer_sessions where show_id = :show and env = 'production';` |
| V3 | `viewer_sessions` leave | `select left_source, count(*) from viewer_sessions where show_id = :show and env = 'production' group by 1;` — expect rows under `beacon` and `webhook`, and few under `sweep` |
| V4 | `reaction_events` | `select count(*), count(viewer_id) from reaction_events where show_id = :room;` — **note `show_id` is the room name here**, and no `env` column: separated by room |
| V5 | `show_comments` | `select count(*), count(distinct viewer_id) from show_comments where show_id = :show and env = 'production';` |
| V6 | `health_events` re-selects | `select event_type, detail->>'reason' as reason, count(*) from health_events where show_id = :room and event_type in ('shot_reselect','stale_command_suspended','stale_command_resumed','stale_command_downgraded','local_devices_released') group by 1,2;` — **`reason` is a jsonb field, not a column**; the bare `reason` this previously read errors with 42703 |
| V7 | `health_events` presence | `select count(*), max((detail->>'viewers')::int) from health_events where show_id = :room and event_type = 'presence_sample';` — expect ≈ 2/minute. **The column is `detail`, not `extra`** |
| V8 | `room_events` | `select event, count(*) from room_events where room_name = :room and env = 'production' group by 1;` — expect all four types, and `participant_joined` ≈ distinct viewers + performers + egress |
| V9 | `recordings` + object | `select id, storage_path, bytes, duration_seconds, verified from recordings where show_id = :show;` plus a storage listing of that path |
| V10 | `shot_commands` | `select count(*), count(artist_id), count(show_uuid) from shot_commands where show_id = :room;` — no `env` column: separated by room |
| V11 | `show_prompts` / `prompt_responses` | `select p.id, p.body, count(r.id) from show_prompts p left join prompt_responses r on r.prompt_id = p.id and r.env = 'production' where p.show_id = :show and p.env = 'production' group by 1,2;` — the response filter is in the **JOIN**, not the WHERE, so a prompt nobody answered still reports zero rather than disappearing |
| V12 | `camfeed_pairings` liveness | `select id, role, used_at, last_seen_at, generation from camfeed_pairings where created_by = :artist order by created_at;` — `last_seen_at` proves the follow-loop poll ran |
| V13 | Room actually closed | `select room_name, actual_ended_at, ended_by from shows where id = :show;` cross-checked against `room_events` `room_finished` (`and env = 'production'`) — the gap is the cost |
| V14 | **Stray env values** | `select env, count(*) from viewer_sessions group by 1;` repeated per table, or the union in `docs/pilot2_env_stamp.sql` V3. Expect only `production` / `preview` / `development`. Anything else means a write path built the string by hand instead of calling `rowEnv()`, and its rows are being silently excluded |

Pre-flight versions of V1, V4, V5, V6 and V10 run as a **two-minute canary before
doors open on the 20th**: one reaction, one comment, one cut, one prompt, then the
four queries. If any returns zero, there is time to fix it.

---

## 14. Schedule

### How each day ships

The original schedule gated every day on a device test but contained exactly **one
deploy, on Friday**. None of those device tests were reachable as written: there was
no URL to test against until day seven, and the Friday merge would have been the
largest change of the week landing the day before the dress rehearsal.

Every day now runs the same four steps:

1. **Branch** off `main` — `pilot2-item<n>`.
2. **Push.** Vercel builds a preview at
   `loud-app-git-<branch>-korey-alashe.vercel.app`.
3. **Device test the preview URL.** This is the gate. Nothing merges without it.
4. **Merge to `main` the same day**, which deploys to production.

`main` therefore stays deployable and always equals "everything that has passed a
real-hardware test". Friday becomes a formality — freeze and verify — rather than a
merge.

Two standing rules this creates:

- **Preview deployments require a Vercel login** unless SSO protection is off for the
  project. A paired camera phone cannot sign in to Vercel mid-pairing, so this has to
  be settled before the first device test, not during one.
- **Device tests use their own show row, never the pilot's.** `env` separates the six
  stamped tables; `health_events`, `reaction_events` and `shot_commands` are keyed by
  room name and rely on this rule instead. See §13.

| Day | Work | Gate |
|---|---|---|
| **Fri 11 (done)** | All eight migrations written; `EGRESS_TEMPLATE_BASE_URL` investigated (§0.7) | Files in `docs/` |
| **Sat 12 (done)** | Migrations 01–08 run and verified. Conflict-target fix | Both unique indexes confirmed |
| **Sat 13 (done)** | **Item 1** built, **item 2** built | — |
| **Sun 14 (done)** | Item 1 device tested and **PASSED** on `20d1362` — suspended → downgraded (awayMs 20997) → resumed. Items 1 + 2 merged to `main`. **Run `pilot2_env_stamp.sql`** | Three events verified by query and on screen |
| **Sun 14** | **Item 3** (timings + `showOriginMs`) + **item 11d verify query** + `vercel.json` written but inert | Device test on preview → merge |
| **Mon 15** | **Item 4** (viewer sessions + beacon, no sampler) + **item 11f** (entry on the holding screen) | Device test, second viewer device. Confirm rows land as `env = 'preview'` → merge |
| **Tue 16** | **Item 8** (§4.3 first, then Layers A–C) | Device test: kill a tab, pull a cable, End Show. **Go/no-go on Layer B by evening** → merge |
| **Wed 17** | **Item 6, FIXED-CHOICE PROMPTS ONLY** — no free-form compose, no saved prompts, no pinning | Device test: push a prompt, answer from two devices → merge |
| **Thu 18** | **Item 5** (comments) IF Wednesday was clean. Otherwise slack | Device test → merge |
| **Fri 18 EOD** | Overwrite `EGRESS_TEMPLATE_BASE_URL`. Redeploy `main`, grep the served bundle, run `verify-write-paths.mjs`. **FREEZE** | Deploy verification. No merges |
| **Sat 19** | **Dress rehearsal** — full length, real hardware, two locations, paired camera, second viewer device, recording start to finish, **on production**. Then the whole §13 pack | **Pilot-ready gate** |
| **Sun 20** | Pre-show canary (§13). Pilot 2 | — |
| Mon 21 | §13 in full, written up. Every query filters `env = 'production'` | — |
| 22–26 | **Item 7**, **item 9**, item 6's compose/saved/pinning, faster stale detection (§1.5), `pilot2_09`, `pilot2_10` | — |
| Sun 27 | Third-party event | — |

### What was cut on Sun 14, and why

Item 1 took three days against one planned. Seven items in four days was not
recoverable, so three cuts were taken deliberately rather than discovered on Wednesday
night. **None of them changes what the audience sees on the 20th.**

- **Item 7 (moderator role) — dropped.** You own the show on the 20th, so the role has
  no user on pilot night. `pilot2_08_show_moderators.sql` is already migrated, so
  nothing is lost by not writing the code yet. This was flagged as the highest-risk day
  of the week. It also removes §0.8's sender validation from the critical path, since
  that only became a *requirement* because item 7 adds a second legitimate sender —
  `SHOT_COMMAND` still applies from any sender, and with one operator that stays
  theoretical. **Re-opens as the first job on the 22nd, and sender validation goes with
  it.** ~1.25 days.
- **Item 9 (webhook ingestion) — dropped.** `room_events` is analysis, not show
  behaviour. Item 4's beacon covers leave and the sweep covers the rest. Cost: no
  authoritative join/leave cross-check on the 21st, so §13 V8 does not run and
  `participant_joined ≈ distinct viewers` cannot be verified independently. ~0.5 days.
- **Item 6 — cut to fixed-choice prompts only.** Versus voting is a headline feature and
  both tables are already migrated. A fixed-options prompt is most of the value; the
  free-form compose typed live during a show is the expensive part. Cost: the operator
  picks from prepared options rather than typing a question on the night. ~0.75 days.

**Kept, non-negotiable:** item 3 (every offset in the product depends on it), item 4 +
11f (this *is* the pilot's evidence base), item 8 §4.3 + Layers A–C (a room that never
closes is a cost and a correctness problem on the night).

**Item 5 (comments) is the designated late cut.** Chat still works live without it; only
persistence is lost. Decided Wednesday evening, not Friday.

### The rule that came out of item 1

**Every item from here ships with a way to trigger its failure condition in seconds,
without hardware.** Item 1 cost eleven device tests and two days because its three
states were invisible on screen and only distinguishable by a query afterwards — and
because a hardware cycle could not even begin until LiveKit's ~8s eviction had run.

The `?stale=1` overlay and its `drop` button are the pattern: a live readout of the
state machine, and a control that forces the transition locally. Both are gated on a
query-string flag, so neither exists on a normal show load. **This is a gate on each
item, not a nice-to-have** — an item whose failure mode can only be reproduced by
holding a phone is an item that will cost a day.


### What came out, to pay for the two corrections

Corrections 2 and 3 add about a day and a half — the moderator table plus the
lifecycle capability plus sender validation (~0.75), and free-form compose over a
fixed list (~0.75). Six things come out to pay for it.

**Your two, both agreed:**

1. **Layer D cron.** Forced anyway — Pro is pending (answer 6), so this was never
   reliably available. Layers A–C plus you closing the room manually covers it.
2. **The presence sampler.** Agreed, and your reasoning is better than my
   ordering was: it records a number already on screen, while the webhook is the
   only source that survives our own bugs. It goes, the webhooks move up.

**Four more, mine:**

3. **`pilot2_09` show-UUID on `shot_commands` and `pilot2_10` SELECT policy**
   (items 11c, 11e) → the 21–26 September window. Both additive, neither affects
   either show night, and the 21st's analysis runs service-role so the SELECT policy
   is not needed to do it.
4. **The stale-session sweep** (item 4's third leave source). With
   `participant_left` promoted, the beacon and the webhook cover leave between them.
   The sweep only ever produced an upper bound labelled as one.
5. **Item 11f stays on the existing holding screen** — no new page, no new visual
   design. The countdown already exists at `LiveDemo.jsx:4675`.
6. **Soft-delete a comment** ships only if Wednesday runs clean. Pinning ships
   regardless, because prompts need it. With 30–50 known-ish viewers and you in the
   chair, deleting a comment is the least likely moderation action of the night.

**Revised cut order if I still fall behind**, first to cut:

1. Composed (typed) prompts, keeping saved prompts — **the last thing I would cut in
   item 6**, and only if Thursday is lost outright
2. `reaction_events.viewer_id` attribution (the reactions still record; they just
   stay anonymous)
3. Comment persistence (item 5) — loses the 20th's chat log permanently, so this is
   a genuinely bad cut and sits here rather than higher only because it is cheap to
   restore before the 27th

**Never cut:** items 1, 2, 3, 8 layers A–C with §4.3, **item 9's
`participant_joined`/`participant_left`**, the recording verification, and §13.

### Honest fit assessment

After those six cuts this is still about nine to ten days of work in six and a half.
It fits only if nothing goes wrong, and the two places it is most likely to go wrong
are Tuesday (the `isMainPerformer` split touches the most load-bearing conditional in
a 4,900-line file) and Wednesday (Layer B changes how every device leaves a room).

If Tuesday overruns, item 5 moves to Thursday and the soft-delete goes. If Wednesday
overruns, **I stop and tell you on Wednesday evening**, not on Friday — there is a
real version of this week where Layer B is not ready and the honest answer is to ship
Layer A alone and close the room by hand on the night, which you have already said
you can do.

### The rule

Nothing is pilot-ready without Saturday's dress rehearsal producing rows I have
actually queried. A green local commit is not shipped. A deployed commit whose tables
are empty is not instrumented.

---

## 15. Decisions — answered, and what each one changed

| # | Answer | What it changed |
|---|---|---|
| 1 | You own the show on the 20th, **but build the table anyway** | `pilot2_08_show_moderators.sql` is in. §7 rewritten. Sender validation promoted from tidiness to requirement |
| 2 | Four prompts, two verbatim from July, order as given | §6 rewritten around free-form compose; the two verbatim strings get a do-not-edit comment in the client |
| 3 | Indefinite retention, stated plainly, deletion on request | `deleted_at` on `show_comments`; notice copy below |
| 4 | Lifecycle sits with the operator, but **follows the role** | `can_control_lifecycle` is a column defaulting to false, not a hardcoded identity |
| 5 | Name required, 18+ required, email optional and labelled | Entry form spec below |
| 6 | Pro pending — do not rely on Layer D or `lhr1` | Layer D cut. `vercel.json` still written Friday with `regions: ["lhr1"]`, but **treated as inert until you confirm** |

### Entry form, exactly (item 11f)

On the existing holding screen, above the countdown:

- **Name** — required. Free text, this is what appears next to their comments.
- **Email** — optional, labelled *"Optional — if you'd like to hear about future
  shows."* Your point stands: a bare email field on a join screen suppresses entry
  and reads as harvesting, and the label is the difference.
- **18+** — required checkbox, blocking. Writes `age_confirmed_at`.
- **Data notice** — short, above the button, not behind a link:

  > We keep your messages and answers so we can improve the platform. Your name and
  > email are only used for this show and, if you opt in, to tell you about future
  > ones. Ask us any time and we'll delete them.

Copy comes to you for sign-off before it ships; this is the draft, not the final.
