# Overnight product round — decision log

Branch: `feature/overnight-product-round`. Preview only, never merged to main, never deployed to production.

Every judgment call made without you, with a one-line reason. Newest section at the bottom.

---

## 1. Auth-first home + rebrand

- **Live show moved from `/` to `/live`.** The root had to become the auth landing, and the show needed a stable home; `/live` is the obvious name and keeps every existing deep link shape (`/cam`, `/egress`) untouched.
- **Signed-in users skip the landing.** Hitting `/` while authenticated redirects to `/dashboard` (artist) or `/discover` (viewer) rather than showing a login form to someone already logged in.
- **Viewers are gated at `/live`, not at the root.** Gating the route the show actually lives on means a shared show link prompts login and then lands you on the show, instead of dumping you on a generic home page.
- **Rebrand is a literal string swap, not a redesign.** "Neon Meridian" was a placeholder artist name doubling as the wordmark; every instance becomes "Loudentify" and nothing else about the mark changes tonight.

## 2. Signup fields

- **Date of birth, not age.** You asked for age; I collect DOB and derive age. Age is a number that silently goes stale in the database, and anything later that needs an age threshold (13+, 18+ for payouts) needs the birth date anyway. Reversible either way, but only DOB can produce a correct age tomorrow.
- **Username is unique, lowercase, `a-z 0-9 _`, 3–20 chars.** Usernames end up in URLs and mentions; letting mixed case or spaces in now creates a migration later.
- **"Stage name" is a label, not a column.** Artists see "Stage name", fans see "Username", both write to `username`. One namespace means an artist and a fan can never collide, which is what you want the day handles become public.
- **Country via ISO alpha-2 codes + `Intl.DisplayNames`.** Storing the code (not the label) keeps the data stable if display names change, and deriving labels from the browser means no 250-line hardcoded list to maintain.
- **Signup degrades gracefully before the migration runs.** The profile insert tries the full field set and, if the columns don't exist yet, retries with the original ones and logs a warning — so the preview is usable tonight and gets richer the moment you run the SQL.
- **Genres kept optional at signup.** Making a multi-select mandatory on a signup form is the classic way to lose signups; the field is there, skipping it is allowed, and Settings already edits it.

## 3. Placeholder purge

- **Deleted `ArtistProfile.jsx` outright.** `/artist` now renders the signed-in artist's *real* public page through the same component fans see, so an artist is never looking at a flattering mockup of themselves.
- **Stats removed, not zeroed.** Shows-watched, reactions-sent, follower/"signal" counts and view counts are gone rather than showing `0`. Nothing counts them yet, and a `0` claims a measurement that isn't happening — while a wall of zeros reads as a dead platform.
- **Top supporters → empty state.** Invented revenue is the fastest way to make an artist distrust every other number on the page.
- **Messages → honest empty state.** There is no threads table, no delivery, no recipients. A fake inbox is worse than an empty one because it invites a reply to someone who doesn't exist.
- **Archived VOD chat → empty.** Live comments aren't persisted anywhere, so there is genuinely nothing to replay.
- **Discover is real.** Artists come from `profiles` where `role='artist'`; live shows from `shows` in soundcheck past their slated time. Genre filter chips are built from genres real artists actually have, so the filter can never offer a genre nobody performs.
- **`select('*')` for shows.** `title`/`performance_mode` only arrive with the scheduling migration; naming them in the query would 400 the whole thing beforehand, so Discover reads defensively and works before and after.

## 4. Scheduling + broadcast window

- **Kit Check is a separate route (`/kit-check`), not a mode inside the live page.** This is what makes "zero LiveKit connection" *provable* rather than asserted — there is no `LiveKitRoom` anywhere in that component tree, so it cannot connect by accident.
- **Camera ownership is inverted where it matters.** Kit Check acquires the camera with its own `getUserMedia`, attaches it to an element it owns, flips it, stops it and releases it. No LiveKit lifecycle is involved at all. The *live* path still lets LiveKitRoom own the camera — see "what I did not do" in the summary.
- **The window opens 30 minutes before showtime** and closes 3 hours after, unless the artist ends the show. A window that never shuts is a LiveKit bill that never stops. 30 minutes reuses the existing soundcheck constant rather than inventing a second "how early can I start" number.
- **GO LIVE is disabled, not hidden, before the window.** A greyed button that says when it unlocks teaches the rule; a missing button just looks broken.
- **Reminders are generated lazily by the artist's own session, not by a job.** There is no cron in this stack. The honest consequence: a reminder appears the next time you open Loudentify after it comes due, not at the exact minute. A unique `dedupe_key` makes running the check on every page load harmless.
- **Push and email are NOT wired.** Both need infrastructure (a service worker + VAPID keys, or an email provider) that isn't trivially achievable in one night. Logged as follow-up; in-app entries are real.
- **The countdown overlay doesn't block.** 50% opacity and `pointer-events: none`, so the artist can still see and fix their framing during the final 60 seconds — which is exactly when they'd want to.
- **Kit Check releases the camera and mic before handing over to the live page.** Two owners of one device is how you get a black frame on stage.
- **More fake stats found and removed** while wiring this in: FOLLOWERS 84.2K, TOKENS EARNED 312K, SIGNAL 8,420 on the dashboard.
