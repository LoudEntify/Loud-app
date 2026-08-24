# Device test — Go Live threading (the first fully-scheduled show, end to end)

This is the spine test. Everything before it verified a piece; this one
verifies that a show you *scheduled* is the show you *perform*, in its
own room, recorded into its own room, watched by someone who followed a
link to it. Until this passes, "scheduled shows" is a form, not a
feature.

**Preview:** https://loud-8ngyk06dc-korey-alashe.vercel.app
(branch `feature/overnight-product-round`, commit `ab266cf`, preview
target — not production, not merged to main.)

**Verified before writing this:** the served `/live` bundle on that
deployment contains zero occurrences of `pilot-room` and does contain
the new resolution path (`get("show")`, `performer/join-show`,
`room_name`). That is a bundle check, not a behaviour check — everything
below is still a prediction from reading code until you run it.

**No migration this round.** Nothing in this change adds or alters a
column. `health_events.show_id` and `shot_commands.show_id` are both
`text` and already carry a room name, which is why per-show rooms need
no schema change. You can skip the usual pre-flight SQL ritual — but if
you want the one-line confirmation, `select count(*) from shows;` is
enough to prove you're pointed at the right database.

---

## Before you start

1. **Preview access.** An anonymous request to the preview URL redirects
   to Vercel's SSO — Deployment Protection is on. Whatever device you
   test from needs to be signed in to Vercel in that browser, same as
   previous rounds. If your phone isn't, say so and I'll either disable
   protection for previews or mint a bypass link before you start.
2. **Two accounts.** The viewer half genuinely needs a second one —
   `/live` requires an account for everyone now, performer or audience.
   A second browser (or a private window) signed in as a viewer account
   is enough; it does not need to be a second physical device, though
   using one is a better test.
3. **Nothing to clean up first.** The old `pilot-room` row can stay
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
page and let the clock cross T-30 without touching anything.

**Expect:**
- The badge reads NOT CONNECTED — NOTHING IS BEING SENT the whole time.
- At T-30 the countdown overlay appears: YOUR WINDOW IS OPEN, 60, GOING
  LIVE, at half opacity with your own framing visible underneath.
- The countdown runs to zero on its own.

**This is the moment the last test broke.** What should happen now:

**Expect (the fix):**
- You land on `/live?show=<the id of the show you scheduled>`.
- **No login form. No password. No email field. No "are you here to
  watch or to perform". No solo/versus picker.** A brief
  "CONNECTING YOU TO THE SHOW…" and then the broadcast stage.
- You are on stage, publishing, with the soundcheck banner up (the show
  is in soundcheck until the slated time passes).

**If a sign-in screen appears at all, stop and screenshot it** — that is
the exact failure this round exists to kill, and I want to see which
screen it is before touching anything else.

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
  holding screen with the artist name and a running countdown, and
  **nothing should connect** (this is deliberate: no LiveKit connection
  before the window, now on the audience side too).
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

**Do:** Let the slated time pass while you're on stage.

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

- **Nothing in this round was exercised in a browser on my end.** Local
  dev has no Supabase or LiveKit credentials (`.env.local` holds only a
  Vercel OIDC token), so every screen below the resolution logic is
  reasoning from code plus a bundle grep on the deployed preview.
- **The versus path is unexercised.** The invite → slot B → `/live?show=`
  flow is threaded the same way and should work, but this script tests
  solo end to end. Worth its own sitting once solo passes.
- **The 60-second countdown → auto-entry handoff is the single riskiest
  moment** and the one I most want a screenshot of either way. If it
  works, that's the platform's new spine. If it doesn't, the shape of the
  screen you land on tells me immediately which half failed.
