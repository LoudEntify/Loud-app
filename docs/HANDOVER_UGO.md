# Handover for Ugo

3 October 2026. Written by Claude Code (the build agent) from the `staging` branch at commit `b962ff6`. Every claim below was checked against the code, the workflows, the migrations, the tests, the git history, the GitHub Actions logs and the existing documents on that date. Where something could not be checked, or two documents disagree, it is listed in section I under "Not verified or conflicting".

Sections A to F are written for Korey as well as Ugo. Sections G and H are for Ugo. Technical words are explained the first time they appear, and section I has a glossary.

---

## A. Start here

### What Loudentify is

Loudentify is a live music platform for independent artists. An artist performs from a phone, with up to two more phones acting as extra cameras. Software called the AI director cuts between those cameras the way a television director would. Fans watch, chat, vote and send tokens. Artists keep 72.5% of what fans send. Two artists can share a show in a format called Versus. Viewers watch through an embedded YouTube player, while the show state, the recording, the chat, the votes and the money stay in Loudentify's own systems. Loudentify's own video hosting is planned for later.

### Where the project stands today, in five sentences

1. Two real pilot shows ran on real phones in August and September 2026 using the original code and the original database, and the lessons from them are written down (`docs/USER_JOURNEY.md`, `docs/PILOT_2_BUILD_PLAN.md`, `docs/HANDOVER.md`).
2. On 1 and 2 October 2026 a rebuild was started on a new `staging` branch with a new staging database, and five pull requests landed the foundations, the viewer web app, the artist console and live pipeline, a native phone app, the public website and a continuous integration pipeline.
3. Everything new is proven by automated tests (59 database migrations from scratch, 4 database permission suites, 66 unit tests, 39 browser tests) and the staging database carries all 59 migrations, but nothing new has been run against real YouTube, real LiveKit video, a real payment provider or a real phone.
4. Nothing has been promoted to production: the new production database is empty, the public address loudentify.app still serves the pilot code from `main`, and 11 protected-path changes (money, identity, permissions, audit log) are waiting for a human review before the promote workflow will allow a release.
5. Two documents written on 2 October (`docs/STATUS.md` and `docs/NEEDS_KOREY.md`) say the staging database could not be reached because of a wrong password, but the GitHub Actions logs show the password was fixed and every migration was applied later that day, so those two documents are out of date on that point.

### What Ugo should do first

1. Get the access listed in section G (GitHub is the one that blocks everything else).
2. Clone the repository, check out `staging`, and run the local stack and the tests using section H. Expect them all to pass.
3. Read the 11 protected-path items in `docs/NEEDS_KOREY.md` under "Reviews needed before promotion", review each migration and route named there, and tick the ones you are satisfied with, putting your name next to each.
4. Open the Vercel staging preview with Korey and work through the device checklists in `docs/NEEDS_KOREY.md`.
5. Do not run the promote workflow until section F item 4 (production readiness) is done. The first promote changes the front door of loudentify.app and there are unresolved risks around it (section F and section I).

### The three documents to read first

| Order | Document | Why |
|---|---|---|
| 1 | `docs/CLAUDE.md` | The standing rules the build agent works to: autonomy, environments, migrations, architecture, settled product decisions, design tokens, testing gates. Seven short sections. |
| 2 | `docs/ARCHITECTURE.md` (version 2, 1 October 2026) | The build standard: roles, data isolation, audit log, money, live media, YouTube delivery, safety, performance, reliability, release flow, what to build first. It wins on detail. |
| 3 | `docs/STATUS.md` then `docs/NEEDS_KOREY.md` | What was built on 2 October and what is proven, per PRD row; then every blocker that needs a human. Read both knowing the staging-database section is stale (section I). |

---

## B. The three environments

An "environment" is one complete copy of the product: code, database and web address. Loudentify has three, plus each engineer's laptop.

### The table

| | PILOT (frozen) | STAGING | PRODUCTION |
|---|---|---|---|
| What it is | The code and data from the two real pilot shows. The fallback if the new build fails. | Where all new work lands first. Test data only. | The new live environment. Currently empty. |
| Git branch | `pilot-freeze-v2` (last commit 14 August 2026). See section I: loudentify.app is actually served from `main`. | `staging` (head `b962ff6`, 2 October 2026) | `main` (head `6e9bf7a`, 1 October 2026, which is still pilot code plus the `/privacy` page) |
| Database (Supabase project) | The original project. The Supabase connector attached to the build agent lists one project named `LoudEntify` (ref `jwnzhlfhwznatkrgsrqc`, London region, created 31 July 2026). Not confirmed as the pilot project; not queried. | `loudentify-staging`, ref `htepkxumrwtpbkahdric`, London region (pooler host `aws-0-eu-west-2`). All 59 migrations applied. | A new project, said to exist and to be empty. Its name and ref are not in the repository or visible to the build agent. |
| Web address | `https://loudentify.app` (custom domain on the Vercel project `loud-app`, deployed from `main`). Older docs also name `https://loud-app-umber.vercel.app`. | `https://loud-app-git-staging-korey-alashe.vercel.app` (a Vercel "preview" build of the `staging` branch; sits behind Vercel's own login) | Will be `https://loudentify.app` once `main` carries the new build and the Vercel production variables point at the production database. |
| Who can change it | Nobody should. `docs/CLAUDE.md` section 2: never touch `pilot-freeze-v2` or the pilot Supabase project. | The build agent and Ugo, through pull requests into `staging`. Merging is allowed without a human review except for protected paths, which need a review before promotion, not before merge. | Only the `promote` workflow, run by hand from the GitHub Actions tab, after a human approves the `production` environment. Nobody holds standing production credentials. |
| Secrets (names only) | Vercel project variables: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_URL`, `LIVEKIT_S3_BUCKET`, `EGRESS_TEMPLATE_BASE_URL`. These still apply to every Vercel Preview build too. | GitHub repository variable `STAGING_PROJECT_REF`. GitHub `staging` environment secret `SUPABASE_STAGING_DB_URL`. Vercel Preview variables scoped to the `staging` branch: `STAGING_SUPABASE_URL`, `STAGING_SUPABASE_PUBLISHABLE_KEY`. Optional Vercel variables the new code reads: `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_TOKEN_KEY`, `EGRESS_MODE`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_CONTACT_EMAIL_GENERAL`, `NEXT_PUBLIC_CONTACT_EMAIL_PRESS`, `NEXT_PUBLIC_CONTACT_EMAIL_ARTISTS`, `NEXT_PUBLIC_APP_STORE_URL`, `NEXT_PUBLIC_PLAY_STORE_URL`. | GitHub repository variable `PRODUCTION_PROJECT_REF` and GitHub `production` environment secret `SUPABASE_PRODUCTION_DB_URL` (both required by `promote.yml`; neither has been confirmed to exist). Vercel Production variables for the new database (not yet set as far as the repository shows). |
| How a change gets there | It does not. | Feature branch, pull request into `staging`, CI green, merge. The `staging` workflow then applies any new migrations to the staging database. Vercel rebuilds the preview on every push. | Run the `promote` workflow. It refuses if any protected-path review is unticked. A human approves the `production` environment. It fast-forwards `main` to `staging`, applies the same migration files to the production database, and Vercel deploys `main`. |

### The short story

In the pilot there was one database for everything. The handover written on 5 September 2026 (`docs/HANDOVER.md`) opens with a warning in capitals: there is no test database, every migration is a production migration, every test creates real rows. That is how the pilot was run, and it worked for two shows, but it is not a way to build a product.

On 1 October 2026 the rebuild started. The pilot code and the pilot database were declared frozen. A new branch called `staging` was cut from `main`, a new Supabase project called `loudentify-staging` was created in London, and a continuous integration pipeline (CI, a set of automated checks that run on every push) was added so that nothing reaches the staging database without the whole migration history applying from scratch and every test passing. The staging workflow applies migrations to the staging database with one connection string and a guard that refuses to run if that string does not name the staging project (`.github/workflows/staging.yml`). The Vercel preview of `staging` is built against the staging database by a build-time switch with its own guard (`lib/supabaseBuildEnv.cjs`, pull request [LoudEntify/Loud-app#4](https://github.com/LoudEntify/Loud-app/pull/4)).

Production is a third Supabase project. It is empty. Changes reach it only through `.github/workflows/promote.yml`, which first checks that every protected-path item in `docs/NEEDS_KOREY.md` is ticked, then waits for a human to approve the GitHub `production` environment, then merges `staging` into `main` and applies the same migration files. The build agent never holds the production connection string; it exists only as a secret on that environment.

Two things to hold in mind. First, the public address loudentify.app today serves `main`, and `main` is the pilot-2 code from September plus the `/privacy` page merged on 1 October ([LoudEntify/Loud-app#1](https://github.com/LoudEntify/Loud-app/pull/1)). The branch `pilot-freeze-v2` is older (14 August) and is the fallback named in `docs/CLAUDE.md`, but it is not what is live. Second, when `main` is promoted, the Vercel production build will still read the pilot database's `NEXT_PUBLIC_SUPABASE_URL` unless the Vercel Production variables are changed to the production project first. The build guard deliberately never runs for production (`lib/supabaseBuildEnv.cjs`), so nothing will stop that mistake automatically. It is section F item 4.

---

## C. The build philosophy in plain English

### The four rules and why

These come from `docs/ARCHITECTURE.md` and are repeated in `docs/CLAUDE.md` section 4.

| Rule | What it means | Why |
|---|---|---|
| 1. The show must never stop | A failed check warns, it does not kill the stream. When things fail, drop them in a fixed order: analytics first, then viewer counts, then comments to read-only, then down to one camera, then video quality, and only then end the show with an honest message and keep the recording. Money and safety controls are the exception: they fail closed. | A dropped show cannot be undone. An artist who loses an audience once may not book again. The pilots proved the point: on 20 September a microphone died and a camera stalled 283 times. |
| 2. Least data, least access, least time | Collect only what the product needs, show it only to those who need it, keep it only as long as required. | UK GDPR applies from the first user. It is also what keeps a breach small. |
| 3. Everything that touches money, identity or someone else's data leaves a trace | Every such action is written to an append-only, hash-chained audit log. If it cannot be audited it does not ship. | SOC 2 certification needs a year of evidence, so the log has to exist long before anyone asks. It is also how a dispute gets settled. |
| 4. Own the record, rent the delivery | YouTube carries the picture, but show state, recordings, chat, votes and money stay ours, and the player sits behind one interface we can swap. | Per-viewer streaming cost is too high to scale. YouTube can change its rules or remove a show, so nothing that matters depends on it. |

### The release flow

1. Work happens on a feature branch (a separate line of changes in git, the version control system).
2. A pull request (a request to merge the branch, with a description and automated checks) is opened into `staging`.
3. CI runs (`.github/workflows/ci.yml`): every migration from an empty database, the SQL permission tests, lint, unit tests, a production build, the browser tests, and the native app bundle.
4. When green, the pull request merges. The build agent may merge its own pull requests into `staging`.
5. The `staging` workflow applies new migrations to the staging database. Vercel rebuilds the staging preview.
6. Korey tests on staging on real phones. The device checklists are in `docs/NEEDS_KOREY.md`.
7. When approved, Korey runs the `promote` workflow. One approval click on the `production` environment. It merges `staging` into `main`, applies the same migrations to production, and Vercel deploys.

### Migrations as reviewed code, with rollbacks

A migration is a file of SQL (the database language) that changes the database structure. In the pilot, 57 such files sat loose in `docs/` and were pasted into the Supabase SQL editor by hand. Now they live in `supabase/migrations/`, timestamped, 59 of them, and every one has a matching rollback script in `supabase/rollbacks/` that undoes it. A migration is never edited after it has been applied anywhere. CI applies all 59 from an empty Postgres 16 database on every push (`scripts/db/apply-migrations.sh --fresh`), so a migration that only works on yesterday's database fails in CI, not on staging. Running the full history this way found three real bugs in pilot-era files before they ever reached the new staging project (`docs/DECISIONS.md`, 1 October).

### Why staging and production databases are separate

So that test data never sits next to real data, so that a migration can be rehearsed before it touches real rows, and so that the build agent can be given full access to one without ever seeing the other. The pilot had one database and the 5 September handover says plainly that test rows were left behind twice for the artist to clear.

### Why the build agent only ever holds staging access

The build agent works unattended. If it held production credentials, a mistake in a prompt or a bug in a script could change real data with nobody watching. So it holds the staging connection string and staging keys only. Production credentials exist only as secrets on the GitHub `production` environment and are used only by `promote.yml`. The agent cannot approve its own promotion. This is written into the role table in `docs/ARCHITECTURE.md` ("Build agent: never gets production credentials, production data, the promote approval, any production write"). See section I for one open question about the Supabase connector in the agent's session.

### Protected paths that need a human review

Changes to money and the ledger, identity and sign-in, permissions and row-level security, the audit log, and their migrations are "protected paths". The agent may merge them into `staging`, but `promote.yml` refuses to run while any item under "Reviews needed before promotion" in `docs/NEEDS_KOREY.md` is unticked. Each item has a plain-English statement of the risk if it is wrong and the test that covers it. There are 11 today. Ugo or Korey ticks each with a name.

### Own the record, rent the delivery: YouTube first, our own hosting later

Viewers watch an embedded YouTube player. One composed picture per show is captured by an egress service (software that takes the live picture out of the room and sends it somewhere) and sent to YouTube over RTMP (the standard protocol for pushing live video to a streaming platform). The same egress writes the recording and a training copy. In code, the player sits behind one interface, `PlayerSource` (`lib/player/PlayerSource.js`), with three implementations: `youtube` (first), `loudentify-llhls` (our own low-latency delivery, a stub until funded) and `fixture` (a test card for tests). Switching is configuration per show, not a rewrite. Detail: `docs/YOUTUBE_ADDENDUM.md`.

### The show must never stop, in code

`lib/pipeline/lifecycle.js` is the broadcast lifecycle. When YouTube ingest drops it retries the same broadcast for three ticks, then creates a new broadcast on the same channel, retargets the egress, rotates the old stream key and moves the viewer's player to the new video. The recording never stops and the show is never ended by delivery trouble. This is tested in `tests/pipeline.test.mjs` and the artist browser suite, against test doubles.

For the full standard read `docs/CLAUDE.md`, `docs/ARCHITECTURE.md` and `docs/YOUTUBE_ADDENDUM.md`.

---

## D. What was built in the pilot

"The pilot" is the code on `main` before 1 October 2026 and the shows run with it. The authoritative account is `docs/HANDOVER.md` (5 September 2026), which labels each feature "device-tested" or "correct by reading", and `docs/REPO_AUDIT.md` (1 October 2026), which lists what is reused as-is.

### Shows that actually happened

| Date | What | Evidence |
|---|---|---|
| July to August 2026 | Pilot 1 shows. The exact date is not stated in any document. `shot_commands` rows span 31 July to 5 September ("3,061 rows across 40 shows", `docs/PILOT_2_PLAN.md`). | `docs/PILOT_2_PLAN.md` section 0, `docs/PILOT_EVIDENCE_AUDIT.md` |
| 21 August 2026, 16:37 | A production show with a confirmed recording after the audio-only incident was fixed. | `docs/BUILD_AUDIT_2026-08.md` section F.6 |
| 29 August 2026 | A show (`show-tjtd0pyo`) whose health events were exported and analysed. | `docs/PILOT_2_BUILD_PLAN.md` |
| 19 September 2026 | Dress rehearsal for pilot 2. The run sheet exists; no results are recorded in it. | `docs/SATURDAY_REHEARSAL.md` |
| 20 September 2026 | Pilot 2. Planned for 30 to 50 viewers, a Versus show, artist "Artistwon", Korey operating. | `docs/PILOT_2_PLAN.md`, `docs/PILOT_2_BUILD_PLAN.md`, `docs/USER_JOURNEY.md` |
| 27 September 2026 | A second outing at a third-party event. "The 27 Sept show needed an operator console." | `docs/PILOT_2_BUILD_PLAN.md`, `docs/USER_JOURNEY.md` |

### Features that exist and were device-tested

From `docs/HANDOVER.md` section 2 unless stated. "Device-tested" there means run on real phones in real rehearsals or shows.

| Feature | Where in code | Evidence |
|---|---|---|
| AI director and shot grammar: a fixed cycle wide, medium, close-up, B-roll, medium; per-shot hold times; zoom capped at 1.2x; `decisionSource` is `auto`, `human` or `cue` | `lib/autoDirector.js`, `lib/shotTypes.js`, `lib/shotCommands.js` | `docs/HANDOVER.md` "device-tested"; `docs/BUILD_AUDIT_2026-08.md` lists the auto director as built but unverified on 19 August, so verification came later |
| Multi-camera pairing: a phone scans a code and becomes a wide, close or side camera | `lib/camfeedPairing.js`, `lib/camfeedDevice.js`, `components/CamPair.jsx`, `components/CamViewfinder.jsx` | `docs/BUILD_AUDIT_2026-08.md` "BUILT+VERIFIED (this session)" 19 August; `docs/HANDOVER.md` |
| Camera liveness: a camera is healthy only if frames keep arriving | `lib/trackLiveness.js` | `docs/HANDOVER.md` "device-tested" |
| Track discriminator: what kind of track is this | `lib/trackSources.js` | `docs/HANDOVER.md`; 14 of 14 node checks (`docs/OVERNIGHT2_DEVICE_TEST.md`) |
| Audio host and processing chain: high-pass, compressor, reverb, mic mute as a gain node | `lib/audioHost.js`, `lib/audioProcessing.js`, `components/AudioHostProvider.jsx` | `docs/HANDOVER.md` "device-tested" |
| Backing tracks, uploaded tracks, set lists, cue sheets | `lib/setLists.js`, `lib/cueDirector.js`, `components/BackingTrackLibrary.jsx`, `components/SetListPanel.jsx`, `components/CueSheetLibrary.jsx` | `docs/HANDOVER.md` "device-tested"; cue sheets "BUILT+VERIFIED" 19 August |
| Show session state survives a reload | `lib/showSessionState.js`, `lib/useShowSession.js` | `docs/HANDOVER.md` "device-tested" |
| Versus: two artists, invitations delivered in-app, split layout measured not inferred, voice glow | `components/VersusSplit.jsx`, `lib/glowLevels.js`, `app/api/performer/*` | `docs/HANDOVER.md` "device-tested (two artists, two devices, a viewer)" |
| Notifications with dedupe and unread badge | `components/Notifications.jsx`, `lib/unreadCount.js` | `docs/HANDOVER.md` "device-tested" |
| Health telemetry: encoder stats every two seconds, batched to the database | `lib/healthLog.js`, `lib/publisherStats.js` | `docs/HANDOVER.md` "device-tested"; `health_events` shipped 18 August |
| Egress recording to storage, portrait template | `app/api/egress/*`, `components/EgressPage.jsx` | "partially device-tested"; recording confirmed on playback 21 August |
| Stale-command suspend, downgrade and resume when a camera drops | pilot-2 item 1 | "Item 1 device tested and PASSED on `20d1362`", 14 September, after "eleven device tests and two days" (`docs/PILOT_2_BUILD_PLAN.md`) |
| Wallet and ledger: buy, spend, cash out; append-only enforced by a database trigger; payments provider not connected | `lib/ledger.js`, `lib/paymentProvider.js`, `app/api/wallet/*` | "correct by reading, partially device-tested" |
| Interruption handling: audience sees a held frame, artist sees the cause | `lib/interruptionState.js`, `components/AwayReturnNotice.jsx` | iPhone probe run 3 September (`interruption-ios-chrome.csv`, 486 rows); Android and iOS Safari still owed (`docs/INTERRUPTION_FEASIBILITY.md`) |
| Pilot-2 instrumentation: actual show times, viewer sessions, stored comments, room events, prompts and responses, Versus vote | migrations `20260818003500` to `20260818004300` | migrations run and verified 12 September; the show itself 20 September |

### What was built but parked or never proven

- B-roll clips to viewers and the recording: four rounds, one root cause (the publication did not survive a reconnect), parked on branch `feature/mvp-round-3`. Do not retry the things listed under "Do NOT retry" in `docs/HANDOVER.md` section 3.
- The camera CPU investigation: two suspects, instruments live, the deciding session never run (`docs/HANDOVER.md` sections 3, 4 and 6).
- Connection instability: four reconnects in six minutes on a developer's connection, never investigated.
- The egress recording of a B-roll clip and of the Versus 50/50 split were never pulled and checked.

### What the pilot taught us

These lessons are recorded in `docs/USER_JOURNEY.md`, `docs/PILOT_2_BUILD_PLAN.md`, `docs/PILOT_EVIDENCE_AUDIT.md` and `docs/HANDOVER.md` section 5, and they are now rules in `docs/CLAUDE.md`.

1. One feed per physical device. The Sony camera sharing a laptop was the one that stalled 283 times on 20 September.
2. A camera is healthy only if frames keep arriving, not if it connected. Kit Check now holds each camera for two minutes.
3. Watch the microphone on the raw input. On 20 September a mic died and the only fix was logging out. Switching a mic now rewires the mix in place.
4. iOS stops camera capture when the app leaves the foreground. Performer devices must stay in front, and the app warns.
5. Nothing could close a LiveKit room. After pilot 1 a room stayed open for 6 hours 26 minutes and a camera published for 5 hours 39 minutes.
6. Correct code and an empty table look the same from outside. Reactions "looked correct in code for weeks and wrote nothing". A zero is a defect report. Query the database.
7. Chat was never stored. Every comment from every pilot show is gone.
8. No actual start time was recorded, so pilot-1 reaction timings cannot be corrected after the fact.
9. Instrument before fixing. The B-roll teardown was blamed on B-roll for two rounds; telemetry named the auto director's hold timer in one capture.
10. Test for validity, not truthiness: "does the reference exist" and "does the reference work" are different questions.
11. Grep for the assumption, not the symptom. "Shows belong to one artist" was wrong in six places once Versus existed, and three of them are still unfixed (section F).
12. The 27 September show needed an operator console. It is not built.

---

## E. What has been built in the staging build since 1 October 2026

All of this is on `staging`. Authors in git are Korey Alashe's account (sessions on 1 October) and "Claude Code" (2 October). Five pull requests have been merged; there are no later ones.

| Pull request | Merged | What |
|---|---|---|
| [LoudEntify/Loud-app#1](https://github.com/LoudEntify/Loud-app/pull/1) | 1 October 2026 | A public static `/privacy` page, into `main`, so loudentify.app has a privacy notice for Google OAuth verification |
| [LoudEntify/Loud-app#2](https://github.com/LoudEntify/Loud-app/pull/2) | 1 October 2026 | Removed the account-wide Supabase access token from `staging.yml` and `promote.yml`; each now connects with one database URL and a project-ref guard |
| [LoudEntify/Loud-app#3](https://github.com/LoudEntify/Loud-app/pull/3) | 2 October 2026 | Phases 2 to 5: viewer web, artist and live pipeline, native app, website, plus the audit log lockdown and the CI migration harness |
| [LoudEntify/Loud-app#4](https://github.com/LoudEntify/Loud-app/pull/4) | 2 October 2026 | Vercel staging preview reads `STAGING_SUPABASE_*` with a build guard |
| [LoudEntify/Loud-app#5](https://github.com/LoudEntify/Loud-app/pull/5) | 2 October 2026 | `native/` upgraded from Expo SDK 53 to SDK 57 so the store Expo Go app opens it; CI gains a `native` job |

Phase 1 was merged directly into `staging` on 1 October (commit `4984d72`) because no pull request tooling was available in that session (`docs/DECISIONS.md`, 1 October).

### Counts

| What | Count | Where |
|---|---|---|
| Migrations | 59 (1 genesis, 43 pilot-era files restructured, 6 Phase 1, 1 audit lockdown, 5 Phase 2, 2 Phase 3, 1 Phase 5, 0 Phase 4) | `supabase/migrations/` |
| Rollbacks | 59, one per migration | `supabase/rollbacks/` |
| SQL permission suites | 4 (audit log, Phase 2, Phase 3, Phase 5) | `supabase/tests/` |
| Unit test files and tests | 12 files, 66 tests | `tests/*.test.mjs`, run by `npm test` |
| Browser (end-to-end) steps | 39 (viewer 20, artist 8, website 11) | `tests/e2e/`, run by `npm run e2e` |
| CI jobs | 3: `check`, `e2e`, `native` | `.github/workflows/ci.yml` |
| Other workflows | `staging` (1 job, `deploy`), `promote` (2 jobs, `check-protected-paths` and `promote`) | `.github/workflows/` |
| Public tables in the fresh database | 44, all with row-level security enabled; 17 of them have zero policies on purpose (service-role writes only) | checked by applying all 59 migrations locally on 3 October |
| Separate schemas | `audit` (table `audit_log`), `identity` (tables `youtube_connections`, `stream_keys`) | migrations `20261001160100`, `20261002020000` |
| PRD stories | 176 in the spreadsheet; phases 1 to 5 cover 131 of them; `docs/STATUS.md` marks 69 done, 43 partly, 19 not started | `docs/Loudentify_PRD_User_Stories (4).xlsx`, column "Build plan phase (v2)" |

On 3 October I re-ran everything locally from the `staging` head: 59 of 59 migrations applied to an empty Postgres 16, 4 of 4 SQL suites passed, 66 of 66 unit tests passed, lint and the route authentication check passed, the production build passed, and the browser suites passed (viewer 20 of 20, artist 8 of 8, website 11 of 11). The last CI run on `staging` (run 24, 2 October 2026, commit `b962ff6`) has all three jobs green.

### Phase 1: foundations (1 October 2026)

What was built: the three workflows; the migration history (`docs/*.sql` restructured into `supabase/migrations/` with rollbacks, plus a "genesis" migration capturing the `shows`, `show_slots` and `participants` tables that had only ever existed as hand-run SQL in two spec documents); organisations and roles (a solo artist is an organisation of one); the append-only hash-chained audit log in its own schema; the ledger extended to true double-entry pairs with a deferred zero-sum constraint; consent records including the training-data choice; a data-classification registry; correlation ids. On 2 October the audit log was locked down explicitly with one service-role-only write function (`20261002000100`).

Proven by tests: every migration from scratch; audit chain and append-only trigger; ledger zero-sum success and failure cases; consent-to-audit trigger; organisation-scoped visibility; `supabase/tests/audit_log_access.sql`. Three pilot-era migration bugs were found and fixed by running them, and an RLS recursion risk fixed (`b637bf6`).

Never run on: nothing here needs YouTube, LiveKit, payments or a phone.

### Phase 2: viewer experience on the web (2 October 2026)

What was built: Discover feed, Live tab, search, one-page sign-up with the 18+ gate (an under-18 date of birth is never stored), onboarding, public profiles via a `public_profiles` view, wallet with test-mode purchase, waiting room, the show screen around `PlayerSource`, votes with playback-position stamps and a 15-second grace window, chat (polled every 3 seconds), reactions placeholder tab, Support (tokens) with 72.5% recorded at write and idempotency, three Versus views, five states on every screen, cookie consent before the YouTube player loads, journey and metering events. The pilot's front door moved to `/pilot`.

Proven by tests: 26 unit tests at the time (layout invariants at 15 sizes and 5 modes, fixture player clock, delay alignment at 3 to 10 seconds, guest preview meter, sign-up rules, Support properties), `supabase/tests/phase2_access.sql`, and 20 browser steps.

Runs on stand-ins only: the `fixture` player for seeded shows; the local Supabase stand-in (real PostgREST plus a fake GoTrue sign-in service, `scripts/dev/local-stack.mjs`).

Never run on: real YouTube playback. The `youtube` PlayerSource is written against the IFrame API but has not been exercised anywhere with a network path to YouTube. Apple and Google sign-in buttons are disabled. Token purchase is the test-mode provider.

### Phase 3: artist experience and live pipeline (2 October 2026)

What was built: six-step artist onboarding (photo and bio, the agreement with the separate on-by-default training-data line, connect YouTube, mic and place, pair a camera, book the first show); scheduling with the 30-minute rule enforced on the server and the YouTube broadcast created at booking; Kit Check showing the artist's own camera in the three broadcast crops with six checks; the console with the composed picture, delivery state, measured delay, comments, prompt and vote push, Fix sheet and press-and-hold End show; Versus Conversation and Perform buttons with stage requests and handover; delivery failure handling (retry, then new broadcast, key rotation); end show writes the recording row, insights and earnings; post-show visibility; clips up to 90 seconds; owner profile.

Proven by tests: `tests/pipeline.test.mjs` (lifecycle including two failure drills, stage requests, compositor geometry), `tests/youtube.test.mjs` (per-tenant encryption, mock and Google API shapes), `supabase/tests/phase3_access.sql` (identity schema unreachable from any client role, status never returns tokens), the artist browser suite of 8 steps including a two-console Versus handover.

Runs on stand-ins only: `MockYouTubeApi` (selected automatically when `YOUTUBE_CLIENT_ID` and `YOUTUBE_CLIENT_SECRET` are absent, `lib/youtube/api.js`); `FakeEgress`, which writes the compositor's layout as text frames to `.cache/egress/` with three outputs from one input (`lib/pipeline/egress.js`); a fake camera in the browser suite; the lifecycle tick driven by the console every 3 seconds rather than a worker.

Never run on: the real Google API (`GoogleYouTubeApi` has never been called); real LiveKit egress (`LiveKitEgress` refuses to start without credentials and its unified RTMP-plus-file start is not written); server-side rendering of the second artist's feed (the compositor renders in the browser console today); the AI director's decisions feeding the compositor; identity checks and payouts (stubs; cash-out is gated on a `kyc_status` nothing sets); the operator role.

### Phase 4: native apps (2 October 2026, upgraded later the same day)

What was built: one Expo (React Native) app in `native/` for iPhone and Android: Discover with the 60-second guest preview, Live, the show screen behind the same `PlayerSource` contract (YouTube through a WebView on the privacy-enhanced domain), sign-up with the 18+ gate using the same rules module as the web, log in, Profile with balance only and no buy button, and camera mode (scan the pairing code, viewfinder, ON AIR or REHEARSAL, keep awake, foreground warning). The artist console, settings and earnings open as web screens inside the app. Pull request #5 moved it to Expo SDK 57 so the Expo Go app from the stores can open it.

Proven by tests: `tests/native-shared.test.mjs` (the shared modules load without a browser); in CI, `npm ci`, `expo install --check`, `expo-doctor` and `expo export` for iOS and Android (the `native` job, green on run 24).

Runs on stand-ins only: nothing to stand in for; it is a client of the same API as the web.

Never run on: a phone, a simulator, or EAS (Expo's cloud build service). No Expo account exists (`native/app.json` has `projectId: "SET-BY-EAS-INIT"`). Publishing camera frames into the room needs the LiveKit native SDK and is not wired. Push notifications, Apple and Google sign-in and picture-in-picture are not built. See section F for the login-flow problems found by reading the code.

### Phase 5: website (2 October 2026)

What was built: the public website in the same Next.js app: home with a live strip, What's on, the share page `/s/:id` with Open Graph tags and a calendar file, For artists, For fans, Pricing (figures print "to be set"), About, Contact with a working form writing to `site_messages`, Help with search and eleven articles, four legal pages marked DRAFT and `noindex`, the cookie banner, and the app-link files with placeholders. `/` is now the website; the pilot doors are at `/pilot`.

Proven by tests: `tests/site.test.mjs` (contact validation, honeypot, help search), `supabase/tests/phase5_access.sql`, 11 browser steps at 1440 and 390 wide including basic accessibility checks.

Never run on: the production domain. Pricing figures, contact addresses, social handles, store links, hero photographs and the Apple and Android identifiers are placeholders.

### The Vercel staging configuration (pull request #4, 2 October 2026)

`next.config.js` calls `lib/supabaseBuildEnv.cjs`. On a Vercel Preview build of the `staging` branch it maps `STAGING_SUPABASE_URL` and `STAGING_SUPABASE_PUBLISHABLE_KEY` onto the `NEXT_PUBLIC_SUPABASE_*` values the app reads. A guard fails any Preview build, or any `staging` build, whose Supabase URL does not contain the staging project ref. The guard never runs for `VERCEL_ENV=production`. Proven by 14 unit tests in `tests/supabase-env.test.mjs`. Whether the Vercel variables are actually set correctly cannot be seen from the repository.

### The Expo SDK 57 upgrade (pull request #5, 2 October 2026)

React Native 0.86.3, React 19.2.3, every `expo-*` package at its 57 release, lockfile rebuilt from a clean install, `babel.config.js` removed, splash and status bar moved to config plugins, the fixed tab-bar height removed because Android is edge-to-edge. Ten decisions are logged in `docs/DECISIONS.md` under 2 October. The `native` CI job runs `expo-doctor` where the two hosts the sandbox could not reach are reachable.

### The staging database

The `staging` workflow applied all 59 migrations. The first successful run was run 5, attempt 3, at 01:07 UTC on 2 October 2026 (after the password in `SUPABASE_STAGING_DB_URL` was corrected by someone outside the agent's sessions). Run 6 (merge of pull request #3) succeeded at 11:14 UTC. Run 7 (merge of pull request #4) failed at 11:39 UTC with "password authentication failed", for a reason not established. Run 8 (merge of pull request #5) at 15:58 UTC reported "Remote database is up to date" and listed 59 local and 59 remote migrations. So the staging database is current. `docs/STATUS.md` and the top section of `docs/NEEDS_KOREY.md` were written before this and still say otherwise (section I).

---

## F. What needs to be done

One table, in priority order. Size: small is under a day, medium is days, large is weeks or depends on a third party. "Korey" means something only an account holder or the business owner can do.

| # | Item | Why it matters | Owner | Size | Document |
|---|---|---|---|---|---|
| 1 | Correct `docs/STATUS.md` and the top of `docs/NEEDS_KOREY.md`: the staging database is migrated (59 of 59). Establish why `staging` run 7 failed on the password between two successful runs. | Two documents the team reads first describe a blocker that no longer exists. | Ugo | small | this document, section I |
| 2 | Protected-path reviews: review and tick the 11 items under "Reviews needed before promotion" with a name next to each. They cover the organisation model and genesis migration, the audit log and its lockdown, the double-entry ledger, consent records, Support, `public_profiles`, sign-up, the YouTube identity store, the lifecycle and show routes, and `site_messages`. | `promote.yml` refuses to run while any is unticked. These are the money, identity and permission paths. | Ugo (Korey can tick but should not review alone) | medium | `docs/NEEDS_KOREY.md`, `.github/workflows/promote.yml` |
| 3 | Verify staging end to end: confirm the Vercel preview builds against the staging project (the build log prints `[next.config] staging preview build`), seed synthetic shows with `POST /api/dev/seed`, then run the Phase 2 and Phase 3 device checklists on real phones against the preview. | Nothing new has been seen on a phone. The checklists are Korey's gate under `docs/CLAUDE.md` section 7. | Korey (phones), Ugo (preview and seed) | medium | `docs/NEEDS_KOREY.md` Phase 2 and Phase 3 device checklists, `docs/PHASE_2_HANDOFF.md` |
| 4 | Production readiness before the first promote: (a) confirm the production Supabase project exists, in London, and record its name and ref; (b) set repository variable `PRODUCTION_PROJECT_REF` and the `production` environment secret `SUPABASE_PRODUCTION_DB_URL`; (c) set a required reviewer on the `production` environment; (d) change the Vercel Production variables (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) to the production project, because the build guard never runs for production and the deploy would otherwise point the new code at the pilot database; (e) check that `main` branch protection allows the `promote` workflow's direct push (it requires a pull request with one approval today, per `docs/NEEDS_KOREY.md`, which may reject the workflow's `git push origin main`); (f) decide the moment the website becomes the front door of loudentify.app and the pilot doors move to `/pilot`. | The first promote changes what the public sees and what database the live site talks to. There is no automated protection against (d) or (e). | Korey (accounts, decision), Ugo (checks) | large | `.github/workflows/promote.yml`, `lib/supabaseBuildEnv.cjs`, `docs/NEEDS_KOREY.md` |
| 5 | Real YouTube: create the Google Cloud project, enable the YouTube Data and Live Streaming APIs, configure the consent screen pointing at `/privacy`, submit for verification of the live-streaming scope, check the default quota, create the OAuth client with the staging and production redirect URIs, set `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET` and a 32-plus character `YOUTUBE_TOKEN_KEY` on Vercel (staging first, a different key for production). Then run the first real connect and broadcast on staging and fix what breaks. | `GoogleYouTubeApi` has never been executed. Google verification has a lead time of days to weeks. | Korey (Google accounts), Ugo (engineering), Google (third party) | large | `docs/NEEDS_KOREY.md` Phase 3 and "Blocking Phase 3", `docs/YOUTUBE_ADDENDUM.md`, `lib/youtube/*` |
| 6 | LiveKit egress: write the unified start in `LiveKitEgress` (room composite with RTMP to YouTube plus the recording and training file from one egress), wire the AI director's decisions into the compositor sources, render the second artist's feed server-side, set `EGRESS_MODE=livekit`. The pilot's `/api/egress/start` still does the storage leg only. | Until this exists no real video reaches YouTube or the recording from the new console. | Ugo | large | `lib/pipeline/egress.js`, `docs/PHASE_3_HANDOFF.md`, `docs/YOUTUBE_ADDENDUM.md` |
| 7 | Payment and identity providers: choose the payment provider (Stripe is supported by `lib/paymentProvider.js` with `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`), choose an identity-check provider and a payout route, wire the webhook, decide the pending period (a 7-day placeholder in `app/api/artist/earnings/route.js`), and the financial-crime controls in `docs/ARCHITECTURE.md` "Money". | Token purchase is test mode only; cash-out is gated on a status nothing sets. | Korey (decision, accounts), Ugo | large | `docs/NEEDS_KOREY.md` Phase 2 and Phase 3, `docs/ARCHITECTURE.md` Money |
| 8 | Apple and Google sign-in, then passkeys: create the Apple Services ID and the Google OAuth client with the Supabase callback, enable the providers in the staging Supabase project, wire the disabled buttons. | `docs/ARCHITECTURE.md` asks for passkeys and Apple and Google sign-in from launch; today it is email and password only. | Korey (accounts), Ugo | medium | `docs/NEEDS_KOREY.md` Phase 2 |
| 9 | Native development builds and store accounts: test with Expo Go first (no accounts needed); then an Expo account and `eas init`; Apple Developer Program (£79 a year); Google Play Console (one-off fee); EAS preview builds; universal links need the Apple team id and the Android signing SHA-256 in `public/.well-known/`; a development build for the LiveKit native SDK, push notifications and native sign-in; a store rule check on the sentence "Tokens are bought on loudentify.app". | The app has never run on a device. | Korey (accounts, phones), Ugo | large | `docs/NEEDS_KOREY.md` Phase 4, `docs/PHASE_4_HANDOFF.md`, `native/README.md` |
| 10 | Fix the native login flow problems found by reading the code (section F note below): the sign-up form remounts its text fields on every keystroke; log in and sign-up crash silently when the Supabase values are missing; every sign-in error reads as a wrong password; the web "Forgot password?" link points at a page that does not exist; the native app's API base is a Vercel preview URL behind Vercel's login, so API calls from a phone fail until a reachable staging address exists. | These will be the first things a tester hits. | Ugo | small | `native/app/signup.js`, `native/app/login.js`, `native/src/session.js`, `components/viewer/SignUpSheet.jsx`, `native/eas.json` |
| 11 | Pilot-era defects still open: three owner-column surfaces (`/api/recordings/sync`, `/api/account/export`, `/api/health-events/export` still filter on `shows.artist_id`, so a Versus guest cannot reach their own recording, data export or telemetry); B-roll parked on `feature/mvp-round-3`; connection instability uninvestigated; the CPU attribution session unrun. | One is a user-facing defect and one is a GDPR export gap. | Ugo | medium | `docs/HANDOVER.md` sections 3 and 4 |
| 12 | Phase 6 hardening: report queue and stop-show (PRD 157, 158), data rights automation (153), retention and legal-hold jobs (155), backups and a restore drill (167), a shared rate-limit store (the limiter is per server instance, `lib/rateLimit.js`), secret scanning in CI (164), realtime push for chat and view changes (polling today), a job runner for the lifecycle tick, load test, external penetration test, incident plan (168), performance budgets (166), AML controls (161), the admin, support and finance console (PRD 71 to 89, not yet designed). | "Before launch" items in `docs/ARCHITECTURE.md`. 41 PRD rows are mapped to this phase. | Ugo (Korey for the pen-test vendor and the named safety person) | large | `docs/BUILD_PLAN.md` Phase 6, `docs/ARCHITECTURE.md` "Do before launch", PRD column "Build plan phase (v2)" |
| 13 | Features in phases 1 to 5 not yet built or only partly built: stickers (21, 54), reply and quote comments (24, 25, 56, 57), like content (26, 55), direct messages (59, 67, 109), Host Fan Live (22, 60), artist charts (36), fan-facing artist financials (63), fan-side snippet sharing (65), picture-in-picture (105), native foreground rule and camera settings (125, 127), operator console (131), studio library redesign (129, 130), viewer recordings with chat in step (31, 51), full role matrix for operators and support (147), audit events for admin actions (150), region pinning decisions (154), cost tracking (146), edit profile on the v2 boards (4 to 6, 45 to 47). | These are the "partly" and "not started" rows in `docs/STATUS.md`. | Ugo (Korey for priority) | large | `docs/STATUS.md` per-PRD table, `docs/Loudentify_PRD_User_Stories (4).xlsx` |
| 14 | Product decisions still open: what viewer-hours mean under YouTube delivery and the five pricing figures (`lib/site/pricing.js`); resume position after a reload; what happens when a Versus opponent never accepts; whether a guest can delete a shared recording; pre-show recording consent (PRD row 11); reactions design; competitions as a product. | Code is waiting on each. | Korey | small each | `docs/HANDOVER.md` section 4, PRD "Change log (1 Oct)" sheet, `docs/NEEDS_KOREY.md` Phase 5 |
| 15 | Legal and company: register the UK company and update `/privacy`, the Google consent screen and the terms; a solicitor reviews the privacy notice, Terms, Community Guidelines, cookie notice and Artist agreement (all marked DRAFT); a Data Protection Impact Assessment; a Legitimate Interests Assessment for the training-data basis; an Online Safety Act risk assessment and a named accountable person; the covers licensing path (originals only until signed); store rule check. | Required before the first public show on the new build. | Korey, a solicitor (third party) | large | `docs/ARCHITECTURE.md` "Before launch", `docs/NEEDS_KOREY.md` "Not blocking anything yet", `app/privacy/page.js` |
| 16 | Cost tracking: PRD row 146 is not started. Set up billing visibility across Supabase (three projects), Vercel (`docs/PILOT_2_BUILD_PLAN.md` notes Vercel Pro was pending), LiveKit, Google Cloud quota, Expo EAS, Apple and Google developer fees; then build the cost-per-show-hour metric `docs/ARCHITECTURE.md` asks for from the first show. | Pricing depends on knowing the cost per show-hour, and egress, compute and storage are the bills that scale. | Korey (accounts), Ugo (metric) | medium | `docs/ARCHITECTURE.md` "Keeping the cost sane", PRD Scaling sheet row 24 |
| 17 | Housekeeping: add Ugo to GitHub (he is not a collaborator today); protect `staging` with a required `ci` check; delete the unused secrets listed in `docs/NEEDS_KOREY.md`; align `staging.yml` and `promote.yml` on Node 22 (they use Node 20; `ci.yml` moved to 22 because the Supabase client wants it); archive the superseded documents listed in `docs/DOCUMENT_INDEX.md`; delete `docs/EXPORT_THESE_HERE.md` now the PRD is in the repository; decide whether the Supabase connector in the agent's sessions should see only the staging project (section I). | Small items that otherwise cost someone an afternoon later. | Korey (GitHub settings), Ugo | small | `docs/NEEDS_KOREY.md`, `docs/DOCUMENT_INDEX.md` |

### Note on the native login flow problems (item 10)

Found by reading, not by running on a device:

- `native/app/signup.js` defines the `Field` component inside the `SignUp` component body. React treats it as a new component type on every render, so each keystroke unmounts and remounts the text input. On a phone that means the keyboard closes or focus is lost after every character.
- `native/app/login.js` and `native/app/signup.js` call `supabase()` from `native/src/session.js`, which throws when `EXPO_PUBLIC_SUPABASE_URL` or `EXPO_PUBLIC_SUPABASE_ANON_KEY` is missing. Neither screen catches it, so the button stays on "Logging in" or "Creating your account" and nothing is shown. The Profile screen handles the missing case; these two do not.
- Both the native and web login screens report every sign-in failure, including a network failure, as "That email and password don't match."
- `components/viewer/SignUpSheet.jsx` links "Forgot password?" to `/forgot-password`. No such page exists in `app/`, and no password reset exists anywhere in the product.
- `native/eas.json` and the Expo Go instructions in `docs/NEEDS_KOREY.md` point `EXPO_PUBLIC_API_BASE` at `https://loud-app-git-staging-korey-alashe.vercel.app`, which sits behind Vercel's login. Discover and Live will show their error states until a staging address that is reachable without that login exists (a custom staging domain, or Vercel's protection bypass).

---

## G. Ugo's first week

### Access checklist

| System | What exists today | What Korey must grant | Notes |
|---|---|---|---|
| GitHub | Organisation `LoudEntify`, repository `LoudEntify/Loud-app`. Collaborators: `Korey01` (write), `LoudEntify` (admin). Ugo is not listed. | Add Ugo as a repository admin (or at least write, plus access to Settings for environments, secrets, variables and branch protection). Add Ugo as a required reviewer on the `production` environment. | Branch protection on `main` and the lack of it on `staging` are stated in `docs/NEEDS_KOREY.md`, not checked by me. |
| Supabase | One organisation, "LoudEntify's Org". Projects: the pilot project, `loudentify-staging` (ref `htepkxumrwtpbkahdric`), and a production project (name not recorded). | Invite Ugo to the organisation as an owner or administrator. Confirm which project is the pilot and which is production, and write both names into `docs/NEEDS_KOREY.md`. | Ugo should never run SQL against the pilot project. The staging database password lives only in the GitHub secret `SUPABASE_STAGING_DB_URL`; Ugo may need it for `supabase migration list`. |
| Vercel | Project `loud-app` under the account shown in URLs as `korey-alashe`. Deploys every branch push. Production domain loudentify.app. | Add Ugo as a team member with access to Environment Variables and Deployments. | Preview URLs require a Vercel login; a device that cannot sign in needs the protection bypass (`docs/HANDOVER.md` section 7). |
| Google Cloud | No project yet, as far as the repository shows. | Create the project (or let Ugo create it under the company account) and make Ugo an owner. | Needed for YouTube APIs, OAuth client, verification and quota. |
| LiveKit Cloud | A project exists; its keys are in Vercel as `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_URL`. | Add Ugo to the LiveKit Cloud project. | Needed for the egress work and to read room and egress logs. |
| Expo | No account; `projectId` is `SET-BY-EAS-INIT`. | Create an Expo organisation (free) and add Ugo. | `eas init` writes the project id into `native/app.json`; commit it. |
| Apple Developer Program | Not enrolled, as far as the repository shows. | Enrol (£79 a year, takes a day or two) and add Ugo as an Admin or App Manager. | Needed for TestFlight, Sign in with Apple, and the team id in `apple-app-site-association`. |
| Google Play Console | No account, as far as the repository shows. | Create the developer account (one-off fee) and add Ugo. | Needed for internal testing and the signing certificate fingerprint for `assetlinks.json`. |
| Password manager | `README.md` refers to "the password manager" for LiveKit values. | Share the vault or folder that holds LiveKit, Supabase and Vercel credentials, and the `build@loudentify.app` mailbox. | Never paste secrets into chat or into the repository. |
| Domain registrar and DNS for loudentify.app | Not described in the repository. | Access or a named contact. | Needed for a staging subdomain and for email on the contact addresses. |
| Stripe (if chosen) | Nothing exists. | Create the account when the decision in section F item 7 is made. | |

### Day by day

**Day 1: read, get access, run it locally.**
Read `docs/CLAUDE.md`, `docs/ARCHITECTURE.md`, this document, `docs/STATUS.md` and `docs/NEEDS_KOREY.md`. Get GitHub access and clone the repository. Install Node 22, a local Postgres 16 and `psql`. Follow section H "Run locally" through to the browser suite passing. Open `http://localhost:3000/discover` as a guest, sign up with a made-up email, vote, chat, support; then sign in as the seeded artist and walk `/artist/onboarding`, `/artist/schedule`, Kit Check and the console (`docs/PHASE_3_HANDOFF.md` "How to try it").

**Day 2: the tests and the migrations.**
Read `scripts/db/apply-migrations.sh`, `scripts/db/supabase-stub.sql` and `scripts/dev/local-stack.mjs` so you know exactly what the local stand-in is and is not. Read the four SQL suites in `supabase/tests/`. Read the 16 migrations dated October in order (`20261001160000` to `20261002030000`) and their rollbacks. Rehearse one rollback and re-apply locally. Read `tests/support.test.mjs`, `tests/pipeline.test.mjs` and `tests/youtube.test.mjs`, which cover the money and identity paths you will review on day 3.

**Day 3: the protected-path reviews.**
Work through the 11 items in `docs/NEEDS_KOREY.md` "Reviews needed before promotion". For each: read the migration, the library module and the route named; run the test that covers it; write down anything you would change; tick it with your name if you are satisfied, or raise a pull request if not. Read `docs/ARCHITECTURE.md` "Money", "Audit log" and "Identity, roles and access control" alongside.

**Day 4: staging, for real.**
With Korey: open the Vercel staging preview, confirm the build log shows the staging override, seed synthetic shows through `/api/dev/seed`, run the Phase 2 viewer checklist and the Phase 3 artist checklist on real phones. Try the native app in Expo Go using the steps in `docs/NEEDS_KOREY.md` Phase 4, knowing the API base problem in section F item 10. Record what you saw in `docs/NEEDS_KOREY.md`.

**Day 5: production readiness and the plan.**
Work section F item 4 end to end without running the promote. Check `.github/workflows/promote.yml` against the branch protection and the Vercel production variables. Decide with Korey the order of items 5 to 9 and who is doing what. Correct `docs/STATUS.md` and `docs/NEEDS_KOREY.md` (item 1). Archive the superseded documents per `docs/DOCUMENT_INDEX.md`. Write the first `docs/DECISIONS.md` entry under your own name.

---

## H. How to run, test, migrate, deploy and roll back

Prerequisites: Node 22, npm, Postgres 16 with `psql` on the path, git. Everything below is run from the repository root on the `staging` branch. Nothing here needs a Supabase account or any secret.

### Run locally

```bash
git clone https://github.com/LoudEntify/Loud-app.git
cd Loud-app
git checkout staging
npm ci

# A throwaway local Postgres. Any Postgres 16 will do; this is one way.
export DATABASE_URL=postgres://postgres:postgres@localhost:5432/loudentify_dev

# Apply all 59 migrations from an empty database, then seed synthetic shows.
scripts/db/apply-migrations.sh --fresh
scripts/db/seed.sh

# Download the PostgREST binary once (about 4 MB), then start the local
# Supabase stand-in (real PostgREST, fake sign-in service). Keep it running.
scripts/dev/fetch-postgrest.sh
npm run dev:stack          # writes .env.local with the local URL and keys

# In a second terminal:
npm run dev                # http://localhost:3000
```

Seeded artist for the local stack only: `synth-ama@synthetic.loudentify.invalid`, password `synthetic-pass` (`docs/PHASE_3_HANDOFF.md`). Seeded shows include `synth-live-versus` (live Versus) and `synth-live-youtube` (YouTube delivery with a public stand-in video id).

### Test

```bash
npm run check:lint         # two eslint rules plus the route authentication check
npm test                   # 66 unit tests (node --test)
npm run test:sql           # the 4 SQL permission suites, each in a rolled-back transaction
npm run check:build        # next build, missing-import warnings treated as errors
npm run check              # lint, unit tests, window tests, build (what staging.yml runs)
npm run e2e                # builds, starts a throwaway stack and app, runs the 39 browser steps, tears down
E2E_SUITES=site npm run e2e   # one suite: viewer, artist or site
```

The browser suite refuses to start if something is already listening on port 3000 or 54321. It needs Chromium; CI installs it with `npx playwright install --with-deps chromium`.

Native:

```bash
cd native && npm ci
npx expo install --check   # every dependency at the SDK 57 version
npx expo-doctor
npx expo export --platform ios --platform android --output-dir /tmp/expo-export
npx expo start             # then scan with Expo Go; see docs/NEEDS_KOREY.md Phase 4 for native/.env
```

### Write a migration

1. Create `supabase/migrations/YYYYMMDDHHMMSS_short_name.sql`. Follow the ritual in `docs/CLAUDE.md` section 3: check foreign key types, check `information_schema.columns` for every altered table, audit conflict targets, check policies, include verification queries, end with `notify pgrst, 'reload schema'`.
2. Create `supabase/rollbacks/YYYYMMDDHHMMSS_short_name.sql` that undoes it.
3. Add or extend a suite in `supabase/tests/` with permission tests for every role, including negative cases.
4. Rehearse locally:

```bash
scripts/db/apply-migrations.sh --fresh
scripts/db/run-sql-tests.sh
psql "$DATABASE_URL" -f supabase/rollbacks/YYYYMMDDHHMMSS_short_name.sql
psql "$DATABASE_URL" -f supabase/migrations/YYYYMMDDHHMMSS_short_name.sql
```

5. Never edit a migration after it has been applied anywhere. Write a new one.

### Deploy to staging

```bash
git checkout -b feature/short-name staging
# ... commit ...
git push -u origin feature/short-name
# Open a pull request into staging on GitHub. The description must name the PRD rows,
# the Scaling and Infrastructure area, the migrations and the tests (docs/CLAUDE.md section 1).
# When ci is green, merge. staging.yml then runs:
#   npm run check
#   guard: SUPABASE_STAGING_DB_URL must contain STAGING_PROJECT_REF
#   supabase db push --db-url "$SUPABASE_STAGING_DB_URL" --yes
#   supabase migration list --db-url "$SUPABASE_STAGING_DB_URL"
# Vercel rebuilds https://loud-app-git-staging-korey-alashe.vercel.app on its own.
```

To check what the staging database holds, with the Supabase CLI installed and the connection string from the GitHub secret:

```bash
supabase migration list --db-url "<SUPABASE_STAGING_DB_URL>"
```

### Promote to production

Only after section F items 2 and 4. On GitHub: Actions, "promote", "Run workflow". The `check-protected-paths` job fails if any `- [ ]` remains under "Reviews needed before promotion" in `docs/NEEDS_KOREY.md`. The `promote` job then waits for the `production` environment approval, fast-forwards `main` to `staging`, pushes, and runs `supabase db push --db-url "$SUPABASE_PRODUCTION_DB_URL" --yes`. Vercel deploys `main`.

### Roll back

There is no automated rollback workflow. Three levels:

1. Code on Vercel: Vercel dashboard, Deployments, pick the previous production deployment, "Promote to Production" (instant rollback). This does not touch the database.
2. Code in git: `git revert <merge-sha>` on a branch, pull request into `staging`, merge, then promote again. Never force-push or rewrite history on `staging` or `main`.
3. Database: run the matching rollback file against that environment's database, newest first, by hand with `psql "<DB_URL>" -f supabase/rollbacks/<file>.sql`. Then remove the version row from `supabase_migrations.schema_migrations` so the CLI agrees. Rehearse on staging first. Some rollbacks refuse on purpose when real rows exist (for example `20261001160200_ledger_double_entry.sql` will not drop a real money row). Production database rollback needs the production connection string, which only the `production` environment holds, so it is a Korey-plus-Ugo action with the audit entry `docs/ARCHITECTURE.md` asks for.

### Other useful commands

```bash
node scripts/route-auth-check.mjs     # which API routes have no auth and why that is accepted
npm run smoke                         # signed-in smoke check against a deployment (needs SMOKE_URL, SMOKE_EMAIL, SMOKE_PASSWORD)
npm run probe:auth                    # asks a deployment for things it must refuse
```

---

## I. Glossary, and Not verified or conflicting

### Glossary

| Term | Meaning |
|---|---|
| Append-only | Rows can be added but never changed or deleted. Corrections are new rows. |
| Audit log | The record of every privileged action. Here it is a hash chain: each entry carries a hash of the one before, so an edit breaks the chain. |
| Branch | A separate line of changes in git. `staging` and `main` are branches. |
| CI (continuous integration) | Automated checks that run on every push and pull request. Here `.github/workflows/ci.yml`. |
| Compositor | The code that builds one portrait picture from the camera feeds (solo, or one of three Versus views). |
| Double-entry ledger | Every movement of tokens is two matching entries that sum to zero, so balances are derived and nothing can create money. |
| Egress | The service that takes the composed picture out of the live room and sends it to YouTube and to a recording. |
| Environment (GitHub) | A named set of secrets and approval rules in the repository. `staging` and `production`. |
| Expo, EAS, Expo Go | Expo is the framework for the native app; EAS is Expo's cloud build service; Expo Go is a store app that can run an Expo project without a build. |
| GoTrue | Supabase's sign-in service. The local stack fakes the handful of calls the app uses. |
| Idempotent | Doing it twice has the same effect as doing it once. A double tap on Support pays once. |
| LiveKit | The real-time video service (WebRTC) that carries camera feeds and runs egress. |
| Migration | A versioned SQL file that changes the database structure. |
| OAuth | The standard by which an artist lets Loudentify act on their YouTube channel without giving us their password. |
| PlayerSource | The one interface viewers' players sit behind: `youtube`, `loudentify-llhls`, `fixture`. |
| PostgREST | The service that turns the Postgres database into the API Supabase exposes. The local stack runs the real binary. |
| Promote | Running `.github/workflows/promote.yml` to move `staging` into production. |
| Protected path | Code or migrations touching money, identity, permissions or the audit log. Need a human review before promotion. |
| Pull request | A proposal to merge a branch, with a description and automated checks. |
| RLS (row-level security) | Rules inside the database that decide which rows each caller may see or change. The main permission control. |
| RTMP | The protocol used to push live video to YouTube. |
| Rollback | A script that undoes a migration. |
| Secret | A password, key or connection string. Stored in GitHub environments or Vercel, never in the repository. |
| Service role | The Supabase key that bypasses RLS. Server-side only. Tables with zero policies are written only with it. |
| Supabase | The hosted Postgres database, sign-in and storage service. Each environment is a separate Supabase project. |
| Vercel | The hosting service for the web app. It builds every branch push; the `staging` branch gets a "preview" address. |
| Versus | Two artists in one show. |

### Not verified or conflicting

1. **Staging database state.** `docs/STATUS.md` ("Staging database: not verified, the staging database password is wrong") and `docs/NEEDS_KOREY.md` ("Blocking right now: the staging database URL has the wrong password") disagree with the GitHub Actions logs. Workflow `staging` run 5 attempt 3 (2 October 2026, 01:07 UTC), run 6 (11:14 UTC) and run 8 (15:58 UTC) all applied migrations successfully; run 8 lists 59 local and 59 remote. Run 7 (11:39 UTC) failed with "password authentication failed" between two successes, for a reason not established. The two documents are stale on this point.

2. **Which branch is the frozen pilot.** The brief and `docs/CLAUDE.md` say `pilot-freeze-v2` (last commit 14 August 2026). `docs/health_events_test_script.md` says production was "currently served from `pilot-freeze-v3`" (15 August). `docs/DECISIONS.md` (1 October) records a check of the Vercel API showing loudentify.app deployed from `main`, and `main` carries the pilot-2 work from September plus the `/privacy` page. So the live pilot code is `main`, and `pilot-freeze-v2` is an older fallback. The shallow clone available to me could not settle how far `pilot-freeze-v2` and `main` diverge.

3. **The production Supabase project.** The brief says it exists and is empty. The repository holds no name or ref for it, `promote.yml` needs `PRODUCTION_PROJECT_REF` and `SUPABASE_PRODUCTION_DB_URL`, and I could not see whether either is set. The Supabase connector attached to this session does not list it.

4. **What the build agent's Supabase connector can see.** The connector lists exactly one project: `LoudEntify`, ref `jwnzhlfhwznatkrgsrqc`, London, created 31 July 2026. It does not list `loudentify-staging`. If that project is the pilot, the agent's session has a path to the pilot database, which `docs/CLAUDE.md` section 2 and `docs/ARCHITECTURE.md` say it must never have. I did not query it. Korey should confirm which project it is and rescope the connector to staging only.

5. **Vercel production variables.** Whether `NEXT_PUBLIC_SUPABASE_URL` and friends on the Vercel Production scope still point at the pilot project could not be checked from the repository. If they do, the first promote deploys the new code against the pilot database. Nothing in `lib/supabaseBuildEnv.cjs` guards production.

6. **Branch protection versus the promote workflow.** `docs/NEEDS_KOREY.md` says `main` requires a pull request with one approval and blocks force-push. `promote.yml` does a direct `git push origin main` with the workflow token. Unless the rule exempts the workflow, the push will be rejected. Not tested; `promote` has never been run.

7. **Unit test count.** `docs/STATUS.md` says 42 unit tests. The file set on `staging` has 66 (pull requests #4 and #5 added `tests/supabase-env.test.mjs` and others). The `check` job counts 66.

8. **The PRD file name.** `docs/CLAUDE.md` cites `docs/Loudentify_PRD_User_Stories.xlsx`. The file in the repository is `docs/Loudentify_PRD_User_Stories (4).xlsx`. `docs/NEEDS_KOREY.md` still says the spreadsheet is missing; `docs/BUILD_PLAN.md` says it landed on 2 October. It is present.

9. **Row-level security on `health_events`.** `docs/REPO_AUDIT.md` and `docs/BUILD_AUDIT_2026-08.md` say the migration file never enables RLS; `docs/SECURITY_AUDIT_2026-08-28.md` and `docs/MORNING_MIGRATIONS.md` treat it as RLS on with zero policies. The file `supabase/migrations/20260818000100_health_events.sql` contains no RLS statement. In the fresh local database built from all 59 migrations on 3 October, `health_events` has RLS enabled with zero policies, so a later migration or the stub enables it. What the pilot project has was never queried.

10. **Node versions.** `ci.yml` runs Node 22 (its commit says the Supabase client 2.111 wants it). `staging.yml` and `promote.yml` run Node 20 and still pass `npm run check`.

11. **Vercel account and project names.** `loud-app`, `korey-alashe`, `loud-app-umber.vercel.app` and the preview URL pattern come from documents and URL strings, not from Vercel itself.

12. **Pilot 1 date and the dress rehearsal results.** No document states the date of pilot 1. `docs/SATURDAY_REHEARSAL.md` is a run sheet with no results recorded. The 20 September show's outcome is recorded only as lessons, not as a results sheet.

13. **The pilot-2 docs disagree with themselves** on which items were cut on 14 September (presence sampler, stale-session sweep, item 9 webhooks) and on migration numbering (`pilot2_06` and `_07` versus `_09` and `_10`). See `docs/PILOT_2_BUILD_PLAN.md` sections 4, 11, 13 and 14. Historical only.

14. **`docs/OVERNIGHT2_DEVICE_TEST.md` and `docs/MORNING_BRIEF.md`** disagree on whether a paired camera's device secret survives a closed tab. The root `DECISIONS.md` (28 August) records the reversal: it is now persisted. Historical only.

15. **Design boards.** `docs/REPO_AUDIT.md` says `design/canvas.json` "groups them into 10 boards". The file holds 106 boards under 18 row headings, matching the 106 `.dc.html` files and `docs/SCREEN_INVENTORY.md` (86 plus 20 YouTube variants).

16. **Local browser suite.** My first local run of `npm run e2e` reported 0 of 20 because I had skipped the build step and the previous build carried no local Supabase values. A clean run from the `staging` head passed all 39 steps. CI's `e2e` job on `b962ff6` is green independently.

17. **LiveKit plan and region, Vercel plan, Supabase plans.** None are described in the repository. `docs/PILOT_2_BUILD_PLAN.md` mentions Vercel Pro as pending in September.
