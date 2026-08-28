# DEVICE TEST — overnight build #2

**One script, every phase, ordered so you reset as little as possible.**

Read the ordering note before you start: it is the reason this is one script
and not five.

---

## What you are testing

| | |
|---|---|
| **Branch** | `feature/overnight-round-2` (off `feature/overnight-product-round`) |
| **Preview** | `https://loud-mlpz8y3ql-korey-alashe.vercel.app` |
| **Deployed from** | `bd03289` — the last commit that changes code. |
| **Bypass** | Already granted on this project. `vercel curl <url>` uses it automatically for GETs; for the one `POST` below you need the secret itself — Vercel dashboard → Project → Settings → Deployment Protection → **Protection Bypass for Automation**. Deliberately not written into this file. |
| **Merged to main** | **No.** Nothing merges until you have tested, refined and affirmed. |
| **Production deployed** | **No.** Preview only, every time. |

### Commits, one per phase

| Phase | Commit | What landed |
|---|---|---|
| 0 | `ee00c36` | Multi-camera Kit Check, the rehearsal→show handoff, the leave crash |
| 1 | `50d55d6` | First-run onboarding both roles, real follow button |
| 2 | `d482c17` | Request my data, close my account, log out everywhere |
| 3 | `3517b8a` | Token economy, provider-agnostic checkout, signed finance webhook |
| 4 | `fe978f5` | Egress verification, reactions, share cards, resume ladder, Discover |
| 4e | `0ecdf8f` | **B-roll live playback** — source discrimination at the root, then the clip path |
| 4e+ | `76ac18d` | B-roll follow-up — frame watchdog, reselect, cue-sheet clips, rehearsal preview |
| QA | `740dc0c` | BUG 1 b-roll upload · BUG 2 device release on End Show · BUG 3 one avatar source |
| QA | `a9e0345` | RULING 1 show duration + window · RULING 2 named cue sheets |
| QA | `d51b16c` | QA script sections; fixed an onboarding link pointing at Recorded Shows |
| FIX | `68cb676` | **Artist-console crash** — a re-export is not a local binding; added `check:undef` |
| FIX | `4a56e7d` | The authenticated smoke check (`npm run smoke`) + a signup error that rendered as `{}` |
| FIX | `0709c8f` | **Countdown to live** (Finding 1) + **GO LIVE NOW in Kit Check** (Finding 2) |

### Bypass-loaded confirmation, per phase

Every one of these was loaded on the deployed preview through the Vercel
protection bypass and returned what is stated. This is the "it is really
shipped, not just committed" line for each phase.

| Phase | Loaded via bypass | Result |
|---|---|---|
| **0** | `/kit-check`, `/cam/pair`, `/live` | HTTP 200 each. Served bundle grepped: `/kit-check` contains "Your cameras" and "OR ENTER THIS CODE"; `/cam/pair` contains `camfeed/session`. |
| **0** | `POST /api/camfeed/session` | `200 {"supported":false,"pollMs":4000}` — the pre-migration graceful path, working. |
| **1** | `/welcome` | HTTP 200. Bundle contains "SKIP THIS STEP", "DO THIS LATER", "Follow a few artists". |
| **1** | `/discover`, `/artist/{uuid}` | HTTP 200 each. |
| **2** | `/settings` | HTTP 200. Bundle contains "REQUEST MY DATA", "LOG OUT ON ALL DEVICES", `account/close`. |
| **2** | `POST /api/account/export` | `401 {"error":"Missing Authorization header"}` — owner-only gate live. |
| **2** | `POST /api/account/close` | `401` unauthenticated; `GET` also `401`. |
| **3** | `/wallet`, `/wallet/checkout` | HTTP 200 each. |
| **3** | `POST /api/wallet/checkout`, `/spend`, `/cashout`, `/dev-event` | `401` each — every one gated. |
| **3** | `POST /api/wallet/webhook` (unsigned) | `400 {"error":"Signature verification failed"}` — **signature checked before any write**. |
| **4** | `POST /api/egress/webhook` (unsigned) | `400 {"error":"Signature verification failed"}`. |
| **4** | `GET /api/egress/verify` | `405` — route deployed, POST-only. |
| **4** | `POST /api/reactions` | `500 {"ok":false,"error":"Insert failed"}` **pre-migration** — which the client ignores by design, so reactions still work. |
| **4e** | `/live`, `/egress` | HTTP 200 each. Served `/live` bundle grepped: contains `B-Roll Clip`, `broll`, `captureStream`, `maintain-resolution`, `targetSourceKey`. |
| **4e** | `lib/trackSources.js` unit-exercised in node against the real module | 14/14 pass, including the exact bug case: two tracks sharing one participant identity, where a clip-targeted command matches the clip and **does not** match the camera (and the reverse). Legacy commands with no source key still match on identity alone. |
| **4e+** | `lib/cueSheetValidation.js` exercised in node | 5/5 — a `broll` cue with and without a `clip_id` both validate; `clip_id` on a camera cue is rejected; an empty one is rejected; plain camera cues are unaffected. |
| **4e+** | `/kit-check` bundle | Contains `B-ROLL — CHECK A CLIP`, `B-ROLL CLIP`, `nothing leaves this room` — the rehearsal preview shipped. |
| **QA** | `/`, `/live`, `/kit-check`, `/cam`, `/cam/pair`, `/discover`, `/shows`, `/settings`, `/wallet`, `/welcome`, `/egress`, `/artist/{uuid}` | HTTP 200 each. |
| **QA** | `POST /api/broll/upload-url`, `/api/broll/register` | `401` — both gated. |
| **QA** | `GET /api/broll/upload` (the route that hung) | ⚠️ **CORRECTED 2026-08-28 — this said `404` and it was wrong.** The route returns **`405`**: `740dc0c` deleted it, then `68cb676` (the artist-console crash fix) accidentally re-added it. It is gated (`POST` → 401), so it is not a hole — but it is the original body-buffering path, live again. See `docs/SECURITY_AUDIT_2026-08-28.md` finding 5. |
| **QA** | `PATCH` / `DELETE` / `GET ?all=1` on `/api/cue-sheets` | `401` each — rename, delete and library all deployed and gated. |
| **QA** | Artist-console chunk, fetched from the deployment | Contains `HOW LONG` (duration picker), `MISSED` (expired badge), `grace`, `CUE SHEETS`, `broll/upload-url`, `broll/register`, `Saving to your library`. |
| **QA** | `/live` chunks | Contain `show-remaining`, `OVER TIME`, `Saving overwrites`, `local_devices_released`. |
| **QA** | `/cam` and `/cam/pair` chunks | Both contain `SHOW_ENDED` and the ended screen — the two pages that previously had no end-of-show handling at all. |
| **QA** | `lib/showWindow.js` exercised in node | 14/14 — duration default and clamp, `ends_at` override, window open/shut either side of the grace, expired classification, remaining-time. |
| all | `/`, `/shows`, `/notifications` | HTTP 200 each. |

### ✅ Authenticated routes, loaded signed-in and confirmed rendered

`npm run smoke`, against this deployment, signed in as the artist test
account — **10 of 10 rendered clean, 7 of them gated**:

`/settings` · `/wallet` · `/welcome` · `/kit-check` · `/live` ·
`/live?show={unknown}` · `/artist/{own id}` — plus the public `/discover`,
`/notifications`, `/shows`.

Zero page errors, zero console errors, and each one had to contain a string
only its real rendered surface produces.

### ⚠️ What "bypass-loaded, 200 OK" does and does not prove

Everything above is an HTTP status behind Vercel's deployment protection. That
gets past **Vercel's** wall and stops there — it never gets past
**Loudentify's** login. An authenticated page like `/artist/{id}` returns
`200` as the *login-redirect shell*, so those rows went green on surfaces that
were dead.

Three crashes shipped that way (Leave, a TDZ ReferenceError, and
`windowClosesAt is not defined`) — every one on an authenticated surface,
which is exactly the set that check could not reach.

**`npm run smoke` now closes that** — it signs in through the real login form
in a headless browser and requires each gated route to actually render, not
merely respond. See `docs/SMOKE_TEST.md`; it needs a one-time test account.

From here on, a definition-of-done names **which authenticated routes were
loaded signed-in and confirmed rendered**.

**What none of it proves**, stated plainly: no live show was run, no phone was
paired, no payment was simulated end to end. Everything in the sittings below
is the part I could not do.

---

## Ordering note — why this sequence

Three constraints shape it:

1. **Migrations first.** Almost everything is in a degraded mode until they
   run, and testing the degraded mode and then the real mode doubles the work.
2. **Account closure last, on a throwaway account.** It disables login. Do it
   at the end of the *viewer* sitting, on an account you do not need again.
3. **One live show serves three phases.** Kit Check pairing (0a), the camera
   handoff (0b), reactions (4b), the resume ladder (4f) and the leave fix (0c)
   all happen in a single show. Do not schedule five.

**Total: about 75 minutes**, of which ~15 is the database and ~25 is the show.

**You will need:** your laptop, one phone (two is better), and a second browser
profile or an incognito window to be the viewer.

---

# SITTING 0 · The database (~15 min, laptop only)

Open `docs/MORNING_MIGRATIONS.md` and work through it. It is paste-verify-
paste-verify with the expected output beside every block.

**Do not skip these three:**

- **06 · V5** — proves the ledger is append-only even for the SQL editor. If
  the `UPDATE` succeeds, stop and tell me; nothing else in the run matters as
  much.
- **08 · V3** — proves a duplicate webhook event is rejected. If both inserts
  succeed, a redelivered payment will double-credit somebody.
- **09 · V3** — proves `cashout_requests` has zero INSERT policies. One there
  defeats the KYC gate entirely.

Finish with the whole-database sweep at the bottom of that file. Every table
must read `rls_on = t`, and exactly four must read `policies = 0`.

**Then redeploy the preview** (or wait ~5 minutes). The server caches its
schema-capability probe per process, deliberately, so the app will keep saying
"needs a pending database update" until the functions cycle.

> ☐ All 11 files run, all verifications matched
> ☐ Sweep clean: every table RLS on, four zero-policy
> ☐ Preview redeployed

---

# SITTING 1 · Viewer, from nothing (~15 min)

Use a second browser profile or an incognito window. This account gets closed
at the end, so use a throwaway email.

### 1.1 Sign up as a fan → **you should land on `/welcome`, not Discover**
`/` → SIGN UP → I'M A FAN → fill everything → CREATE ACCOUNT.

> ☐ Lands on `/welcome` (Phase 1 — signup routes to onboarding, login does not)

### 1.2 Onboarding, and specifically that you can escape it
- Step 1 is genres. **Check the sidebar is right there and works** — this is a
  route, not a gate.
- Press **SKIP THIS STEP** on genres. It should move on without complaint.
- Step 2 offers artists to follow. **Follow two.** They should turn to
  FOLLOWING instantly.
- **Now close the tab entirely** and go back to `/welcome`.

> ☐ It resumes on step 3, not step 1 (skipped counts as answered)
> ☐ The FOLLOW buttons worked — if they say "switches on once the migration is
>   applied", sitting 0 did not finish

### 1.3 Finish, and check the nudge behaves
Complete step 3 → lands on `/discover`.

> ☐ No "finish setup" bar anywhere (there is nothing left to finish)

Now try the opposite: sign up a **second** throwaway fan, skip nothing, and
**leave via DO THIS LATER on step 1**.

> ☐ A slim teal bar appears above Discover offering FINISH SETUP
> ☐ Pressing NOT NOW dismisses it for the session, and it does not come back on
>   navigation
> ☐ It never appears over a live show

### 1.3b ★ Profile photo, everywhere ★ *(QA batch, BUG 3)*

On any account, go to `/settings` and **upload a photo**.

> ☐ It appears in Settings
> ☐ Now go to `/profile` — **the header shows the photo, not an initial**.
>   This was the bug: the header had no code path that could ever show one.
> ☐ On `/discover`, your artist card shows it too
> ☐ In onboarding's follow step, suggested artists with photos show them

### 1.4 Discover on real data (Phase 4g)
Back on the first fan account, on `/discover`:

> ☐ **COMING UP** section exists, listing scheduled shows with dates
> ☐ The two artists you followed carry a **FOLLOWING** chip and sit at the top
>   of the artist list
> ☐ Search still filters
> ☐ Tapping a COMING UP card lands on a countdown holding screen — **not** an
>   error, and **not** a connection

**Keep this account signed in.** You are the viewer for the show.

---

# SITTING 2 · Artist setup and the rig (~20 min, laptop + phone)

On your **main browser**, signed in as your artist account.

### 2.1 Schedule a show for ~35 minutes from now
**`/profile`** → your artist console → *Schedule a show*. (Not `/shows` — that
is Recorded Shows, the replay list.)

*(QA batch, RULING 1)* There is a **HOW LONG** row now:

> ☐ Options are 30m / 1h / 1h 30m / 2h / 3h, with **1h** selected by default
> ☐ The line underneath states your window: start time → duration → plus 15
>   minutes' grace

**Pick 30m for this test** — it makes the window-close checks in Sitting 3
take minutes rather than hours.

> ☐ The show appears in the list showing **30MIN** in its meta line **35 minutes** matters: the broadcast window opens at
T−30, and you want to be inside Kit Check before it does.

> ☐ Show created, appears on your profile

### 2.1b ★ B-ROLL UPLOAD — the retest bar ★ *(QA batch, BUG 1)*

On your artist console (`/profile`), find the **B-ROLL** section.

**A ~50MB clip:**

> ☐ Pressing UPLOAD CLIP shows a **percentage on the button and a moving
>   progress bar** — not "WORKING…"
> ☐ The bar advances steadily and the label reads "Uploading 50MB…"
> ☐ Near the end it changes to **"Saving to your library…"** — the bar reaches
>   100 only after the clip is registered, not merely uploaded
> ☐ The clip **appears in the library** with its real size
> ☐ **It does not hang.** The old failure was an indefinite Pending with no
>   error, ever.

**A file over 100MB:**

> ☐ Refused **immediately**, before any transfer, with a message naming the
>   actual size and the limit
> ☐ Nothing appears in the library

**Cancel mid-upload:**

> ☐ A CANCEL button is there during the upload
> ☐ Pressing it stops the transfer, shows no error (you did that on purpose),
>   and adds nothing to the library

**In the network tab**, the big request should now go to
`…supabase.co/storage/v1/object/upload/sign/…`, **not** to `/api/broll/upload`.
That is the whole fix: the bytes no longer pass through a serverless function.
⚠️ **`/api/broll/upload` is NOT gone** — corrected 2026-08-28. It was deleted in
`740dc0c` and accidentally restored by `68cb676`; a GET returns `405`, not `404`.
The bytes still go to the signed Supabase URL, so the fix itself holds and this
step passes — but the dead route is back on disk and queued for deletion
(`docs/SECURITY_AUDIT_2026-08-28.md`, finding 5).

### 2.2 Kit Check, and the thing that could not be done before
Open `/kit-check`.

> ☐ Badge reads **NOT CONNECTED — NOTHING IS BEING SENT**
> ☐ "Your cameras" panel offers **three** buttons: + WIDE, + CLOSE, + SIDE
>   *(If it offers only one and says multi-camera needs a migration, sitting 0
>   did not finish or the preview has not cycled.)*

Press **+ WIDE**.

> ☐ Badge flips to **REHEARSAL ROOM OPEN — CONNECTED** (it must be truthful the
>   moment it connects)
> ☐ A card appears with a **QR code**, a **six-character code**, a **clickable
>   link** and a **COPY LINK** button — all three affordances, one credential

**On the phone: scan the QR.** Do not type the code.

> ☐ The phone pairs **automatically** — no PAIR CAMERA tap needed
> ☐ It says "the WIDE angle" and "You don't need to do anything when the show
>   starts"
> ☐ Back on the laptop, the WIDE card flips **WAITING → LIVE**
> ☐ The phone's picture appears in the composed view

**Now the multi-camera test.** Press **+ CLOSE** and pair a second device — a
second phone, a tablet, or just another browser profile on the same laptop
(a webcam is fine; the point is that a *second* pairing exists at all).

> ☐ Both cameras are listed, both LIVE
> ☐ The composed view shows **two tiles**, labelled WIDE and CLOSE
> ☐ **This is the thing that was impossible before tonight.** Pairing a second
>   camera used to replace the first.

Press **REMOVE** on the CLOSE card.

> ☐ The card disappears; the phone shows "This camera was removed"

Re-pair it (+ CLOSE again, scan again) — you want two cameras going into the
show.

### 2.2b B-roll in rehearsal — check the clip before anyone is watching

**Only if you have a clip uploaded and are on Chrome/Edge on a computer.**

Still in Kit Check with the rehearsal room open (you paired a camera in 2.2,
so it is):

> ☐ Under the composed view there is a **B-ROLL — CHECK A CLIP** row with a
>   button per clip
> ☐ Tap one: it appears as **another tile**, labelled **B-ROLL CLIP** in orange
> ☐ It is the right clip, the right way up, and plays
> ☐ **No sound from the clip** — same policy as in a show
> ☐ The line underneath says *"Rehearsal only — nothing leaves this room."*
> ☐ Tap it again (or let it end): the tile disappears cleanly
> ☐ Press **END REHEARSAL** while a clip is playing — it stops, and no track
>   is left behind

This is Kit Check doing its actual job: a clip that turns out to be sideways,
silent or the wrong file is exactly the thing to find here rather than
mid-song.

### 2.3 Reload the tab
> ☐ Your paired cameras are **still listed** (a reload is not a change of mind)

### 2.4 ★ Wait for the countdown ★ *(re-test — Finding 1)*
Stay in Kit Check. At **T−60 seconds** a full-screen countdown appears.

> ☐ It appears **at all** — it did not last round: `nextUpcomingShow` threw
>   inside an async effect, so `upcoming` stayed null and every condition was
>   silently false
> ☐ It says **YOU'RE ON IN** and counts to your *showtime* — not to the window
>   opening half an hour ago
> ☐ You get the whole window in Kit Check, not yanked out at T−30
> ☐ At zero you land on the stage **with your paired cameras carried over**

**And the case that never worked**: with Kit Check ALREADY OPEN, schedule a
show in another tab for ~2 minutes out.

> ☐ Within ~20 seconds Kit Check picks it up ("Next show: …") without a reload
> ☐ The countdown then fires normally

### 2.4b ★ GO LIVE NOW ★ *(Finding 2)*

> ☐ With a show scheduled but the window **not** open, the red **GO LIVE NOW**
>   button is visible but **disabled**, and says when it opens
> ☐ Inside the window it enables
> ☐ Pressing it takes you to the stage immediately — **and your paired cameras
>   come across exactly as they do at showtime** (watch the phones: PAIRED →
>   LIVE within a few seconds, untouched)
> ☐ Your audio deck, cue sheet and b-roll are all there on the live page
> ☐ Go back to Kit Check and press it again after the automatic hand-over has
>   already fired — it must be a **no-op**, not a second start

---

# SITTING 3 · The show (~20 min) — the heart of it

At zero you are pushed to `/live?show=…`.

### 3.1 ★ THE CAMERAS FOLLOW YOU ★ (Phase 0b — the headline)
**Do not touch the phones.** Watch them.

> ☐ Within ~4 seconds each phone's header changes from **PAIRED — REHEARSAL
>   CAMERA** to **LIVE — SHOW CAMERA**
> ☐ A line appears: "The show started — this camera moved across with it."
> ☐ On the laptop, the director console lists **WIDE** and **CLOSE** as
>   available shots
> ☐ Cutting to each one shows the right camera

**If a phone stays on "REHEARSAL CAMERA":** that is the failure to report.
Check `docs/MORNING_MIGRATIONS.md` step 01 verification V1 — `target_room` and
`generation` must exist.

### 3.2 Go live and bring the viewer in
Tap GO LIVE. On the **viewer profile**, open the show from Discover.

> ☐ Viewer sees the performance

### 3.3 ★ Reactions ★ (Phase 4b / PRD row 54)
**On the viewer device**, tap the emoji bar at the bottom right of the stage.

> ☐ The emoji floats up and fades **on the viewer's own screen**
> ☐ **And on the artist's screen** — this is the whole feature
> ☐ Tapping fast is rate-limited (~7/sec max), not a stream
> ☐ Your own reactions look identical to everyone else's
> ☐ Nothing is charged (they are free; the price label is absent on purpose)
> ☐ A reaction floating over a button does **not** eat a click meant for it

### 3.4 Comments with replies and quotes (rows 24/25/56/57)
On the viewer, long-press a comment → REPLY, then long-press another → QUOTE.

> ☐ Both render with their indicator on **both** screens
> ☐ *(Known and expected: they are ephemeral — a device joining later sees
>   none of the thread.)*

### 3.5 ★ The resume ladder ★ (Phase 4f)
On the **viewer device**, turn wifi off for ~15 seconds, then back on.

> ☐ A pill appears at the top: **Reconnecting…** with **no button** at first
> ☐ After ~6 seconds it becomes **Still trying to reconnect…** with **RESUME**
> ☐ Reconnecting on its own clears it with no interaction

Now the performer case. On a **paired phone**, kill wifi for 30 seconds.

> ☐ It comes back on its own, into the **show** room, still the same camera

And the hard one — on the **artist laptop**, reload the page mid-show.

> ☐ You are put straight back on your slot
> ☐ The banner says **"You're back on slot A — nothing was lost."**
> ☐ **You are never asked for a password.** That is the rule this exists for.

### 3.6 ★ The leave crash ★ (Phase 0c)
**On the viewer device**, press **Leave**.

> ☐ **No white screen. No client-side exception.** (This was a hooks-order
>   crash: an early return above three hooks.)
> ☐ A card says "You left the show", then it routes to **`/discover`**

Rejoin as the viewer. Then, on the **artist laptop**, press **Leave**.

> ☐ No crash
> ☐ Routes to **`/artist/{your id}`** — your console, not Discover
> ☐ Camera light goes out

Go back in and **END SHOW** properly.

### 3.6b ★ B-ROLL CLIP, live into the broadcast ★

**Do this before Leave (3.6) — it needs the show still running.**

**Prerequisites**, and check them first because two of them will otherwise
look like bugs:

> ☐ You are on **Chrome or Edge, on a computer**. Safari cannot hand a video
>   file to a live stream (`captureStream` is not implemented) and the panel
>   will say so instead of offering buttons. That message is the feature
>   working, not a failure.
> ☐ You have **at least one clip uploaded** — profile → B-roll library. Upload
>   one now if not; a short clip (10–30s) makes this test much faster than a
>   three-minute one.
> ☐ The **viewer device is watching** the show. Half of what is being tested
>   is what *they* see.

#### The panel

On the artist laptop, open the **SHOTS** panel.

> ☐ A **B-ROLL** section is listed under the shot groups, with a button per clip
> ☐ Under Static, a **B-Roll Clip** button exists and is **greyed out** — you
>   cannot cut to a clip that isn't playing yet
> ☐ The note reads *"Clip audio stays off — the show keeps your sound."*

#### ★ Cue it ★

Tap a clip.

> ☐ **The stage shows the clip — NOT your face.** This is the whole round. If
>   you see yourself here, stop and tell me: it means a parse site resolved a
>   b-roll track as a camera.
> ☐ **The viewer sees the clip too**, within a moment
> ☐ The clip button turns orange with a ■ (tap again to take it off)
> ☐ **B-Roll Clip** in Static is now enabled and shows as the active shot
> ☐ The note changes to *"On air. Cuts back to your camera when it ends."*

#### ★ Audio ★

> ☐ **You still hear the artist, not the clip.** The clip is silent on both
>   devices. If you hear clip audio, that is a policy break worth reporting
>   immediately.

#### ★ Let it end — the important part ★

Do nothing. Watch both screens as the clip finishes.

> ☐ At the end, the stage **cuts back to your camera on its own**
> ☐ **NO "CAMERA LOST" pill appears** — not on the artist screen, not on the
>   viewer's. Not for a frame.
> ☐ **No frozen frame** hanging after the clip
> ☐ The clip button goes back to grey with a ▶
> ☐ **B-Roll Clip** in Static is greyed out again

If a CAMERA LOST pill flashes even briefly, note **which device** and roughly
how long — that points at the cut/unpublish ordering rather than at the
discrimination fix.

#### Cutting away mid-clip

Cue the clip again, and while it is still playing tap **WIDE**.

> ☐ The stage cuts to the wide shot immediately
> ☐ The clip comes off air on its own (button returns to ▶) — it is not left
>   playing to nobody
> ☐ No CAMERA LOST

#### The automatic paths must NOT touch it

Cue a clip, and while it plays switch the mode control to **Auto**.

> ☐ Auto cuts between your **cameras** and never to the clip
> ☐ (Auto cutting away from the clip is correct and expected — it takes the
>   clip off air, same as a manual cut away)

And with **no clip playing**:

> ☐ Tapping the greyed-out **B-Roll Clip** does nothing — it must never cut to
>   your camera "instead"
> ☐ Start **Staccato** with a clip playing: the rapid cuts go between cameras
>   only, never into the clip

#### ★ The recording ★

This is checked in 3.7 below, but note it now so you know what to look for:

> ☐ When you review the recording, the b-roll segment is **in the file**, at
>   the point where you cued it — not your camera at that timestamp

#### ★ No recovery events in the timeline ★

This is the check that proves the clip end was treated as *expected* rather
than as a failure. After the clip has ended, in SQL:

```sql
select event_type, detail, client_ts
  from health_events
 where show_id = '<your show id>'
   and client_ts > now() - interval '10 minutes'
 order by client_ts;
```

> ☐ **`broll_published`** appears when you cued it, **`broll_clip_ended`** when
>   it finished, **`broll_return_cut`** for the auto-return, and
>   **`broll_source_ended`** when the track came off
> ☐ **NO `track_liveness_impaired`** with reason `absent` or `frames_stalled`
>   for the b-roll track around that moment
> ☐ **NO `egress_reselect`** at the clip's end
> ☐ **NO `publish_recovery_*`** events

Any of those three appearing at the clip's end is the thing to report. Each
has a specific meaning: `frames_stalled` means the frame watchdog is judging a
clip it should be exempt from, `egress_reselect` means the recorder treated an
expected ending as an orphaned track, and a `publish_recovery` means the
unpublish tripped the reconnect machinery.

#### From a cue sheet (optional — only if you use cue sheets)

Cue sheets can now **start** a clip, not just cut to one already playing.

In the cue editor: add a cue, set **Role** to `broll` — it is in the dropdown
now — and a **Clip** selector appears listing your clips. Pick one, save, and
run the show in **Cue** mode.

> ☐ At the cue's timestamp, the clip starts and goes on air by itself
> ☐ **Expected and not a bug:** it lands **a beat late** — roughly half a
>   second to a second. Signing the URL, starting playback and publishing all
>   have to happen first. Author slightly early to compensate.
> ☐ Leaving **Clip** on `(whatever is playing)` gives the old behaviour: the
>   cue cuts to a clip you cued by hand, and falls back if there isn't one

#### If something looks wrong

Reload `/live?show=…&debug=1` and reproduce. The console prints one
`[renderSlot:a]` line per resolution change, and it now prints **source keys**
rather than identities — so a cut to the clip reads
`…#broll` and a cut to your camera reads `…#camera`. Those two strings sharing
an identity and differing only in the suffix is exactly the distinction this
round added; a line showing `chosen=…#camera` while `target=…#broll` is the
bug, and is the single most useful thing you could send me.

### 3.6c ★ END SHOW RELEASES EVERY DEVICE ★ *(QA batch, BUG 2)*

**Do this instead of the plain End Show at the end of 3.6.** It is the one
check that needs two devices watching at once.

With the show live and **a phone paired as a camera**, press **END SHOW** on
the laptop. Then watch the phone.

> ☐ **The phone's camera light goes out within a few seconds**, untouched
> ☐ The phone shows "The show has ended — this camera is off"
> ☐ **Your laptop's camera light goes out too**
> ☐ **And the microphone indicator** — the mic device was never released
>   either, for the same reason
> ☐ You still see your own last frame on the ended screen — that is a **still**
>   now, captured before the camera was released, not a live feed

If any light stays on, note **which device and which light**. Camera-still-on
and mic-still-on have different causes.

### 3.6d Show duration and the window *(QA batch, RULING 1)*

While live, look at the LIVE banner:

> ☐ There is a **"29m LEFT"**-style chip beside ● LIVE, counting down
> ☐ Past the scheduled duration it reads **OVER TIME** rather than a negative
>   number — the window has 15 minutes' grace and running slightly over is fine

Now the sweep. **Do not press End Show.** Leave the show running and wait until
the duration plus 15 minutes has passed (this is why 30m was suggested), then:

> ☐ On a viewer device, `/discover` **no longer lists the show under LIVE NOW**
> ☐ Reloading `/live?show=…` shows the ended card, not the stage
> ☐ On your console, the show is no longer in UPCOMING

And the expired case — schedule a show for **5 minutes from now with a 30m
duration**, then do nothing at all for ~50 minutes (or temporarily change your
computer's clock forward, which is faster):

> ☐ It shows as **MISSED** in your console list, not as a countdown reading
>   "now"
> ☐ **GO LIVE is refused** for it — an artist cannot arm a show whose window
>   has closed
> ☐ It does not appear in Discover's COMING UP

### 3.6e Named cue sheets *(QA batch, RULING 2)*

In the AUDIO panel, load a backing track and open the cue editor.

> ☐ There is a **Sheet** name field, defaulting to `Default`
> ☐ Mark two or three cues, name the sheet **"Slow version"**, press Save
> ☐ Change a cue, rename the field to **"Festival cut"**, press Save again
> ☐ A **Load** dropdown now offers both, with cue counts
> ☐ Loading "Slow version" **restores its cues**, not the festival ones
> ☐ With a name that matches a saved sheet, an orange line warns **"Saving
>   overwrites …"** — so overwriting is never a surprise

Then on your console (`/profile`), find **CUE SHEETS**:

> ☐ Both sheets are listed, with the track name, cue count and date
> ☐ The pencil renames one — and renaming it to the other's name is refused
>   with a real sentence, not an error page
> ☐ The bin asks first, naming the sheet, then deletes it
> ☐ The deleted one is gone from the editor's Load dropdown too

### 3.7 Recording verification (Phase 4a)
Wait ~60 seconds for the file to upload, then on your artist profile open the
recordings library and trigger a verification (or run it directly):

```bash
curl -X POST 'https://loud-mlpz8y3ql-korey-alashe.vercel.app/api/egress/verify' \
  -H "x-vercel-protection-bypass: <your bypass secret>" \
  -H 'Authorization: Bearer <your artist access token>' \
  -H 'Content-Type: application/json' \
  -d '{"show_id":"<the show id>"}'
```

> ☐ Returns `verified: 1` (or `suspect: 1` with named failing checks)
> ☐ In SQL: `select duration_ms, size_bytes, has_video, verified_at,
>   verification from recordings order by recorded_at desc limit 1;`
>   — duration roughly the show's length, size well above zero, `has_video`
>   true
> ☐ `select event_type, detail from health_events where show_id = 'finance'
>   or role = 'egress' order by created_at desc limit 5;` shows
>   `egress_verified_ok`

**Note:** the automatic webhook **cannot** reach a protected preview — LiveKit's
POST is intercepted before it arrives. That is expected, and is exactly why the
manual route exists and runs the identical function.

---

# SITTING 4 · Money (~10 min, laptop, artist account)

### 4.1 Buy tokens
`/wallet` → press **REGULAR (500 + 25 bonus, £8.99)**.

> ☐ Lands on a checkout page with an **orange band: SIMULATED CHECKOUT — NO
>   MONEY WILL MOVE**
> ☐ *(This is the dev provider, because no Stripe keys were supplied.)*

Press **PAY £8.99 (SIMULATED)**.

> ☐ Result shows `HTTP 200` and `{"ok":true,"credited":525}`
> ☐ Back on `/wallet`: balance is **525**, and there are **two** rows —
>   "500 tokens" (purchase) and "25 bonus tokens" (purchase_bonus), separate on
>   purpose

### 4.2 ★ The three failure tests ★ — these matter more than the happy path
Still on the checkout page:

**REPLAY SAME EVENT**
> ☐ `{"ok":true,"duplicate":true}`
> ☐ Balance **unchanged at 525** — this is idempotency working

**TAMPERED SIGNATURE**
> ☐ `HTTP 400 {"error":"Signature verification failed"}`
> ☐ Balance unchanged, and **no ledger row written**

**WRONG AMOUNT** (valid signature, wrong number)
> ☐ `HTTP 409 {"error":"Amount mismatch"}`
> ☐ Balance unchanged — **the event never decides the amount; the intent does**

In SQL:
```sql
select provider, event_id, event_type, signature_verified, status
  from webhook_events order by received_at desc limit 6;
```
> ☐ One `processed`, one `rejected` (signature_verified false), one `failed`
>   (amount mismatch) — and only ONE row for the replayed event id

### 4.3 ★ The cash-out gate ★
Still on `/wallet`, scroll to CASHING OUT.

> ☐ It says **"Cash-outs need an identity check"** — your `kyc_status` is
>   `'none'`
> ☐ It also says buying and spending are unaffected

Now flip the gate, as service role:
```sql
update profiles set kyc_status = 'verified', kyc_updated_at = now()
 where id = '<your artist id>';
```
Reload `/wallet`.

> ☐ The REQUEST A CASH-OUT form appears
> ☐ Asking for **100 tokens** is refused (minimum 5,000)
> ☐ Asking for more than your balance is refused

Give yourself a balance and request properly:
```sql
insert into wallet_transactions (user_id, amount_tokens, kind, description)
  values ('<your artist id>', 10000, 'adjustment', 'Test balance');
```
Reload, request **5,000**.

> ☐ Accepted, "your tokens are held"
> ☐ Balance drops by 5,000
> ☐ A `cashout_request` row appears in the transactions list, **negative**
> ☐ `select status, kyc_status_at_request from cashout_requests order by
>   created_at desc limit 1;` → `requested` / `verified`

Finally, put it back:
```sql
update profiles set kyc_status = 'none' where id = '<your artist id>';
```

> ☐ `/wallet` refuses cash-outs again

---

# SITTING 5 · Share cards (~5 min)

Make one recording public (`/share/{recording id}` → MAKE PUBLIC TO SHARE).

### 5.1 The clip range now survives
Drag the START and END handles to pick a moment, press **SAVE THIS RANGE**.

> ☐ "Saved."
> ☐ **Reload the page.** The handles come back where you left them.
> ☐ *(Expected and stated on the page: it does not cut the video. There is no
>   job runner. The choice is what survives.)*

### 5.2 Unfurl the links
Paste `https://…/watch/{id}` into WhatsApp or a Slack DM.

> ☐ Card shows the recording title, **your artist name**, the date, and your
>   photo
> ☐ Now paste a **private** recording's watch link
> ☐ Card is **generic** — no title, no name. Nothing leaks.

Paste `https://…/artist/{your id}`.

> ☐ Card shows your name, your bio (or genres), your photo

---

# SITTING 6 · Account control (~10 min) — closure LAST

Do 6.1 and 6.2 on your **artist** account. Do 6.3 on the **throwaway fan**.

### 6.1 Request my data
`/settings` → YOUR DATA → **REQUEST MY DATA**.

> ☐ A `loudentify-export-YYYY-MM-DD.json` downloads
> ☐ Open it: it starts with a **manifest** listing sections AND an `excluded`
>   block explaining what is not in it and why
> ☐ Your profile, shows, recordings (metadata + paths, **no video**), wallet
>   transactions, notifications, follows are all present
> ☐ Press it a fourth time → refused, with a **specific time** you can retry
> ☐ `select kind, detail from account_requests order by created_at desc;` shows
>   three rows and **not** a fourth

### 6.2 Log out everywhere
Sign in on your phone as the same artist. Then on the laptop:
SECURITY → **LOG OUT ON ALL DEVICES**.

> ☐ Laptop signs out
> ☐ **The phone is signed out too** (refresh it)

### 6.3 Close the throwaway fan account — do this last
Sign in as the throwaway fan. `/settings` → CLOSING YOUR ACCOUNT →
CLOSE MY ACCOUNT.

**Read the confirmation screen before pressing anything.**
> ☐ It lists what happens: no login, profile hidden, recordings private, shows
>   cancelled with slot holders told
> ☐ It lists **what is kept and why** — wallet history in full, username held
> ☐ It says in as many words: **"This is a deactivation, not a deletion"**

Type `CLOSE`, optionally give a reason, confirm.

> ☐ A summary appears with real counts
> ☐ You are signed out
> ☐ **Try to log back in — it must fail**
> ☐ Search that fan on `/discover` — gone
> ☐ Visit their `/artist/{id}` — "has closed their account", **not a 404**
> ☐ `select deactivated_at, retained_stage_name, deactivation_reason from
>   profiles where id = '<that id>';` — all three set
> ☐ `select count(*) from wallet_transactions where user_id = '<that id>';`
>   — **unchanged**. The ledger is never deleted.

---

## Report back

For each ☐ that failed, I need: **which sitting, what you saw, and what the
browser console said.** The console matters most for anything in sitting 3 —
the live path is where a silent failure looks like a working one.

**Known and expected, so not worth reporting:**
- The egress webhook never fires on the preview (LiveKit cannot reach a
  protected deployment). Use the manual verify route.
- Comments vanish for anyone who joins late — they are ephemeral by design.
- B-roll on Safari or on a phone: the panel says the browser cannot do it.
  That is `captureStream` genuinely being unimplemented there, not a bug.
- A cue sheet can cut to a clip that is already playing but cannot START one.
  Starting playback is a deliberate act at the console.
- Auto and Staccato never cut to a clip. That is deliberate — see
  `DECISIONS.md` § B-roll live playback.
- Followed artists only sort to the top of the *loaded* page of Discover.
- No follower counts anywhere. The follow graph is private and a client-side
  count would read "1" for everybody.
- A swept show's database row can read `soundcheck` until its owner next opens
  the app. Every client already treats it as ended by the clock; the durable
  write is deliberately lazy because there is no cron in this stack.
- GO LIVE still arms 30 minutes before the start, not at the start. That is a
  deliberate reading of Ruling 1 — see DECISIONS.md — because arming only from
  the slated time would delete soundcheck.

---

# SITTING 7 · The camfeed device round

> Renumbered from "Sitting 5" — this document already had a SITTING 5 (share
> cards) and a SITTING 6 (account control), and two of each is a good way to
> run the wrong one.

Deployed: `https://loud-jhu8bxx5m-korey-alashe.vercel.app`

**You need a real phone for all four.** Nothing here can be checked from a
headless browser: three of them are about what an operating system does to a
page it has stopped paying attention to.

Pair a phone in Kit Check as usual before starting.

## 7.1 Reopen a closed camfeed tab mid-show — resumes with NO code

The one that cost you a sitting.

1. Go live with a paired phone contributing.
2. On the phone, **close the tab entirely.** Not background it — close it.
3. Reopen it: from history, from the QR again, or by typing `/cam/pair`.
   All three are the same test; the QR one matters most because that URL
   still carries the original `?code=`, which was used up at redeem.

**Expected:** a brief *"Reconnecting this camera…"*, then the viewfinder,
back in the show. **No code entry at any point.**

**On the director console, the thing to actually watch:** the camera comes
back as *the same camera*. Its role tile repopulates. You should **not** see a
new angle appear alongside a dead one, and the shot should be cuttable to
immediately.

> If the phone asks for a code, the credential did not persist. Check whether
> the phone is in private browsing — the pairing screen says so explicitly
> when it cannot remember.

**Also check the other two reopen moments:**

| When | Expected |
|---|---|
| Reopen **after** the Kit Check → show migration | Lands in the **show** room, not the rehearsal one — it resumes to wherever the pairing points *now*, not where it was when the tab closed |
| Reopen **after End Show** | *"The show has ended"*. **The camera light must NOT come on.** This is the one to be fussy about: a light that comes back by itself in someone's pocket is the worst bug in this area |

## 7.2 A phone stays awake through a 10-minute publish

1. Pair a phone, get it publishing, and **put it down. Do not touch it.**
2. Wait 10 minutes.

**Expected:** the screen is still on and the feed is still live at the console.

**If the screen dims or sleeps:** look at the bottom of the viewfinder. It
will be telling you which of two things happened —

- *"This phone may dim on its own"* — the browser supports wake lock but
  refused, usually an OS low-power mode. Real, and worth reporting with the
  phone model.
- *"This phone can't be kept awake by the browser"* — Wake Lock is not
  implemented. iOS Safari before 16.4. Not a bug; the message is the honest
  answer and tells the operator to set auto-lock to Never.

**Then the deliberate case, which is different on purpose:** press the power
button to lock the handset. The screen goes off — a wake lock cannot and
should not prevent that. Within ~3 seconds the console should drop that
camera with `frames_stalled`. **That is the watchdog working, not a
regression.** Prevention covers the accidental case; detection covers this one.

## 7.3 Viewfinder states

On the phone, with a show running:

| Check | Expected |
|---|---|
| Own picture | Fills the screen. This is the framing view |
| Role | `WIDE` / `CLOSE` / `SIDE` badge, top right of the picture |
| Connection | **In words** — "Connected — in the show" / "Reconnecting — hold still". A dot carries the same meaning alongside, never instead |
| Which room | "Show room" or "Rehearsal room", with the room name under it |
| **ON AIR** | Turns solid red **the moment the director cuts to this camera**, and back to a grey "NOT ON AIR" when they cut away |
| Stage inset | Bottom right, labelled `LIVE SOURCE`. Shows whichever camera is currently cut to. When *this* phone is the cut, it says so in words rather than mirroring the picture behind it |

**In rehearsal there is deliberately no inset** — rehearsal tokens cannot
subscribe, so there is nothing to show and a black rectangle would read as a
fault.

**The inset is the live SOURCE, not the composed frame.** It does not apply
the shot's push-ins or crops. It answers "what is going out, and is it me".

## 7.4 Rotate mid-show — no CAMERA LOST, no reselect

The important one, and the easiest to get a false pass on. Do it **while the
director is cut to that camera.**

1. Cut to the paired phone's angle.
2. On the phone, tap **ROTATE → FRONT**.

**Expected on the phone:** the picture flips to the selfie camera in under a
second. `ON AIR` stays red throughout.

**Expected on the console — this is the actual test:**
- The camera does **not** disappear and reappear.
- No `CAMERA LOST` treatment over the shot.
- The director does **not** reselect. The shot stays where you put it.

**In the health timeline** (this is what makes it a real check rather than a
vibe): you should see **one** `camfeed_rotated` row, and you should **not**
see `track_liveness_impaired` with reason `absent`, nor
`track_liveness_forgotten`, nor a new `identity:trackSid` key entering the
pool. The `trackSid` logged on the rotate row is the *same* sid the camera had
before — that is the proof it was a lens change and not a camera drop.

> A brief `frames_stalled` followed immediately by `track_liveness_recovered`
> is acceptable and bounded — it means the handset took over 3 seconds to
> reacquire the lens. Report it with the phone model, but it is not the
> failure this test is looking for. The failure is `absent`, a new key, or a
> reselect.

Rotate back and confirm it is symmetrical.

---

# SITTING 8 · MANDATORY — recording still works after the auth change

> Renumbered from "Sitting 6" for the same reason.

Deployed: `https://loud-ezro1gi11-korey-alashe.vercel.app`

**This one is not optional and not skippable.** `/api/egress/start` and
`/api/egress/stop` now require the authenticated artist who owns the show. If
I got that wrong, the symptom is silent: recordings simply stop happening, or
worse, stop *stopping*, and nobody finds out until afterwards.

## ⚠️ FIRST — read this if you are testing on PREVIEW

**On PRODUCTION this is already fine** — `vercel env ls` shows
`EGRESS_TEMPLATE_BASE_URL` scoped to **Production only**. If you are running
this sitting against production, skip this box entirely.

`EGRESS_TEMPLATE_BASE_URL` **is not set on Preview.** I checked with
`vercel env ls preview`: every other egress variable is there, that one is not.

**Consequence:** `/api/egress/start` returns `500 Server missing egress
environment variables` on every preview deployment, and has done since the
variable was introduced. **This predates the security round** — I did not
break it, but I did find it, and Sitting 8 cannot pass until it is set.

I have deliberately not set it myself. It is a change to your Vercel project,
and the correct value is a judgment call: per the route's own header it must
be a **stable, publicly reachable origin**, because LiveKit's egress service
runs outside this deployment and navigates a headless browser to it — it can
never reach a protection-gated preview URL.

```bash
# Use your production domain, not a preview URL.
vercel env add EGRESS_TEMPLATE_BASE_URL preview
# then redeploy:  vercel --yes
```

> **What this does and does not buy you on a preview.** Setting it lets the
> route get past its own guard, so start/stop return properly and 6.1 and 6.2
> below can pass. The recorded FILE will still be poor on a protected preview,
> because LiveKit's browser cannot reach the template to render it — that is
> the pre-existing limitation already noted in this document, not something
> this round changed. Sitting 8 is a test of the **auth gate**, not of video
> quality.

## 8.1 An unauthenticated call is now refused

From your laptop, no browser needed:

```bash
curl -s -X POST -H 'content-type: application/json' \
  -H "x-vercel-protection-bypass: $VERCEL_AUTOMATION_BYPASS" \
  -d '{"room":"any-room-name"}' \
  -w '\nHTTP %{http_code}\n' \
  "$SMOKE_URL/api/egress/stop"
```

**Expected: `HTTP 401`,** `{"error":"Missing Authorization header"}`.

Before this round the same call returned `200 {"ok":true,"stopped":false}` —
it reached LiveKit. Against a room with a live recording, it would have
stopped it.

Both routes, both verbs, are covered automatically by `npm run probe:auth`
(38/38 green on this deployment) and `npm run probe:authz` (7/7, signed in).
The curl is here so you can see it refuse with your own eyes.

## 8.2 Start and stop STILL WORK on a real show — the one that matters

1. Schedule a show, open Kit Check, **GO LIVE**.
2. **Within a few seconds of going live**, open the browser console on the
   artist device and look for:
   `[egress] start …` — you want **no** warning line.
3. Let it run a minute or two.
4. Press **End Show**.
5. Console again: **no** `[egress] stop refused` line.

**In the health timeline** — this is the durable evidence, and it is new this
round:

| Event | When | Means |
|---|---|---|
| `egress_command_ok` with `action: "start"` | at Go Live | the recorder started |
| `egress_command_ok` with `action: "stop"` | at End Show | **the recorder stopped** |

**If you see `egress_command_failed` instead, read its `stage` field** — it
says exactly which wall was hit:

| `stage` | What it means |
|---|---|
| `refused (401)` | the bearer was missing or expired — an auth-plumbing bug, tell me |
| `refused (403)` | *"This is not your show"* — ownership check wrong, tell me |
| `refused (404)` | no `shows` row matched this `room_name` |
| `refused (500)` | `EGRESS_TEMPLATE_BASE_URL` — see the box above |
| `no session token available` | the client could not read a session at all |

**The specific failure I was most worried about, and how to actually catch
it:** a Supabase access token lives about an hour; a show can be scheduled for
three. If the token were captured when the room mounted, `stop` would 401 at
End Show on any show longer than an hour — and everything would look fine
until then. The token is now read fresh at call time, so this should not
happen. **To prove it rather than trust it: run a show longer than an hour and
confirm `egress_command_ok / stop` still appears at the end.** A short show
does not test this at all.

## 8.3 Cue sheets, participants — already proven, no device needed

`npm run probe:authz` covers these signed in, including controls that prove
the fix refuses *other people's* data without refusing your own:

```
✔ GET  /api/cue-sheets with someone else's artist_email — 403
✔ POST /api/cue-sheets writing to someone else's email — 403
✔ CONTROL — my OWN email still works — 200
✔ CONTROL — no artist_email at all still works — 200
✔ POST /api/egress/start|stop for a room I don't own — 404
✔ POST /api/participants against a nonexistent show — 404, not a 500
```

Worth one manual check anyway, because it is the path a real artist takes:
**open a cue sheet in the editor, rename it, save it, and load it again.** The
route now derives your email from your session instead of the request body; if
anything in that plumbing is wrong, this is where it shows.
