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

