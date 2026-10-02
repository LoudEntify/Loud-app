# Needs Korey

Claude Code adds blockers here with exact steps. Tick them off, then tell Claude Code "NEEDS_KOREY updated" in the session.

## Blocking right now: the staging database URL has the wrong password

The `staging` workflow originally failed at "Apply migrations to staging" with "Access token not provided" — it was still using `supabase link` with an account-wide personal access token. Fixed: `.github/workflows/staging.yml` and `promote.yml` now connect straight to each environment's own database with `supabase db push --db-url`, never a token that can see every Supabase project in the account, guarded by a repository variable that checks the URL points at the right project before anything runs.

- [x] **`STAGING_PROJECT_REF` repository variable** — set (value `htepkxumrwtpbkahdric`, this didn't need a credential I don't have, so I set it myself rather than asking you to).
- [x] **`SUPABASE_STAGING_DB_URL` secret** — already exists on the `staging` environment (someone added it before this session). The guard step confirms it points at the right project (`postgres.htepkxumrwtpbkahdric` in the hostname/username, matching the ref above).
- [ ] **But the password in it is wrong.** The workflow run got past the guard, reached the database, and failed with `password authentication failed for user "postgres" (SQLSTATE 28P01)` — a real connection attempt with the wrong password, not a missing secret. Fix: open the `loudentify-staging` Supabase project at supabase.com/dashboard → Project Settings → Database → **Connection string** → **URI** tab → copy the string and replace `[YOUR-PASSWORD]` with the actual database password (Project Settings → Database → Reset database password if you don't have it noted down — resetting it is safe, nothing is using the old one successfully anyway). Then: github.com/LoudEntify/Loud-app → Settings → Environments → **staging** → Environment secrets → `SUPABASE_STAGING_DB_URL` → **Update** → paste the corrected connection string → Update secret.
- [ ] **After updating it**, the workflow will re-run automatically on the next push to `staging`, or you can re-run it by hand: github.com/LoudEntify/Loud-app → Actions → "staging" workflow → pick the latest failed run → **Re-run all jobs**.
- [ ] **Once you have a production Supabase project, add its ref as a repository variable the same way**: Settings → Secrets and variables → Actions → Variables tab → New repository variable → name `PRODUCTION_PROJECT_REF`, value = the project ref from that project's URL/settings (the short ID, same place staging's came from).
- [ ] **And its database URL as a secret on the `production` environment**: same Connection string steps as above, on the production project, then Settings → Environments → **production** → Environment secrets → Add secret → name `SUPABASE_PRODUCTION_DB_URL`.
- [ ] **Delete the now-unused secrets**, so nothing stale is sitting there: on the `staging` environment, remove `SUPABASE_ACCESS_TOKEN`, `SUPABASE_STAGING_PROJECT_REF`, `SUPABASE_STAGING_DB_PASSWORD`, `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, `STAGING_ALIAS_DOMAIN`, `STAGING_SMOKE_EMAIL`, `STAGING_SMOKE_PASSWORD`, `VERCEL_AUTOMATION_BYPASS` if any were already added — none of them are read by the workflow anymore. Same list (with `PRODUCTION_` names) on the `production` environment once it exists.
- [ ] **Watching staging deploy**: the workflow no longer drives a Vercel deploy itself — Vercel's own Git integration already deploys every push automatically (confirmed working since 29 Aug). A push to `staging` produces a preview deployment at a URL like `loud-app-git-staging-korey-alashe.vercel.app`; find it in the Vercel dashboard (vercel.com) under the `loud-app` project's Deployments tab. That URL sits behind Vercel's own login (everything except the `loudentify.app` custom domains does) — since you're signed in there already, this isn't an extra step for you, just not something this workflow can check automatically without a secret it no longer holds.

## Staging deploy now reads its own Supabase variables (nothing to do unless the staging build goes red)

`next.config.js` now maps the Preview variables you set on Vercel (`STAGING_SUPABASE_URL`, `STAGING_SUPABASE_PUBLISHABLE_KEY`, scoped to the `staging` branch) onto the app's `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`, overriding the pilot's values, but only on the Vercel Preview build of the `staging` branch. Production, local and every other branch behave exactly as before. `SUPABASE_SERVICE_ROLE_KEY` is read as-is on the server, no mapping needed.

A safety guard fails the build on purpose if any Preview build, or any `staging` build, would point at anything other than the staging project (`htepkxumrwtpbkahdric`). Production is never guarded.

- [ ] **If the next `staging` deploy on Vercel fails** with a message starting `[supabaseBuildEnv] Refusing to build`, the message says which variable is wrong. Check: vercel.com → `loud-app` project → Settings → Environment Variables → the two `STAGING_*` variables exist, environment **Preview**, branch **staging**, and the URL is `https://htepkxumrwtpbkahdric.supabase.co`. Then Deployments → latest → **Redeploy**.
- [ ] **Also check once**: Settings → Environment Variables → "Automatically expose System Environment Variables" is ticked (it is by default). The override and guard key off Vercel's `VERCEL_ENV` and `VERCEL_GIT_COMMIT_REF`; if that box is off, neither runs and the staging deploy would quietly build against the pilot values again.
- [ ] **Heads-up on other preview branches**: any feature-branch preview on Vercel will now also fail its build unless its `NEXT_PUBLIC_SUPABASE_URL` is the staging project — the guard treats every Preview as "must be staging". That is intended (no preview should ever hit the pilot or production data). If you want feature-branch previews to work, change the Preview-scoped (all branches) `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` on Vercel to the staging project's values too.

## Branch protection — `main` done, `staging` still open

- [x] `main` is protected (checked via the GitHub API): requires a pull request with at least one approval, blocks force-push and deletion. Good — matches `docs/CLAUDE.md` §2 ("never force-push, never rewrite history on staging or main").
- [ ] `staging` has no protection yet (same check returns "Branch not protected") — anyone (or any workflow) with write access can still push straight to it with no required CI check. Settings → Branches → Add branch ruleset/rule for `staging` → require the `ci` status check to pass before merging. Not urgent (this session still had to open a real PR for this very fix, by choice, matching `docs/CLAUDE.md`'s flow) but worth closing so it's enforced rather than just followed.

## Reviews needed before promotion

Protected-path changes under `docs/CLAUDE.md` §2 (money, identity, permissions/RLS, the audit log) that `.github/workflows/promote.yml` refuses to promote to production until each is ticked here, with Ugo or Korey's name next to it.

- [ ] Organisation/role model, and the genesis migration that captures `shows`/`show_slots`/`participants` creation and RLS as versioned SQL for the first time — risk if wrong: a permission bug here is the classic breach between two users' data, and `participants` holds raw email PII. Reviewer: _____
- [ ] The append-only, hash-chained audit log — risk if wrong: the one system meant to prove nothing was tampered with becomes the thing that's wrong. Reviewer: _____
- [ ] Extending the ledger to true double-entry pairs — risk if wrong: this is money; a bug here can create or lose balance silently. Reviewer: _____
- [ ] Consent / training-data-choice records and their audit trail — risk if wrong: the legal basis for AI-director training depends on this being recorded correctly and changeable at any time. Reviewer: _____
- [ ] `20261002010200_phase2_support_events.sql` and `lib/support.js` — Support with tokens (money). Risk if wrong: a viewer could be charged twice, the artist share could be mis-recorded, or tokens could be created. Covered by `tests/support.test.mjs` (double tap pays once; legs sum to zero; 72.5%; limits) and the browser e2e. Reviewer: _____
- [ ] `20261002010400_phase2_public_profiles.sql` — replaces the pilot's public-artists policy with the `public_profiles` view (RLS/permissions). Risk if wrong: either artists vanish from Discover (view too strict) or owner fields leak (view too wide). Covered by `supabase/tests/phase2_access.sql`. Reviewer: _____
- [ ] `app/api/viewer/signup/route.js` — account creation, consent records, organisation of one, audit entry (identity). Risk if wrong: an under-18 account, or an account without its consent record. Covered by `tests/signup.test.mjs` and the e2e under-18 check. Reviewer: _____
- [ ] `20261002020000_phase3_identity_youtube_broadcasts.sql` + `lib/youtube/*` — the identity store for YouTube tokens and stream keys (identity). Risk if wrong: an artist's Google token readable by a signed-in user, or a stream key logged. Covered by `supabase/tests/phase3_access.sql` (no client role reaches the schema or the secret doors; status never returns token columns) and `tests/youtube.test.mjs` (per-tenant encryption). Reviewer: _____
- [ ] `lib/pipeline/lifecycle.js` + the artist show routes — show control and the audit entries for every connect, broadcast create/start/end/private, key rotation, view change and stage request (audit log consumers). Risk if wrong: a show that cannot be reconstructed afterwards. Covered by `tests/pipeline.test.mjs` and the artist e2e. Reviewer: _____
- [ ] `20261002030000_phase5_site_messages.sql` + `app/api/site/contact/route.js` — the contact form's table (RLS on, zero policies, service-role writes only) and its public, rate-limited route. Risk if wrong: a stranger's name, email and message readable through the Data API, or the form open to flooding. Covered by `supabase/tests/phase5_access.sql` and the site e2e (honeypot, validation, one row per send). Reviewer: _____
- [ ] `20261002000100_audit_log_lockdown.sql` — explicit REVOKEs on the audit schema and the one service-role-only write function (`record_audit_event`). Risk if wrong: either the app cannot write audit entries at all (we would be operating blind and the alert in ARCHITECTURE.md should fire), or the function is callable by a signed-in user, who could then write fake audit rows. Both cases are covered by `supabase/tests/audit_log_access.sql`, which CI runs on every push. Reviewer: _____

## Phase 2 (viewer web app) — things only you can do

- [ ] **Apple and Google sign-in.** The sign-up sheet shows both buttons disabled. Apple: developer.apple.com → Certificates, Identifiers & Profiles → Identifiers → add a Services ID for `loudentify.app`, enable "Sign in with Apple", set the return URL to `https://htepkxumrwtpbkahdric.supabase.co/auth/v1/callback`; then in the Supabase dashboard → Authentication → Providers → Apple → paste the Services ID, Team ID, Key ID and the private key. Google: console.cloud.google.com → APIs & Services → Credentials → Create OAuth client (Web) with the same callback URL; Supabase → Providers → Google → paste client id and secret. Tell Claude Code "Apple and Google providers are on" and the buttons get wired (about an hour of work).
- [ ] **Payment provider.** Token purchase runs in test mode until one is chosen (Stripe is what `lib/paymentProvider.js` already supports; set `STRIPE_SECRET_KEY` on Vercel staging and it switches over). Decide, and the webhook/secret steps follow.
- [ ] **A real YouTube video id for the staging demo.** The seeded "Amapiano late set" show uses a public YouTube video as a stand-in. Any public, embeddable video id works for the demo until an artist's own broadcast exists (Phase 3). Set it in the Supabase table editor on the `shows` row (`youtube_video_id`), or leave it.
- [ ] **Device checklist for this build** (docs/CLAUDE.md §7 — your gate, on real phones, against the staging URL once migrations are applied):
  1. Open `/discover` signed out on your phone. Does the first card show a live show and does "Join the show" open it?
  2. On the show: is the picture fully visible with nothing over it? Tap Bigger, then "Open chat" — still nothing over it?
  3. Tap Vote while signed out: does the sign-up sheet rise with the picture still playing beside it?
  4. Sign up with a throwaway email. Enter a date of birth that makes you 17: do you get the kind stop screen?
  5. Signed in: vote, send a comment, tap Follow, tap Support (go to `/wallet` first and get test tokens). Did the thank-you appear once, and did the wallet go down once?
  6. Open the Versus show: A vs B at the top, "Who moved you this round?" with both names. Tap one.
  7. Open the starting-soon show: countdown, "Chat is open early", Remind me.
  8. Turn on airplane mode mid-show: an orange bar at the top, the screen still readable; turn it off: the bar goes.
  9. On a tablet or a laptop: chat sits beside the picture, nothing over it.

## Phase 3 (artist and live pipeline) — things only you can do

- [ ] **Google OAuth client for the YouTube connection** (after the verification steps below have at least started). In the Google Cloud project: APIs & Services → Credentials → Create credentials → OAuth client ID → Web application → Authorised redirect URIs: `https://<staging-domain>/api/artist/youtube/callback` and later `https://loudentify.app/api/artist/youtube/callback`. Copy the client id and secret into Vercel (loud-app project → Settings → Environment Variables, scope Preview for staging first): `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`. Until these exist the app runs in **mock mode** (a mock channel that behaves like a real one), which is what the tests use.
- [ ] **`YOUTUBE_TOKEN_KEY` secret** (32+ random characters) in Vercel for the same scopes. It is the master key the per-artist token encryption derives from. Generate it with a password manager; never reuse it between staging and production; if it is ever rotated, every artist reconnects (that is the containment action working as intended).
- [ ] **LiveKit egress credentials** for the real compositor/egress: `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_URL` already exist for the pilot; set `EGRESS_MODE=livekit` on Vercel when you want the real egress instead of the file-writing test double. The real room-composite-to-RTMP wiring is the next engineering step once a real broadcast exists to point it at.
- [ ] **Identity-check provider and payout provider** are still not chosen (PRD 138). Earnings and cash-out run against stubs: the identity step shows "not started", cash-out is gated on `kyc_status = verified` which nothing sets yet.
- [ ] **Device checklist for this build** (artist side, on your phone against staging once migrations are applied; use a performer account):
  1. Sign up as a performer. Does onboarding show six steps, and does "Connect YouTube" connect a mock channel and say live streaming is enabled?
  2. Book a show for 29 minutes from now: refused? For 31 minutes: booked, with "Your YouTube broadcast is created and waiting"?
  3. Open Kit Check from the booking: does your own camera show in the three crops (Conversation, Performing, Corner)? Does "Camera" turn green after two minutes, and "Mic signal" when you speak?
  4. Stay in Kit Check until the slot: do you go live on your own and land in the console?
  5. In the console: is the composed picture your camera with the mark top-left? Does "DELIVERING" show? Push a vote; open the show on a second phone as a viewer: does the vote card appear?
  6. Fix sheet: switch the microphone; does the show carry on?
  7. Press and hold End show: does the post-show page show the recording and let you set Public/Unlisted/Private?
  8. Versus (needs two performer accounts): invite the second, accept from its inbox, both open the console at slot time, tap Perform on the second: does the first get "Hand over the stage"? Accept: does the viewer's picture switch?

## Phase 4 (native apps) — every step that needs your Apple or Google account

The app is in `native/` (Expo). Cloud builds happen on Expo's EAS service; nothing is built on your laptop.

### Test the app on your phone with Expo Go (no Apple or Google account needed)

`native/` is now on Expo SDK 57, the same SDK as the Expo Go app from the App Store / Play Store, so it opens directly. Everything the app uses today is inside Expo Go; nothing needs a development build yet (the three things that will, later, are the LiveKit camera publishing, push notifications and Apple/Google sign-in).

- [ ] On a computer with Node 22 and this repo checked out on `staging`: create the file `native/.env` (it is git-ignored) with these three lines, then run `cd native && npm install && npx expo start`:
  ```
  EXPO_PUBLIC_SUPABASE_URL=https://htepkxumrwtpbkahdric.supabase.co
  EXPO_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_ocRnAxMgflUq-u4DtmRFSQ_2xQOtLec
  EXPO_PUBLIC_API_BASE=https://loud-app-git-staging-korey-alashe.vercel.app
  ```
  (The key is the staging project's *publishable* key, the one meant to live in client apps; it is not a secret. The app also opens with no `.env` at all, as a signed-out guest, so the first two lines only matter for log in and sign up.) Phone and computer on the same Wi-Fi; open Expo Go, scan the QR code the terminal shows. If the phone cannot see the computer, stop and run `npx expo start --tunnel` instead.
- [ ] **What to look at** (Discover and Live will show their "We couldn't load" error screens with a Try again button until the staging web deploy is reachable without Vercel's own login; that is expected, and the error state itself is one of the five states to check):
  1. The app opens on Discover with no red error box from Expo; the status bar text is light on the ink background.
  2. The bottom tab bar: Discover, Live, Profile (Create only appears for artist accounts); labels fully visible above the phone's home bar or navigation buttons, nothing clipped (this is the one layout change in the upgrade: Android is edge-to-edge now).
  3. Profile → "Sign up free" → the sign-up form. Enter a date of birth that makes you 17: the "You need to be 18" stop screen appears without any network call, and "I entered the wrong date" clears it. Enter nothing and press Continue: field errors appear under the fields.
  4. Profile → Log in → with the `.env` set, a wrong password shows "That email and password don't match." (that proves the phone reaches the staging Supabase project).
  5. Camera mode lives behind the Create tab, which only artist accounts see, and you cannot create an artist account from the phone until the staging web deploy is reachable. Until then open the screen directly: in Expo Go's home screen tap "Enter URL manually" and paste the `exp://...:8081` address the terminal shows with `/--/camera` on the end (for example `exp://192.168.1.20:8081/--/camera`). Then: the permission prompt uses our wording ("Loudentify uses the camera so this phone can be a camera for your show"), the viewfinder shows, Flip switches cameras, pointing at any QR code tries to pair (and shows "That code did not work" for a random code), and switching to another app and back shows the orange "Keep Loudentify in front" warning.
  6. Rotate the phone: the app stays portrait.
- [ ] Tell Claude Code what you saw (a screenshot of anything odd is ideal). Nothing in this list needs your Apple or Google accounts; the EAS steps below are still needed for a build you can install without Expo Go.


- [ ] **Expo account and project**: sign up at expo.dev (free), then on any computer with Node: `npm i -g eas-cli`, `cd native && npm install && eas login && eas init` (it writes the project id into `native/app.json` → `extra.eas.projectId`; commit that change).
- [ ] **Apple**: enrol in the Apple Developer Program (developer.apple.com, £79/yr, takes a day or two). Then `eas build --profile preview --platform ios` and answer "yes" when EAS offers to create the certificates and the App Store Connect app for bundle id `app.loudentify.ios` (EAS does it with your Apple ID). For TestFlight: `eas submit --platform ios` after filling `native/eas.json` → `submit.production.ios` (Apple ID, team id, the App Store Connect app id it created).
- [ ] **Google**: create a Google Play Console developer account (play.google.com/console, one-off fee). `eas build --profile preview --platform android` produces an APK you can install directly on an Android phone (Settings → allow installs from this source). For Play internal testing: create the app in the console with package `app.loudentify.android`, create a service account with Play Console access, download its JSON key as `native/google-play-service-account.json` (never commit it; it is gitignored), then `eas submit --platform android`.
- [ ] **Staging values for the app**: in `native/app.json` → `extra`, or as EAS secrets (`eas secret:create`): `EXPO_PUBLIC_SUPABASE_URL` = `https://htepkxumrwtpbkahdric.supabase.co`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` = the staging publishable key, `EXPO_PUBLIC_API_BASE` = the staging web URL. Production values only when promoting.
- [ ] **Store rule check before release**: whether the stores allow the sentence "Tokens are bought on loudentify.app" inside the app (docs/USER_JOURNEY.md handover note). If not, the sentence comes out; the balance stays.
- [ ] **Universal links**: `apple-app-site-association` and `assetlinks.json` on loudentify.app (Phase 5 serves them from `public/.well-known/`; they need your Apple team id and the Android signing certificate's SHA-256, which EAS shows after the first build: `eas credentials`).
- [ ] **Device checklist for the first native build** (your gate): install the preview build on an iPhone and an Android phone and try: 1. Discover plays the first live card and the 60-second chip appears at 50 s. 2. Join the show: the player is uncovered; vote, comment (sign-up rises). 3. Sign up with a throwaway email; a 17-year-old date gets the stop screen. 4. Profile shows the balance and no buy button anywhere. 5. Create → Use this phone as a camera: scan the code from the web Kit Check's Add camera; the viewfinder shows ON AIR/REHEARSAL. 6. Put the app in the background mid-camera: the warning shows when you return. 7. A `loudentify.app/show/...` link opens the app once universal links are in place.

## Phase 5 (website) — things only you can do

The website lives in the same app, on the session branch. On the Vercel preview for the branch you can click through all of it now. Nothing below blocks review; each one is a value only you have.

- [ ] **Pricing figures**: `docs/ARCHITECTURE.md` leaves viewer-hours and packs as an open v2 decision, so `/pricing` prints "to be set" with a DRAFT badge. When you decide, put the numbers in `lib/site/pricing.js` (five values: free viewer-hours, free show slots, cameras, and for each pack its price in pence, hours and slots). The page needs no other change.
- [ ] **Contact addresses**: in Vercel → Project → Settings → Environment Variables add `NEXT_PUBLIC_CONTACT_EMAIL_GENERAL`, `NEXT_PUBLIC_CONTACT_EMAIL_PRESS`, `NEXT_PUBLIC_CONTACT_EMAIL_ARTISTS`. Until then `/contact` shows "address to be confirmed" and the form still works (messages land in the `site_messages` table; read them in Supabase → Table Editor → site_messages, newest first; nothing is emailed yet because there is no mail provider).
- [ ] **Social links**: send the four handles (Instagram, TikTok, X, YouTube). Today the IG/TT/X/YT circles in the footer and on Contact go to `/contact`; the links live in `components/site/SiteShell.jsx`.
- [ ] **Store links**: when the apps are listed, add `NEXT_PUBLIC_APP_STORE_URL` and `NEXT_PUBLIC_PLAY_STORE_URL` in Vercel; `/get-app` then drops its "NOT YET LISTED" badge. The official badge artwork (Apple's and Google's, with their rules) replaces the CSS badges then: download from developer.apple.com/app-store/marketing/guidelines and play.google.com/intl/en_us/badges, put them in `public/badges/`, and swap the two `<a class="w-store">` blocks.
- [ ] **Universal links**: `public/.well-known/apple-app-site-association` needs your Apple team id in place of `TEAMID`, and `assetlinks.json` needs the Android upload key's SHA-256 (`eas credentials` shows it after the first build).
- [ ] **Hero images**: the home hero uses drawn shapes only. The design wants real artists who have agreed, never stock or AI images of real people; when you have photos and signed releases, they go in `public/hero/` and `app/page.js` places them.
- [ ] **Legal review**: every page under `/legal` and the cookie notice carries a DRAFT badge and `noindex`. A lawyer rewrites Terms, Community Guidelines and the Artist agreement (the training-data clause is in section 3 of the agreement and must stay a separate, off-by-default choice); the badge comes off by deleting `draft` in the four page files. The Terms say "law of England and Wales" and "14 days' notice": both are assumptions to confirm.
- [ ] **The production domain**: the website is at `/` on the branch, so promoting it to loudentify.app changes the front door from the pilot's doors (now at `/pilot`) to the website. That is your call, not mine (docs/CLAUDE.md: "do not change how loudentify.app currently runs"); until you promote, production is untouched.

## Blocking Phase 3 (YouTube delivery)

- [ ] **Start Google OAuth verification now, not when Phase 3 starts.** The YouTube Live Streaming scope is a "sensitive scope" under Google's OAuth verification process, with its own lead time (days to weeks) separate from engineering work. Steps: create a Google Cloud project, enable the YouTube Data API v3 and YouTube Live Streaming API, configure the OAuth consent screen (the `/privacy` page now live at loudentify.app/privacy is what you'll link from it), and submit for verification requesting the live-streaming scope.
- [ ] **Default YouTube API quota may be too low.** Once the Google Cloud project exists, check the default quota against the planning basis in `docs/YOUTUBE_ADDENDUM.md` ("up to 400 viewers per artist across 100+ concurrent streamers") and request an increase early if the default looks tight.

## Not blocking anything yet, but needed before launch

- [ ] **Logo image files for the design system.** `design/README.md` says logo images are referenced by internal ids but the actual image assets aren't in the `design/` folder (separate from the real logo PNGs already in `public/logo/` and used on `/privacy` — those exist; this is about the design reference files specifically).
- [ ] **Legal sign-off**: a Data Protection Impact Assessment, a Legitimate Interests Assessment for the AI-director training-data basis, and an Online Safety Act risk assessment all need a lawyer before launch.
- [ ] When the company is registered, update the Who we are paragraph on `/privacy`, the Google consent screen branding, and the terms.
- [ ] **`docs/Loudentify_PRD_User_Stories.xlsx` is still missing.** `docs/USER_JOURNEY.md` and `docs/SCREEN_INVENTORY.md` have landed (thank you) — `docs/EXPORT_THESE_HERE.md` is still here as a reminder to export the PRD spreadsheet too and then delete that file. Every PR is supposed to cite PRD rows from it (`docs/CLAUDE.md` §1) and still can't.
- [ ] **What's in the `loudentify-build-pack (1)` folder at the repo root?** Looks like leftover source material `design/`/`docs/CLAUDE.md`/etc. were originally copied from — safe to delete if it's no longer needed.
## Privacy page (`/privacy`) — live on loudentify.app

- [ ] **A solicitor must review the privacy policy before launch.** `/privacy` is temporary, plain-English content used as written — not legal advice and not yet checked by a lawyer. `docs/ARCHITECTURE.md` already flags the training-data section for legal sign-off; this page goes to the same review before Loudentify relies on it in front of real users or regulators.
- [x] Merged `feature/privacy-page` into `main` (PR #1) — the page is live. This overnight branch carries the same page so staging keeps it too.

