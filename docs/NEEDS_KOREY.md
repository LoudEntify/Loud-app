# Needs Korey

Claude Code adds blockers here with exact steps. Tick them off, then tell Claude Code "NEEDS_KOREY updated" in the session.

## Blocking right now: the staging pipeline's new secrets/variables

The `staging` workflow failed at "Apply migrations to staging" with "Access token not provided" — it was still using `supabase link` with an account-wide personal access token. Fixed: `.github/workflows/staging.yml` and `promote.yml` now connect straight to each environment's own database with `supabase db push --db-url`, never a token that can see every Supabase project in the account. This needs two new things per environment: one secret (the database connection string) and one plain repository variable (the project ref, used only to double-check the URL points at the right project before anything runs).

- [ ] **Add the repository variable for staging** (this ref is already known — `htepkxumrwtpbkahdric`): github.com/LoudEntify/Loud-app → Settings → Secrets and variables → Actions → **Variables** tab → **New repository variable** → name `STAGING_PROJECT_REF`, value `htepkxumrwtpbkahdric` → Add variable.
- [ ] **Add the staging database URL secret**: open your `loudentify-staging` Supabase project at supabase.com/dashboard → Project Settings → Database → **Connection string** → choose **URI** → tick "Use connection pooling" off (direct connection) → copy it and replace `[YOUR-PASSWORD]` with the real database password. Then: github.com/LoudEntify/Loud-app → Settings → Environments → **staging** → Environment secrets → **Add secret** → name `SUPABASE_STAGING_DB_URL`, paste the full connection string as the value.
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

## Blocking Phase 3 (YouTube delivery)

- [ ] **Start Google OAuth verification now, not when Phase 3 starts.** The YouTube Live Streaming scope is a "sensitive scope" under Google's OAuth verification process, with its own lead time (days to weeks) separate from engineering work. Steps: create a Google Cloud project, enable the YouTube Data API v3 and YouTube Live Streaming API, configure the OAuth consent screen (the `/privacy` page now live at loudentify.app/privacy is what you'll link from it), and submit for verification requesting the live-streaming scope.
- [ ] **Default YouTube API quota may be too low.** Once the Google Cloud project exists, check the default quota against the planning basis in `docs/YOUTUBE_ADDENDUM.md` ("up to 400 viewers per artist across 100+ concurrent streamers") and request an increase early if the default looks tight.

## Not blocking anything yet, but needed before launch

- [ ] **Logo image files for the design system.** `design/README.md` says logo images are referenced by internal ids but the actual image assets aren't in the `design/` folder (separate from the real logo PNGs already in `public/logo/` and used on `/privacy` — those exist; this is about the design reference files specifically).
- [ ] **Legal sign-off**: a Data Protection Impact Assessment, a Legitimate Interests Assessment for the AI-director training-data basis, and an Online Safety Act risk assessment all need a lawyer before launch.
- [ ] When the company is registered, update the Who we are paragraph on `/privacy`, the Google consent screen branding, and the terms.
- [ ] **`docs/Loudentify_PRD_User_Stories.xlsx` is still missing.** `docs/USER_JOURNEY.md` and `docs/SCREEN_INVENTORY.md` have landed (thank you) — `docs/EXPORT_THESE_HERE.md` is still here as a reminder to export the PRD spreadsheet too and then delete that file. Every PR is supposed to cite PRD rows from it (`docs/CLAUDE.md` §1) and still can't.
- [ ] **What's in the `loudentify-build-pack (1)` folder at the repo root?** Looks like leftover source material `design/`/`docs/CLAUDE.md`/etc. were originally copied from — safe to delete if it's no longer needed.
