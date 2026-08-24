# Device test — Go Live threading (the first fully-scheduled show, end to end)

This is the spine test. Everything before it verified a piece; this one
verifies that a show you *scheduled* is the show you *perform*, in its
own room, recorded into its own room, watched by someone who followed a
link to it. Until this passes, "scheduled shows" is a form, not a
feature.

**Preview:** https://loud-267jomcoo-korey-alashe.vercel.app
(branch `feature/overnight-product-round`, commit `1c4545c`, preview
target — not production, not merged to main.)

**Verified before handing this back (round 2, after the crash):**

- `/live?show=<uuid>` **loaded and rendered** on this deployment via the
  protection bypass — no client-side exception — and redirected to
  `/auth?next=%2Flive%3Fshow%3D<uuid>`, i.e. the show id survives the
  login detour. Screenshot-equivalent: the page title is "Log in ·
  Loudentify" and the URL carries the encoded `next`.
- The crash site itself, checked **in the deployed minified artifact**:
  in the old chunk the dependency-array reference sat 827 bytes *before*
  its declaration (the TDZ that threw `Cannot access 'tP' before
  initialization`); in the new chunk the declaration is 656 bytes
  *before* the use. Same code path, order inverted.
- `npm run check:tdz` is green across `app/`, `components/` and `lib/`.
- `/api/token` with no `room` returns 400 `{"error":"room is required"}`
  on the live deployment — the pilot-room default is gone at runtime,
  not just in the bundle.

**What I still cannot verify myself, stated plainly:** reaching
`RoomInner` — the component that crashed — requires being signed in, and
I'm not able to enter a password into a login form. So the crash fix is
proven by the artifact and the static check, not by my having stood on
the stage. Step 2 below is still the first time a human sees it work.

**One migration, and run it first:**
`docs/notifications_conflict_target_migration.sql`. It fixes the
reminders 400 — the existing unique index is *partial*, which `ON
CONFLICT` cannot infer. The file explains the whole diagnosis and carries
its own verification query. Idempotent; safe to run twice.

Nothing else in this round touches the schema. `health_events.show_id`
and `shot_commands.show_id` are both `text` and already carry a room
name, which is why per-show rooms need no change of their own.

---

## Before you start

1. **Preview access.** Protection Bypass for Automation is enabled now,
   so the URL opens directly on any device — no Vercel login needed.
2. **You will have to log into Loudentify again on this URL.** Every
   deploy mints a new origin, and the Supabase session lives in that
   origin's local storage. That is a preview-URL artefact, not the bug
   from last round — the bug was being asked *twice on the same origin*,
   once by `/auth` and again by the live page itself.
3. **Two accounts.** The viewer half genuinely needs a second one —
   `/live` requires an account for everyone now, performer or audience.
   A second browser (or a private window) signed in as a viewer account
   is enough; it does not need to be a second physical device, though
   using one is a better test.
4. **Nothing to clean up first.** The old `pilot-room` row can stay
   where it is. Nothing reads it any more, and leaving it in place is
   itself a small check: if a show ever lands in it again, something
   regressed.

---

## Step 1 — Schedule a show

**Do:** Dashboard → schedule a show, **solo**, timed **~35 minutes from
now** (so you get to watch the window open rather than arriving after
it). Give it a title you'll recognise.

**Expect:**
- It appears under UPCOMING with a countdown chip, not "WINDOW OPEN".
- GO LIVE is greyed with "GO LIVE unlocks in 5m (30 minutes before your
  show)" — the window opens at T-30, so with a T+35 show it's still shut
  for about five minutes.

**Note for later:** open the row in the database (or just remember the
title) — you'll want its `room_name` in Step 6. It should look like
`show-xxxxxxxx`, **not** `pilot-room`.

---

## Step 2 — Kit Check, and the window opening under you

**Do:** Tap KIT CHECK. Start the camera, start the audio. Stay on the
page through T-30 (the window opening) and on toward showtime, without
touching anything.

**Expect — and this is the changed behaviour:**
- The badge reads NOT CONNECTED — NOTHING IS BEING SENT the whole time.
- **At T-30, nothing happens.** The header line changes to "window is
  open. You're on at 7:45pm, and this page hands you over 60 seconds
  before that" — but no countdown, no handover. Last round the 60
  seconds started here, which is why you were thrown on stage four
  minutes early. You now get the whole window in Kit Check.
- **At T-60s** the overlay appears: YOU'RE ON IN, 60, GOING LIVE, at half
  opacity with your own framing visible underneath.
- It reaches zero **at showtime**, not before. Worth glancing at a clock
  at that moment — that alignment is Finding 2's actual pass condition.
- Bonus check if you have the patience: leave and re-enter Kit Check at
  ~T-20s. It should show **20**, not a fresh 60.

**This is the moment the last test broke.** What should happen now:

**Expect (the fix):**
- You land on `/live?show=<the id of the show you scheduled>`.
- **No crash.** Last round this was "Application error: a client-side
  exception has occurred" — a temporal-dead-zone `ReferenceError` that
  had been latent in `RoomInner` since 23 Aug and that nobody could
  reach until the entry gate came down.
- **No login form. No password. No email field. No "are you here to
  watch or to perform". No solo/versus picker.** A brief
  "CONNECTING YOU TO THE SHOW…" and then the broadcast stage.
- You are on stage, publishing. Because the handover now lands at
  showtime rather than half an hour early, the soundcheck banner may
  flip to live almost immediately — that's correct, not a glitch.

**If either a sign-in screen or an application error appears, stop and
screenshot it.** Those are the two failures this round exists to kill and
I want to see which one before touching anything else. If it's a crash,
the console line matters more than the screenshot.

---

## Step 3 — Confirm you're in the *right* room

**Do:** On the stage, open ADD CAMERA (top right).

**Expect:** the three QR codes encode
`/cam?room=show-xxxxxxxx&slot=a&role=...` — **your show's room name**,
visible as text under each code. If that string says `pilot-room`, the
threading failed and nothing below is worth running.

**Optional but cheap:** scan the WIDE one with a second phone. It should
join as an extra camera and appear in your feeds strip. A `/cam` link
with the room stripped off now says "This link is missing a show"
instead of quietly joining a fallback room.

---

## Step 4 — The viewer arrives by link

**Do:** On the second browser/device, signed in as the *viewer* account,
go to `/discover`.

**Expect:**
- Before the slated time: your show is **not** in the live list (a show
  is only "live" once it's in soundcheck *and* past its slated time).
  Paste the link `/live?show=<id>` directly instead — you should get the
  holding screen with the artist name and a running countdown.
- **Two different holding screens, and the difference is the point.**
  Before the window opens (earlier than T-30) nothing connects at all —
  no LiveKit, no cost, just the countdown. Between T-30 and showtime the
  viewer *is* connected and waiting in the room. Both look the same;
  only the network tab tells them apart. If you want to see the
  no-connection one, use the link well before T-30.
- After the slated time passes: the show appears in Discover's live list
  with its title and your artist name. Tapping it goes to
  `/live?show=<id>`.
- The viewer lands in the show — the same show — and sees your directed
  feed. No email gate, no "I'm a viewer / I'm an artist" choice.

**The auth carry-through, worth testing once explicitly:** sign the
viewer out, then paste `/live?show=<id>` while logged out. You should be
bounced to `/auth?next=%2Flive%3Fshow%3D<id>` — **with the show id in the
`next` param** — and after logging in land back on *that show*, not on a
bare `/live`. Before this round the id was dropped here.

---

## Step 5 — Live, and the show behaving

**Do:** Let the slated time pass while you're on stage. With the timing
fix this is seconds after you arrive, not half an hour — so watch for it
rather than waiting for it.

**Expect:**
- Your own screen flips soundcheck → live.
- The viewer's holding screen hard-cuts to the show.
- The auto director starts cutting.
- Comments from the viewer reach you, and the author name is a display
  name — **never an email address** (that fallback was removed
  deliberately; if you see an email in the comment list, tell me).

---

## Step 6 — The recording lands in the right room

**Do:** Perform for a couple of minutes, then END SHOW.

**Expect:**
- Everyone gets the ended card; nothing keeps publishing.
- In the LiveKit dashboard, the egress for this session is against room
  `show-xxxxxxxx`, not `pilot-room`.
- In Supabase Storage, the new object is
  `recordings/show-xxxxxxxx-<epoch>.mp4`.
- Dashboard → recordings → sync picks it up and attributes it to **this**
  show (title and date match what you scheduled).

**Why this step matters beyond the file:** attribution is by room name.
One room per show makes that attribution effectively exact, where the
shared pilot room made it a nearest-in-time guess across every show ever
recorded.

---

## Step 7 — The edges (5 minutes, worth it)

| Do | Expect |
|---|---|
| Open `/live` with no `?show=` while signed in as the artist | Resolves to your next un-closed show **and rewrites the URL** to include its id |
| Open `/live` with no `?show=` as a viewer account | "No show here — This link is missing a show", with BROWSE SHOWS / MY SHOWS |
| Open `/live?show=garbage` | "No show here — That link doesn't point at a show we can find" (not a crash, not someone else's room) |
| Open the ended show's link again | "…has ended", with a link to Discover |
| Refresh mid-show as the performer | Back on stage, same slot, with a "Back on slot A." banner — not seated as a spectator |
| Open the show link as a *third* account with no invite | Joins as a viewer, silently. No error, no line-up complaint |

---

## What I could not verify myself

- **Everything behind the login is unexercised on my end.** I can load
  the preview (bypass) but not sign in — entering a password into a form
  isn't something I'll do — so Kit Check, the stage, the director and
  End Show are all still reasoning from code plus the artifact checks
  listed at the top. Local dev is no help either: `.env.local` holds only
  a Vercel OIDC token, no Supabase or LiveKit credentials.
- **The versus path is unexercised.** The invite → slot B → `/live?show=`
  flow is threaded the same way and should work, but this script tests
  solo end to end. Worth its own sitting once solo passes.
- **The reminders 400 fix is unverified until the migration runs.** The
  diagnosis is solid (a partial index can't be an `ON CONFLICT` target)
  but "the SQL did what it says" is your query to run, not mine.
- **The 60-second countdown → auto-entry handoff is the single riskiest
  moment** and the one I most want a screenshot of either way. If it
  works, that's the platform's new spine. If it doesn't, the shape of the
  screen you land on tells me immediately which half failed.
