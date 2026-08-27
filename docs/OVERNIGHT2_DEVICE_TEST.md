# DEVICE TEST — overnight build #2

**One script, every phase, ordered so you reset as little as possible.**

Read the ordering note before you start: it is the reason this is one script
and not five.

---

## What you are testing

| | |
|---|---|
| **Branch** | `feature/overnight-round-2` (off `feature/overnight-product-round`) |
| **Preview** | `https://loud-bh9n24u2t-korey-alashe.vercel.app` |
| **Deployed from** | `76ac18d` — the last commit that changes code. Everything after it is documentation. |
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
| **QA** | `GET /api/broll/upload` (the route that hung) | **`404`** — deleted, not left as a fallback. |
| **QA** | `PATCH` / `DELETE` / `GET ?all=1` on `/api/cue-sheets` | `401` each — rename, delete and library all deployed and gated. |
| **QA** | Artist-console chunk, fetched from the deployment | Contains `HOW LONG` (duration picker), `MISSED` (expired badge), `grace`, `CUE SHEETS`, `broll/upload-url`, `broll/register`, `Saving to your library`. |
| **QA** | `/live` chunks | Contain `show-remaining`, `OVER TIME`, `Saving overwrites`, `local_devices_released`. |
| **QA** | `/cam` and `/cam/pair` chunks | Both contain `SHOW_ENDED` and the ended screen — the two pages that previously had no end-of-show handling at all. |
| **QA** | `lib/showWindow.js` exercised in node | 14/14 — duration default and clamp, `ends_at` override, window open/shut either side of the grace, expired classification, remaining-time. |
| all | `/`, `/shows`, `/notifications` | HTTP 200 each. |

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
`/api/broll/upload` is gone entirely — a GET to it returns 404.

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

### 2.4 Wait for the countdown
Stay in Kit Check. At **T−60 seconds** a full-screen countdown appears.

> ☐ It says **YOU'RE ON IN** and counts to your *showtime* — not to the window
>   opening half an hour ago
> ☐ You get the whole window in Kit Check, not yanked out at T−30

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
curl -X POST 'https://loud-bh9n24u2t-korey-alashe.vercel.app/api/egress/verify' \
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
