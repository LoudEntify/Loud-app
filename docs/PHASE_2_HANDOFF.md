# Phase 2 handoff: the viewer experience on the web

2 October 2026. Branch `claude/overnight-build-2026-10-02`, pull request into `staging`. Written for Korey in plain English first; the technical detail is at the end.

## What works (and I ran it)

A person who has never signed up can open Discover, scroll a snapping feed of live shows, starting-soon cards and recordings, tap into a show and watch it through the player with nothing covering the picture. They can watch for a free minute (counted across every video on that device, with a "sign up free to keep watching" chip at 50 seconds), and the moment they try to chat, vote, follow, set a reminder or send support, a one-page sign-up rises beside the picture. The picture shrinks to the smallest size YouTube allows (200 x 356) and stays visible the whole time.

Sign-up asks for watch or perform, name, username, date of birth, location, email and password, with the Terms and Community Guidelines accepted in one line. Someone under 18 sees the kind stop screen and their date of birth is never written anywhere (the e2e test checks the database for it). Performers get the separate, on-by-default training-data line.

Once signed in: votes land (one per account, changeable until voting closes, with a 15-second grace window for the YouTube delay), chat posts, Follow and Remind me work, and Support sends tokens: a double tap pays once, 72.5% is recorded for the artist at that moment, and every support is in the audit log. The wallet shows the balance and history, with token purchase in clearly labelled test mode. Versus shows show "A vs B", the "Who moved you this round?" vote, and the composed three-view picture (from the test-card player; the real compositor is Phase 3).

Every screen has its five states: skeleton loading, plain-English empty and error states, an offline bar that keeps loaded content readable, and the success state. The cookie banner asks before the YouTube player or analytics run; on the show screen the question is asked inside the player's own box, never over it.

Layouts: phone (304 x 540 player, Bigger 340 x 604, vote 270 x 480, guest 200 x 356), Fold and tablet (360 x 640 with chat beside), computer (405 x 720 between an info column and chat). A test proves at 15 screen sizes and 5 modes that nothing ever overlaps the player and the player never drops under 200 x 200; the end-to-end suite then checks it again in a real browser.

## How to try it

**Locally (everything, no secrets):**

```
scripts/dev/fetch-postgrest.sh          # once
DATABASE_URL=postgres://postgres:postgres@localhost:5432/loudentify_dev scripts/db/apply-migrations.sh --fresh
DATABASE_URL=postgres://postgres:postgres@localhost:5432/loudentify_dev scripts/db/seed.sh
DATABASE_URL=postgres://postgres:postgres@localhost:5432/loudentify_dev node scripts/dev/local-stack.mjs --write-env   # keep running
npm run dev                             # in a second terminal, then open http://localhost:3000
```

Then: open `/discover` as a guest, tap "Join the show" on the first card, try Bigger, try to vote (sign-up opens), sign up with a made-up email, vote, chat, tap Support (give yourself tokens first on `/wallet` with the test-mode packs). Try `/show/<id>` of the Versus show, the starting-soon show (waiting room), the YouTube-delivery show (cookie card inside the frame), `/search?q=Afrobeatz` (near spelling), `/@synth_ama`.

**On staging** once the migrations have been applied by the pipeline (see NEEDS_KOREY: the staging database password): sign in on the staging site, then seed the synthetic shows with one request (dev harness only; it refuses on production):

```
curl -X POST https://<staging-url>/api/dev/seed -H "Authorization: Bearer <your session token>"
```

The one show on real YouTube delivery uses a public YouTube video id as a stand-in until an artist's own broadcast exists (Phase 3).

**End to end, automatically:** `npm run e2e` (builds, starts a throwaway database, the local Supabase stand-in and the app, runs 20 browser checks, tears down). CI runs the same on every push.

## What is stubbed, deferred or untested

- **Apple and Google sign-in** are on the sheet but disabled: they need Apple and Google developer credentials (NEEDS_KOREY). Email works.
- **Token purchase** is the existing test-mode provider; no money moves. A real provider is Korey's choice (NEEDS_KOREY).
- **Chat delivery is polling (every 3 s)**, not push. Supabase Realtime broadcast from the artist console comes with Phase 3; the local stand-in has no realtime, so polling is also what the tests exercise.
- **Report** records a pseudonymous journey event with the show and playback moment; the real safety queue is Hardening (PRD 157).
- **Reactions** are the agreed placeholder tab beside emoji: free emoji reactions, stamped with playback position and the artist slot, no design yet (on hold per the decision).
- **Viewer counts** are derived from metering heartbeats in the last 45 seconds (not from YouTube's concurrent figure, which needs the API connection from Phase 3).
- **Picture-in-picture, native sound defaults, deep links** are native (Phase 4).
- **The YouTube PlayerSource** is implemented against the IFrame API from the privacy-enhanced domain but could not be exercised here: this sandbox has no outbound access to YouTube. The e2e test covers the consent gate around it, not playback. First real check is a staging show with a real video id.
- **Feed ranking** is computed per request; the precomputed read model (Scaling tab row 19) is later.
- **Rate limiting** is the existing per-instance limiter on every open route; a shared store is Hardening work.

## Test results

- `npm test` (node): 26 tests, all pass. Covers layout invariants at 15 sizes x 5 modes, the fixture player clock and the three Versus views, delay alignment at 3/5/8/10 s, the guest preview meter, sign-up rules (18 on the day, leap days, under-18 never returned), and Support properties (double tap pays once, legs sum to zero, 72.5%, limits fail closed, unauditable support reported).
- `scripts/db/run-sql-tests.sh`: 2 files, all pass. Audit log access (every role incl. negatives, chain intact) and Phase 2 access (public_profiles hides owner fields, support/metering/journey/reminders per role, one vote per account, show constraints).
- `npm run e2e` (browser): 20 steps, 20 pass on the final run (see `docs/STATUS.md` if it was updated later). Earlier runs found and fixed: a CORS gap in the local stand-in, the cookie banner sitting over the player on the show screen (now never shown there), and seeded prompts closing before the suite reached them.
- Build and lint: clean.

## Technical notes

PRD rows: 42, 43, 44, 50, 53, 55, 56 (partly: no threaded replies yet), 58, 61, 62 (test mode), 66, 68, 90, 91, 92, 93, 94, 95 (web gestures), 96, 97, 98, 99, 100 (viewer side), 101, 102 (placeholder tab), 103, 104, 106, 107, 108, 143, 144, 165, 175. Scaling areas: Real-time media (the embed behind PlayerSource), Rate limiting, Database, Auth, Observability.

Migrations: `20261002010000` shows delivery columns; `20261002010100` playback position, one vote per account, grace window; `20261002010200` support_events (money, protected); `20261002010300` metering, journey, reminders; `20261002010400` public_profiles view and the end of the public-artists policy (RLS, protected). Rollbacks for each, rehearsed down and up.

Code map: `lib/player/` (PlayerSource contract, youtube, llhls stub, fixture, layout geometry), `lib/alignment.js`, `lib/guestPreview.js`, `lib/consent.js`, `lib/telemetry.js` + `lib/correlation.js`, `lib/support.js` (store interface, real store), `lib/audit.js`, `lib/signupRules.js`, `lib/metering.js`; `app/api/viewer/*` and `app/api/events`; `components/viewer/*`; pages `/discover`, `/live`, `/search`, `/show/[id]`, `/signup`, `/login`, `/onboarding`, `/u/[username]` (+ `/@username` via middleware), `/wallet`. The pilot's front door and LiveKit show screen moved to `/pilot` and `/pilot/live`; `/live?show=` still reaches the pilot screen.
