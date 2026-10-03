# Document index

3 October 2026, from the `staging` branch at `b962ff6`. Every file and folder a person would need to know about, grouped, with one line each: what it is for, who should read it, and whether it is current, historical or superseded.

- **Current**: describes the product or the process as it is now. Keep reading it.
- **Historical**: a true record of a past round, still useful for the reasoning. Do not act on it as a to-do.
- **Superseded**: replaced by a named document. Candidate for archiving.

Nothing has been moved or deleted. Recommendations are at the end.

Reader codes: **K** Korey, **U** Ugo, **A** the build agent.

---

## 1. Standing rules and the build standard (read first)

| File | What it is for | Readers | Status |
|---|---|---|---|
| `docs/CLAUDE.md` | The standing instructions every build session reads first: autonomy, environments and release flow, migrations, architecture rules, settled product decisions, design tokens, testing gates. | K U A | Current |
| `docs/ARCHITECTURE.md` | The build standard, version 2 (1 October 2026): roles, data isolation, audit log, privacy, training-data basis, money, live media and YouTube delivery, safety, performance, reliability, how we build, order of work, risk list. Wins on detail. | K U A | Current |
| `docs/YOUTUBE_ADDENDUM.md` | The product behaviour of YouTube delivery: composed picture, the three Versus views, viewer screen rules, delay, metering, quota and verification. Wins over older docs on viewer delivery. | K U A | Current |
| `docs/BUILD_PLAN.md` | The six-phase plan (foundations, viewer web, artist and pipeline, native, website, hardening) with a status line per phase as of 2 October. | K U A | Current |
| `docs/USER_JOURNEY.md` | The user journey and app map (29 September, decisions of 30 September): principles, roles, eight journeys, settings map, website pages, handover notes for Ugo. YouTube addendum and architecture v2 override it on delivery and Versus. | K U | Current |
| `docs/SCREEN_INVENTORY.md` | Every designed screen board, grouped by flow, with surface; board names match the files in `design/`. | U | Current |
| `docs/Loudentify_PRD_User_Stories (4).xlsx` | The product requirements spreadsheet: 176 user stories with a "Build plan phase (v2)" column, a change log of 1 October, a legend, and a Scaling and Infrastructure sheet of 24 rows. Every pull request cites its row ids. | K U A | Current. `docs/CLAUDE.md` cites it without the "(4)" suffix. |
| `docs/PROMPTS.md` | The eight prompts Korey sends to cloud build sessions, one per phase. | K | Current |

## 2. Where things stand and what needs a human

| File | What it is for | Readers | Status |
|---|---|---|---|
| `docs/HANDOVER_UGO.md` | This handover pack: environments, philosophy, pilot, staging build, the to-do table, first week, commands, glossary, unverified items. | K U | Current (3 October) |
| `docs/STATUS.md` | End-of-run status for the 2 October overnight build: test results, a per-PRD-row table, risks, the morning checklist. | K U | Current for the per-row table; stale on the staging database (it was migrated later that day) and the unit test count (66, not 42). |
| `docs/NEEDS_KOREY.md` | Every blocker that needs a human, with click-by-click steps, and the "Reviews needed before promotion" list that `promote.yml` checks. | K U | Current, except the top section on the staging password, which is resolved, and the line saying the PRD spreadsheet is missing. |
| `docs/DECISIONS.md` | One line per decision for the rebuild, from 1 October 2026 onward: date, decision, reason, rejected option. | K U A | Current |
| `docs/PHASE_2_HANDOFF.md` | What the viewer web build does, how to try it, what is stubbed, test results, code map. | K U | Current |
| `docs/PHASE_3_HANDOFF.md` | The same for the artist experience and live pipeline, including what runs on test doubles. | K U | Current |
| `docs/PHASE_4_HANDOFF.md` | The same for the native app, with the Expo SDK 57 update. | K U | Current |
| `docs/PHASE_5_HANDOFF.md` | The same for the website. | K U | Current |
| `docs/REPO_AUDIT.md` | Step 1 of the rebuild (1 October): what exists, what is reused as-is, what needs adapting, what is missing, the real state of the data layer. | U A | Current, with two self-corrections recorded in `docs/DECISIONS.md` (RLS findings) and one small error (canvas board count). |
| `docs/EXPORT_THESE_HERE.md` | A reminder to export three documents into `docs/`. All three have arrived. | K | Superseded. Delete. |

## 3. The pilot record (July to September 2026)

The authoritative pilot handover is `docs/HANDOVER.md`. The rest are audits, plans, run sheets and test scripts from specific rounds.

| File | What it is for | Readers | Status |
|---|---|---|---|
| `docs/HANDOVER.md` | The technical handover of 5 September 2026 at `main` `9a9ccb4`: what is built and device-tested, what is parked (B-roll), what is outstanding (owner-column surfaces, CPU attribution, reconnects), the engineering rules and the failures behind them, the server-compute question. Opens with the single-database warning that no longer applies. | U | Historical. Still the best account of the pilot code; its "outstanding" section is still open work. Its environment section is superseded by `docs/CLAUDE.md` section 2. |
| `docs/PILOT_EVIDENCE_AUDIT.md` | Read-only trace (10 September) of what the pilot persisted: chat ephemeral, reactions unattributed, no actual start time, only the egress webhook handled; plus a 16-query SQL pack to run on the pilot database. | U | Historical. The SQL pack is still the way to extract pilot evidence, run by a human on the pilot project. |
| `docs/PILOT_2_PLAN.md` | The six-piece instrumentation plan for the 20 September show, with pilot-1 findings (the 6h26m room, reactions unattributed). | U | Superseded by `docs/PILOT_2_BUILD_PLAN.md`, which says so. |
| `docs/PILOT_2_BUILD_PLAN.md` | The eleven-item build plan for pilot 2 with the day-by-day record through 14 September, the cuts, the verification query pack and the answered decisions. | U | Historical. The authoritative pilot-2 scope. Internally inconsistent on which items were cut and on migration numbering. |
| `docs/PILOT_2_MIGRATIONS.md` | The runner for the eight `pilot2_*` SQL files and the conflict-target fix, with the show-id namespace warning. | U | Superseded by `supabase/migrations/` (the same files are now `20260818003500` to `20260818004300`). |
| `docs/SATURDAY_REHEARSAL.md` | The run sheet for the 19 September dress rehearsal on production, with the SQL that proves each step. No results recorded. | K U | Historical |
| `docs/BUILD_AUDIT_2026-08.md` | Ground-truth feature inventory at `main` `3b80017` (19 August) with status labels and the audio-only-recordings incident account. | U | Superseded by `docs/PRD_RECONCILIATION_2026-08-25.md` and then `docs/REPO_AUDIT.md`. The incident account in section F is still worth reading. |
| `docs/PRD_RECONCILIATION_2026-08-25.md` | Status per PRD category after overnight build 2, plus about 40 new requirements that build introduced. | U | Superseded by `docs/REPO_AUDIT.md` and `docs/STATUS.md`. |
| `docs/SECURITY_AUDIT_2026-08-28.md` | Security sweep of all 31 API routes then present: the critical camera-token hole, the egress routes, the cue-sheet IDOR, closure table, and the checks added (`check:routes`, `probe:auth`, `smoke`). | U | Historical. All findings closed the same day; the checks it added are current. |
| `docs/WRITE_PATH_AUDIT.md` | Every write path the overnight product round added, by call site, and the `pilot-room` hard-coding finding (closed). | U | Historical |
| `docs/MORNING_BRIEF.md` | Plain-English summary of overnight build 2 (25 August): rig pairing, onboarding, data export, money, recording verification. | K | Historical. Some positions reversed later (device secret persistence). |
| `docs/MORNING_MIGRATIONS.md` | Paste-and-verify runner for the 11 `overnight2_*` SQL files with expected outputs and an RLS sweep. | U | Superseded by `supabase/migrations/`. |
| `docs/OVERNIGHT2_DEVICE_TEST.md` | The ordered device-test script (sittings 0 to 8) for overnight build 2 and the camfeed round; mostly checkboxes, few results. | K | Historical |
| `docs/INTERRUPTION_FEASIBILITY.md` | What the web platform can honour when a call, minimise or lock interrupts a show; iPhone Chrome evidence; the two approved rules; what is still owed (Android, iOS Safari). | U | Current for the pilot code's interruption behaviour; the owed runs are still owed. |
| `docs/SMOKE_TEST.md` | Explains `npm run smoke`, the signed-in check that gated pages render, and the test account. | U | Current |
| `docs/SHOT_INTEGRATION_LIVEDEMO.md` | The v3 spec for wiring the shot grammar and auto director into `LiveDemo.jsx`. | U | Superseded by the built code (`lib/autoDirector.js`, `lib/trackSources.js`); its 45-second cooldown rule was removed. |
| `docs/day2_accounts_test_script.md` | Manual test script for profile edit, recordings library, public profile and the private-recording gauntlet (Accounts Day 2, August). | K | Historical |
| `docs/go_live_threading_test_script.md` | The "spine test": a scheduled show in its own room, recorded, watched by someone with a link. | K | Historical |
| `docs/health_events_test_script.md` | Two-device test script for the `health_events` instrumentation (refresh, publish failure, Bluetooth, wifi kill, auto-lock). Says production was served from `pilot-freeze-v3` at the time. | U | Historical |
| `docs/*.sql` (57 files) | The pilot-era migrations and runbooks that were pasted into the Supabase SQL editor by hand. 43 of them are the source of `supabase/migrations/20260818000100` to `20260818004300` (`health_events`, `cue_sheets`, `profiles`, `ownership`, `recordings`, `scheduling`, `show_access`, `wallet`, `broll`, `age_policy`, `write_path_fixes`, `overnight2_01` to `_12`, `mvp1_01`, `mvp2_01` to `_04`, `mvp3_01` to `_03`, `pilot2_01` to `_08`, `pilot2_env_stamp`). The other 14 are pilot-2 runbooks and verification queries (`pilot2_sunday_show`, `pilot2_create_versus_show`, `pilot2_vote_test_show`, `pilot2_clear_test_votes`, `pilot2_retire_duplicate_show`, `pilot2_preflight_state`, `pilot2_fix_conflict_targets`, `pilot2_issue2_wide_shot_numbers`, `pilot2_item1_verification`, `pilot2_item2_stale_pairing_cleanup`, `pilot2_item3_verification`, `pilot2_item4_verification`, `pilot2_item5_item6_verification`, `reset_accounts`). | U | Superseded by `supabase/migrations/` and `supabase/rollbacks/`. Keep the 14 runbooks for the pilot record; the 43 migration sources are duplicates of what is now under version control. Never run any of them. |

## 4. Root-level documents from the earliest pilot

| File | What it is for | Readers | Status |
|---|---|---|---|
| `README.md` | The original pilot scaffold readme (last changed 19 August): how to run, what the first pilot UI did, the visual pass, multi-camera, two demo versions. | U | Superseded by `docs/HANDOVER_UGO.md` section H and `docs/PHASE_2_HANDOFF.md`. Should be rewritten to point at the current docs. |
| `DECISIONS.md` (root, 134 KB) | The pilot-era narrative decision log, 25 August to 5 September 2026 and the undated overnight product round before it: every judgment call with its reasoning. Does not overlap with `docs/DECISIONS.md`. | U | Historical. Keep; search it before reopening anything about the pilot code. |
| `CLAUDE_CODE_PROMPT.md` | The very first prompt for the pilot scaffold ("hand this to Ugo"): wire the demo to LiveKit. | nobody | Superseded by `docs/PROMPTS.md`. Archive. |
| `Loudentify_Pilot_UI_Spec.md` | The week-one pilot UI spec: versus divider, reaction bar, go-loud, audio case 2. | nobody | Superseded by `docs/USER_JOURNEY.md` and `design/`. Archive. |
| `MULTI_PERFORMER_SPEC.md` | The spec for the second performer slot, `participants` and `show_slots` tables, egress following the show. The only origin of those two tables' SQL, now captured in the genesis migration. | U | Superseded by `supabase/migrations/20260801000000_genesis_shows_show_slots_participants.sql` for the schema and by the Versus code for the behaviour. Archive after confirming the genesis migration matches. |
| `SHOW_LIFECYCLE_SPEC.md` | The spec for the show state machine and the `shows` table. The only origin of the `shows` SQL, now in the genesis migration. | U | Superseded, as above. Archive after the same check. |
| `VISUAL_SYSTEM_HANDOFF.md` | The palette, font and button rules extracted from the first design prototypes, plus a restyle prompt for four screens. | U | Superseded by `docs/CLAUDE.md` section 6 and `design/`. The tokens survive in `lib/design/tokens.js`. Archive. |
| `interruption-ios-chrome.csv` | The raw iPhone Chrome probe export (3 September, 486 rows) behind `docs/INTERRUPTION_FEASIBILITY.md` section 4.1. Deliberately tracked. | U | Current evidence |

## 5. Design

| File | What it is for | Readers | Status |
|---|---|---|---|
| `design/README.md` | How to read the boards: sizes, groups, the YouTube variant wins for viewers, square brackets are data. | U A | Current |
| `design/canvas.json` | The canvas manifest: 106 boards with titles and positions under 18 row headings. | U | Current |
| `design/*.dc.html` (106 files) | One approved screen per file at real size (phone 390, Fold and tablet 768, computer and website 1440). Reference markup, not production code. `YT-*` and `WebYT-*` are the YouTube viewer and artist variants. | U A | Current. The logo image assets they reference are not in the folder. |

## 6. Workflows (GitHub Actions)

| File | What it is for | Readers | Status |
|---|---|---|---|
| `.github/workflows/ci.yml` | On every push and pull request: `check` (migrations from scratch on Postgres 16, SQL suites, lint and route auth check, 66 unit tests, build), `e2e` (39 browser steps), `native` (Expo dependency check, doctor, bundle export). No secrets. | U A | Current |
| `.github/workflows/staging.yml` | On every push to `staging`: `npm run check`, a guard that the database URL names the staging project, `supabase db push`, `supabase migration list`. Uses `SUPABASE_STAGING_DB_URL` and `STAGING_PROJECT_REF`. Node 20. | U A | Current |
| `.github/workflows/promote.yml` | Manual: refuses if any protected-path review is unticked in `docs/NEEDS_KOREY.md`; then under the `production` environment, fast-forwards `main` to `staging`, pushes, applies migrations to production. Uses `SUPABASE_PRODUCTION_DB_URL` and `PRODUCTION_PROJECT_REF`. Never run yet. Node 20. | K U | Current |

## 7. Database (`supabase/`)

| File or folder | What it is for | Readers | Status |
|---|---|---|---|
| `supabase/migrations/` (59 files) | The versioned schema history. `20260801000000` genesis; `20260818000100` to `004300` the 43 pilot-era files; `20261001160000` to `160500` Phase 1 (organisations, audit log, double-entry ledger, consent, data classification, correlation ids); `20261002000100` audit lockdown; `20261002010000` to `010400` Phase 2; `20261002020000` and `020100` Phase 3; `20261002030000` Phase 5. All applied on staging. | U A | Current |
| `supabase/rollbacks/` (59 files) | One rollback per migration, same name. Some refuse on purpose when real rows exist. | U A | Current |
| `supabase/tests/` (4 files) | SQL permission suites run in rolled-back transactions: `audit_log_access.sql`, `phase2_access.sql`, `phase3_access.sql`, `phase5_access.sql`. | U A | Current |
| `supabase/config.toml` | The Supabase CLI configuration (Postgres major version 17 for the hosted projects, auth settings, a note on the `auto_expose_new_tables` default change). Not used by the local stand-in. | U | Current |
| `supabase/.gitignore` | Keeps CLI temporary files and local env files out of git. | U | Current |

## 8. Tests (`tests/`)

| File | What it is for | Readers | Status |
|---|---|---|---|
| `tests/alignment.test.mjs` | Votes, reactions and Support line up with playback position under 3 to 10 seconds of delay. | U | Current |
| `tests/guest-preview.test.mjs` | The 60-second guest preview meter. | U | Current |
| `tests/layout.test.mjs` | Nothing overlaps the player and it never drops under 200 by 200, at 15 sizes and 5 modes. | U | Current |
| `tests/native-shared.test.mjs` | The modules the native app imports from `lib/` load without a browser. | U | Current |
| `tests/pipeline.test.mjs` | Broadcast lifecycle including two failure drills, stage requests, compositor geometry. | U | Current |
| `tests/player-fixture.test.mjs` | The fixture player's clock and the three Versus views. | U | Current |
| `tests/signup.test.mjs` | Sign-up rules: 18 on the day, leap days, under-18 never returned. | U | Current |
| `tests/site.test.mjs` | Contact validation, honeypot, help search. | U | Current |
| `tests/supabase-env.test.mjs` | The Vercel staging override and guard (14 tests). | U | Current |
| `tests/support.test.mjs` | Support properties: double tap pays once, legs sum to zero, 72.5%, limits fail closed. | U | Current |
| `tests/window-tests.test.mjs` | Wraps `scripts/window-tests.mjs` (show window and Kit Check handover rules). | U | Current |
| `tests/youtube.test.mjs` | Per-tenant token encryption, mock and Google API request shapes. | U | Current |
| `tests/e2e/viewer.e2e.mjs` | 20 browser steps through the viewer experience against the local stack. | U | Current |
| `tests/e2e/artist.e2e.mjs` | 8 browser steps: onboarding, scheduling, Kit Check, go live with files on disk, prompt push, end show, clip, Versus handover, earnings, insights. | U | Current |
| `tests/e2e/site.e2e.mjs` | 11 browser steps through the website at 1440 and 390 wide with accessibility checks. | U | Current |

## 9. Scripts (`scripts/`)

| File | What it is for | Readers | Status |
|---|---|---|---|
| `scripts/db/apply-migrations.sh` | Apply every migration in order to a plain Postgres, recording versions the way the Supabase CLI does; `--fresh` recreates the database. | U A | Current |
| `scripts/db/supabase-stub.sql` | The stand-in for a Supabase project on plain Postgres: the API roles, `auth` and `storage` schemas, default privileges. | U A | Current |
| `scripts/db/run-sql-tests.sh` | Runs `supabase/tests/*.sql`, each inside a rolled-back transaction. | U A | Current |
| `scripts/db/seed.sh` and `scripts/db/seed-synthetic.sql` | Seed synthetic artists and shows into a local or CI database. | U A | Current |
| `scripts/dev/local-stack.mjs` | The local Supabase stand-in: real PostgREST plus a fake GoTrue sign-in service and a fixed local JWT secret. Test double, never deployed. | U A | Current |
| `scripts/dev/fetch-postgrest.sh` | Downloads the pinned PostgREST binary into `.cache/`. | U A | Current |
| `scripts/dev/e2e.sh` | The whole browser suite end to end: migrations, seed, stack, build, app, three suites, teardown. | U A | Current |
| `scripts/route-auth-check.mjs` | Every API route must state an auth model or be on the written allowlist with a reason. Run by `check:lint` and CI. | U A | Current |
| `scripts/window-tests.mjs` | Pure-function tests for the show window and Kit Check handover. | U | Current, wrapped by `tests/window-tests.test.mjs`. |
| `scripts/smoke.mjs` and `scripts/smoke-bootstrap.mjs` | Signed-in smoke check against a deployment, and the script that creates or removes its test account. Need a deployment and credentials. | U | Current for the pilot surfaces; not yet extended to the new screens. |
| `scripts/api-auth-probe.mjs` and `scripts/api-authz-probe.mjs` | Live probes against a deployment: things it must refuse with no credentials, and with a real session. | U | Current for the pilot routes; not yet extended to the new routes. |
| `scripts/freeze-csv.mjs` | Pulls a show's health events as a CSV from a deployment, signed in as the owner. Defaults to the old `loud-app-umber` address. | U | Historical tool, still works against the pilot. |
| `scripts/seedCueSheet.js` | Hand-written cue-sheet seed for testing without the in-app editor. | U | Historical |

## 10. Native app (`native/`)

| File or folder | What it is for | Readers | Status |
|---|---|---|---|
| `native/README.md` | What the Expo app does today, SDK 57, how to run with Expo Go, what needs a development build later. | U | Current |
| `native/package.json` and `native/package-lock.json` | Dependencies pinned to Expo SDK 57; lockfile rebuilt from a clean install. | U | Current |
| `native/app.json` | Expo config: bundle ids `app.loudentify.ios` and `app.loudentify.android`, permissions wording, universal links, plugins, `projectId` placeholder. | U K | Current; `projectId` is `SET-BY-EAS-INIT`. |
| `native/eas.json` | EAS build profiles (development, preview, production) and submit placeholders. API base for preview points at the Vercel staging preview URL. | U K | Current; placeholders to fill. |
| `native/metro.config.js` | Lets the app import the shared DOM-free modules from `lib/` as `@loud/lib`. | U | Current |
| `native/app/` | The screens: tabs (discover, live, create, profile), show, login, signup, camera, web (WebView for console, settings, earnings). | U | Current; see `docs/HANDOVER_UGO.md` section F item 10 for login-flow defects. |
| `native/src/` | config, session (Supabase Auth on the phone), api client, shared imports, theme, player (PlayerSource for native), the five states. | U | Current |

## 11. Application code (for orientation; not documents)

| Folder or file | What it is for | Status |
|---|---|---|
| `app/` | Next.js App Router pages and API routes. `app/api/viewer/*`, `app/api/artist/*`, `app/api/site/*`, `app/api/events`, `app/api/dev/seed` are the rebuild; the rest (`app/api/token`, `egress`, `camfeed`, `wallet`, `tracks`, `broll`, `cue-sheets`, `performer`, `participants`, `reactions`, `show-comments`, `show-prompts`, `prompt-responses`, `viewer-session`, `health-events`, `recordings`, `account`, `profile`, `room`, `set-lists`, `show`, `artists`, `build-info`) are pilot routes still in use by the console. `/` is the website, `/pilot` the old front door, `/pilot/live` the old LiveKit show screen. | Current |
| `components/` | Pilot components at the top level (`LiveDemo.jsx` is the pilot console and show screen); `components/viewer/`, `components/artist/`, `components/site/` are the rebuild. | Current |
| `lib/` | Pilot modules at the top level (director, audio, pairing, ledger, telemetry); rebuild modules: `lib/player/`, `lib/pipeline/`, `lib/youtube/`, `lib/site/`, `lib/design/tokens.js`, `lib/audit.js`, `lib/consent.js`, `lib/support.js`, `lib/alignment.js`, `lib/guestPreview.js`, `lib/signupRules.js`, `lib/metering.js`, `lib/schedule.js`, `lib/insights.js`, `lib/supabaseBuildEnv.cjs`, `lib/viewerAuth.js`, `lib/correlation.js`, `lib/telemetry.js`. | Current |
| `middleware.js` | `/@username` to `/u/username`; `/live?show=` to the pilot screen. | Current |
| `next.config.js` | Staging Supabase override and guard; JSON headers for the app-link files. | Current |
| `vercel.json` | Region `lhr1` (London). | Current |
| `package.json` | Scripts: `dev`, `check`, `check:lint`, `check:build`, `test`, `test:sql`, `db:migrate`, `db:seed`, `dev:stack`, `e2e`, `smoke`, `probe:auth`, `probe:authz`. | Current |
| `.env.local.example` | The local variables for the pilot (LiveKit and Supabase). The local stack writes `.env.local` itself. | Current but incomplete: does not list the rebuild's optional variables (YouTube, Stripe, egress mode, contact addresses). |
| `.gitignore` | Keeps env files, caches, device-test captures, macOS duplicates and store credentials out of git. | Current |
| `public/` | Logo PNGs, the pre-show audio loop, `.well-known/` app-link files with placeholders. | Current |

---

## Stale or duplicate documents, and what to do with them

Recommendation only. Nothing has been moved.

| Action | Files | Why |
|---|---|---|
| Delete | `docs/EXPORT_THESE_HERE.md` | Its three asks have arrived. |
| Archive (move to `docs/archive/pilot/`) | `CLAUDE_CODE_PROMPT.md`, `Loudentify_Pilot_UI_Spec.md`, `VISUAL_SYSTEM_HANDOFF.md`, `MULTI_PERFORMER_SPEC.md`, `SHOW_LIFECYCLE_SPEC.md` | Earliest pilot specs, each superseded by a named current document. Check the genesis migration against the two spec files first. |
| Archive (move to `docs/archive/pilot/`) | `docs/PILOT_2_PLAN.md`, `docs/PILOT_2_MIGRATIONS.md`, `docs/MORNING_MIGRATIONS.md`, `docs/BUILD_AUDIT_2026-08.md`, `docs/PRD_RECONCILIATION_2026-08-25.md`, `docs/SHOT_INTEGRATION_LIVEDEMO.md`, `docs/WRITE_PATH_AUDIT.md`, `docs/MORNING_BRIEF.md`, `docs/OVERNIGHT2_DEVICE_TEST.md`, `docs/day2_accounts_test_script.md`, `docs/go_live_threading_test_script.md`, `docs/health_events_test_script.md`, `docs/SATURDAY_REHEARSAL.md` | Superseded plans, runners and test scripts for rounds that are over. Keep them readable; they explain why the pilot code looks as it does. |
| Archive (move to `docs/archive/pilot-sql/`) | The 43 `docs/*.sql` files that became migrations | Exact duplicates of what is under version control; a reader could run one by mistake. Keep the 14 pilot-2 runbooks with them, clearly labelled. |
| Keep in `docs/` but mark as historical at the top | `docs/HANDOVER.md`, `docs/PILOT_EVIDENCE_AUDIT.md`, `docs/PILOT_2_BUILD_PLAN.md`, `docs/SECURITY_AUDIT_2026-08-28.md`, `docs/INTERRUPTION_FEASIBILITY.md`, root `DECISIONS.md` | Still the reference for the pilot code, its open defects and its evidence. |
| Rewrite | `README.md` | It describes the first scaffold. It should point at `docs/CLAUDE.md`, `docs/HANDOVER_UGO.md` and the commands in section H. |
| Correct | `docs/STATUS.md`, `docs/NEEDS_KOREY.md` | Staging database is migrated; unit tests are 66; the PRD spreadsheet is present. |
| Extend | `.env.local.example` | Add the optional rebuild variables with one-line comments, values blank. |
| Duplicate names to be aware of | Root `DECISIONS.md` and `docs/DECISIONS.md`; `docs/HANDOVER.md` and `docs/HANDOVER_UGO.md` | Different documents, not copies. Older docs that say "DECISIONS.md" mean the root file. |
