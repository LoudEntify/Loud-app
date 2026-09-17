# Saturday rehearsal — the run sheet

**Sat 19 September. Full dress, real hardware, two locations.**
This is the pilot-ready gate. Run it in order; every step says what proves it.

Queries live in `docs/pilot2_item3_verification.sql`,
`pilot2_item4_verification.sql`, `pilot2_item5_item6_verification.sql` and
`pilot2_item1_verification.sql`. **Every one filters `env = 'production'`** —
the rehearsal is on production, so its rows are production rows. Note the time
you start and the time you finish so you can separate rehearsal rows from
Sunday's on the 21st.

> ⚠️ **The rehearsal writes to the same tables as the pilot.** Record the
> rehearsal's `room_name` at step 3 and exclude it on the 21st. There is no
> flag that distinguishes a rehearsal from a show.

---

## 0 · Before anyone arrives (30 min)

| | Check | Proves |
|---|---|---|
| 0.1 | `curl https://loudentify.app/api/build-info` | production is the sha you expect |
| 0.2 | `curl -sI https://loudentify.app/preshow-loop.mp3` → 200, `audio/mpeg` | the pre-show track is live |
| 0.3 | `curl -sI https://loudentify.app/logo/loudentify-on-dark.png` → 200 | the mark is live |
| 0.4 | Run **S4** and **S4b** from `pilot2_sunday_show.sql` | both artists bound, all check columns true, operator unbound |
| 0.5 | Run **S5** | exactly one upcoming show |

**0.6 — `EGRESS_TEMPLATE_BASE_URL`.** This must already be `https://loudentify.app`
and a deploy must have happened since you changed it. If the recording comes
back as a picture of a login page, this is why. There is no way to read the
value back — it is Sensitive — so the recording at step 9 is the only proof.

---

## 1 · Both artists sign in (10 min, remote)

Each artist, on their own device, in their own location:

1. `loudentify.app` → **Join as artist** → log in.
2. Confirm they land on their profile, and that there is **no Schedule Show
   panel** (scheduling is hidden for both pilots).
3. Go to **Kit Check**.

**Check:** Kit Check names Sunday's show and shows **GO LIVE NOW disabled**,
reading *"Unlocks at 17:00, in Xh Ym — 30 minutes before your show."*

**If a show does not appear:** their binding is wrong. Re-run S4 — `role` or
`display_name` reading NULL means the account signed in for the first time
only just now, so run S4 again before concluding anything.

---

## 2 · Pair the cameras (20 min)

Artistwon's rig is the one that matters — it is the heaviest. Pair each phone
from Kit Check, scan the code, confirm the viewfinder.

**Check after each:** the phone shows the Loudentify mark at 36px and a live
preview; Kit Check lists it.

**Then the item 2 check, which has never been exercised on a real rig:** mint
a code and *don't* redeem it. Wait past its 10-minute expiry, then mint six
more. You should never be blocked — the cap counts live cameras, not every
code ever minted. If you get *"You already have 6 cameras paired"*, stop and
tell me.

---

## 3 · Go live (5 min)

Artistwon presses **GO LIVE NOW** in Kit Check. Cameras follow automatically.

**Record the `room_name`** from the URL or from S5. You need it for every
query below and to exclude the rehearsal on the 21st.

**Check immediately, on the operator laptop, at `/live?show=…&stale=1`:**

```
origin actual · T+00:0x
```

**Green `origin actual` is item 3 working.** Amber `origin slated` means
`actual_started_at` did not land, and the line names which of three faults it
is. **This is the single highest-value check in the rehearsal** — every offset
in the pilot is measured from it, and the failure is silent.

---

## 4 · ⚠️ The load test — laptop as camera + console + monitor

**This configuration has never been measured.** The one CPU capture in this
repo was a moto g35 with a 99MB audio buffer, and its verdict was withdrawn
because the analyser had bugs. There is no data on a laptop publishing camera
while running the director console.

Set up exactly as Sunday: laptop publishing Artistwon's main camera, director
console open, second monitor showing playback, **both on headphones**, monitor
output muted at OS level as a backstop.

Run for **at least 15 minutes** with real performance — movement, cuts, b-roll
if you are using it.

**Watch for:**

- Any visible stutter on the stream as seen by a viewer device, not on the
  laptop itself.
- Fan noise picked up by the mic.
- The picture going soft — that is the encoder dropping resolution.

**Then prove it from the data** rather than from impressions:

```sql
select
  h.client_ts,
  h.detail->>'reason'       as limitation,
  (h.detail->>'fps')::numeric      as fps,
  (h.detail->>'sourceFps')::numeric as source_fps,
  h.detail->>'width'        as width,
  h.detail->>'height'       as height,
  (h.detail->>'avgQp')::numeric    as qp
from health_events h
join shows s on s.room_name = h.show_id
where s.room_name = 'REHEARSAL_ROOM_NAME'
  and h.event_type in ('pub_quality_limitation', 'pub_stats')
order by h.client_ts;
```

**`limitation = 'cpu'` is the encoder's own verdict, not a guess.** Any run of
those rows means the laptop cannot do all three jobs at once.

**If it says cpu:** the cheapest fix is to move the main camera off the laptop
— pair a phone as Artistwon's main and let the laptop do console and monitor
only. That is a setup change, not a code change, and it is why this test
happens on Saturday and not Sunday.

Also run a plain count, because zero rows means the instrument is not
recording rather than that all is well:

```sql
select count(*) from health_events h join shows s on s.room_name = h.show_id
 where s.room_name = 'REHEARSAL_ROOM_NAME' and h.event_type like 'pub_%';
```

---

## 5 · The audience (15 min)

Get **at least three real viewers** on real devices, ideally two on cellular.
They go to `loudentify.app` → **Join as viewer** → name, email, 18+ → countdown
→ carried in at showtime.

**Check:** nobody is asked for their name twice, and the pre-show track plays
muted with a visible **Turn the music on** control.

Then, from the operator laptop:

```sql
-- item 4: people, not connections
select count(*) as connections,
       count(distinct viewer_id) filter (where viewer_id not like 'nostore-%') as unique_viewers,
       count(display_name) as gave_a_name, count(email) as gave_an_email,
       count(age_confirmed_at) as confirmed_18
  from viewer_sessions v join shows s on s.id = v.show_id
 where s.room_name = 'REHEARSAL_ROOM_NAME' and v.env = 'production';
```

**Have one viewer reload twice.** Expect `connections` to rise and
`unique_viewers` to stay the same. That is the whole §0.4 correction and the
number the business case rests on.

---

## 6 · Item 1 — kill a camera (10 min)

With a crop applied to a paired camfeed, on the operator laptop at `?stale=1`:

1. **Kill that phone's wifi** (not a screen lock — a lock freezes capture while
   the publication stays live, which is a different failure).
2. Watch: crop drops to neutral, picture moves to another camera, overlay reads
   `SUSPENDED`.
3. Bring wifi back **within 20s** → returns to the camfeed with its crop,
   `RESUMED`.
4. Kill it again and **leave it past 20s** → `DOWNGRADED`, slot sits on wide.

```sql
select h.client_ts, h.event_type,
       h.detail->>'slot' as slot, h.detail->>'fallback' as fallback,
       h.detail->>'awayMs' as away_ms, h.detail->>'wasDowngraded' as was_downgraded
  from health_events h join shows s on s.room_name = h.show_id
 where s.room_name = 'REHEARSAL_ROOM_NAME'
   and h.event_type like 'stale_command_%'
 order by h.client_ts;
```

**Expect all three event types.** `awayMs` must not be null on the resume.

---

## 7 · Questions and the vote (20 min)

Push **two or three** questions from the operator panel. Answer from every
viewer device. Change one answer.

Then the vote: **OPEN VOTING** → vote from every device → change one →
**CLOSE VOTING**.

**Check on a viewer:** two buttons with the stage names; after tapping, the
choice is ticked and it reads *"Your vote is in — you can change it until
voting closes."* **No count anywhere.** After you close, the card goes.

**Check on the operator:** the tally moves, and after closing it names who is
leading, or TIED.

```sql
-- one answer per viewer: EXPECT ZERO ROWS
select r.prompt_id, r.viewer_id, count(*)
  from prompt_responses r join shows s on s.id = r.show_id
 where s.room_name = 'REHEARSAL_ROOM_NAME' and r.viewer_id is not null
 group by 1,2 having count(*) > 1;

-- the vote, and the questions
select r.prompt_body, r.choice_label, count(*) as votes
  from prompt_responses r join shows s on s.id = r.show_id
 where s.room_name = 'REHEARSAL_ROOM_NAME' and r.env = 'production'
   and r.choice_label is not null
 group by 1,2 order by 1, votes desc;
```

**Then prove the 410.** With voting closed, have a viewer who has not voted
reload and try — they should not be offered the card at all. If you want the
410 directly, from the operator's browser console:

```js
fetch('/api/prompt-responses', {method:'POST',headers:{'Content-Type':'application/json'},
  body: JSON.stringify({promptId:'THE_VOTE_PROMPT_ID', viewerId:'probe', choiceIndex:0})})
  .then(r => console.log('expect 410, got', r.status));
```

**Also run V5** from `pilot2_item5_item6_verification.sql` — it asserts the four
July-survey strings byte-exact. A drift there voids the comparison silently.

---

## 8 · Comments (5 min)

Every device sends a comment.

```sql
select count(*) as comments, count(distinct viewer_id) as devices,
       min(offset_ms)/1000 as first_at_s, max(offset_ms)/1000 as last_at_s
  from show_comments c join shows s on s.id = c.show_id
 where s.room_name = 'REHEARSAL_ROOM_NAME' and c.env = 'production';
```

**Each client persists only its own**, so a gap between this and what you saw
on screen is a failed write on someone else's device, not a missing message.

---

## 9 · End the show (10 min)

Artistwon presses **End Show**.

**Check, in this order:**

1. Every paired phone's **camera light goes out**.
2. Viewers see the ended card.
3. The recording exists.

```sql
select actual_started_at, actual_ended_at, ended_by,
       extract(epoch from (actual_ended_at - actual_started_at))/60 as real_minutes
  from shows where room_name = 'REHEARSAL_ROOM_NAME';
-- EXPECT ended_by = 'artist' and real_minutes matching the clock

select id, storage_path, bytes, duration_seconds, verified
  from recordings r join shows s on s.id = r.show_id
 where s.room_name = 'REHEARSAL_ROOM_NAME';
-- EXPECT a row with bytes > 0. Then OPEN IT.
```

**Watch the first ten seconds of the recording.** If it is a login page,
`EGRESS_TEMPLATE_BASE_URL` is wrong and step 0.6 is why. This is the only
proof that exists.

4. Viewer sessions closed:

```sql
select coalesce(left_source,'(still open)') as src, count(*),
       round(avg(extract(epoch from (left_at - joined_at))/60)::numeric,1) as avg_min
  from viewer_sessions v join shows s on s.id = v.show_id
 where s.room_name = 'REHEARSAL_ROOM_NAME' and v.env = 'production'
 group by 1;
```

Expect `beacon` rows, and `sweep` rows for anything the beacon missed. Many
`(still open)` means neither fired — tell me.

---

## 10 · The wifi-blip check (5 min)

**The one that was broken before this week and is the easiest to regress.**

With a phone paired and live, blip its wifi for two seconds. **The camera light
must stay on and it must recover on its own.** If the light goes out on a blip,
§4.3's disconnect classification has regressed and a transient wobble will kill
a camera mid-show on Sunday.

---

## After: the go/no-go

Green means every query above returned rows and `limitation = 'cpu'` did not
appear in step 4.

**If step 4 shows cpu:** move Artistwon's main camera to a paired phone. Setup
change, no code, and you have a day.

**If anything else fails**, tell me what and I will fix that named thing. Past
that, we are frozen.
