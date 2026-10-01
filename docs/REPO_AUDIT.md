# Repo audit

1 October 2026. Written by Claude Code as Step 1 of the Loudentify rebuild. Covers `app/`, `components/`, `lib/`, `scripts/`, every loose `.sql` file under `docs/`, the design screens, and the infrastructure actually present on disk.

## Plain English

The pilot build has a real, working core: the AI director that decides camera cuts, the multi-camera pairing system, the audio mixing, Versus (two artists sharing a show), the wallet ledger, and the live video pipeline through LiveKit. All of it has been run on real phones in real rehearsals, and the team's own `docs/HANDOVER.md` already says plainly which parts are device-tested. None of that needs rebuilding, and the architecture doc and CLAUDE.md both say not to.

What's missing is everything the new architecture doc calls "build first because it can't be retrofitted": there is no audit log, no proper double-entry ledger (there's an append-only, idempotent ledger, which is close but not the same thing), no organisation/permission model, no consent or training-data-choice records, and no data classification in the schema. There's also no YouTube delivery code at all yet — the `PlayerSource` interface the YouTube addendum describes doesn't exist. And the database itself isn't managed as code: 60-odd migration files sit as loose, unordered `.sql` files directly in `docs/`, several with stray duplicate copies, and a meaningful number of tables have no row-level security policies at all.

The single biggest risk is that this is still a one-environment system. There's one Supabase project (the frozen pilot one), no staging, no CI, and no automated tests beyond a handful of hand-written Node scripts — so "build first" items like RLS and the ledger have to be designed into a database that doesn't exist yet, cleanly, rather than retrofitted into the pilot project, which must not be touched.

## Reuse as-is

Per `docs/HANDOVER.md` §2 and direct reading, these are device-tested and must not be rebuilt (CLAUDE.md: "do not change the AI director shot grammar"; "do not rebuild anything that is tested and agreed"):

- **AI director / shot grammar** — `lib/shotTypes.js` (395 lines: every shot — `wide`, `mediumCU`, `closeUp`, `bRoll`, `zoomIn`, `zoomOut`, `pan`, `staccato`, `bRollClip` — portrait crop values, transitions), `lib/autoDirector.js` (239 lines: fixed choreography cycle wide→mediumCU→closeUp→bRoll→mediumCU, per-framing hold durations, single-camera fallback), `lib/shotCommands.js` (377 lines: command transport over LiveKit data channel, staccato sequencer, flywheel logging). Load-bearing rules not to touch: `decisionSource` is exactly `auto | human | cue`; motion hard-capped at 1.2× zoom; slot roles are intent-based (`wide`/`close`/`side`), never device ID.
- **Camera/device layer** — `lib/trackSources.js` (discriminator for feed roles), `lib/trackLiveness.js` (liveness registry — a camera is healthy only if frames keep arriving, matches ARCHITECTURE.md's rule verbatim), `lib/camfeedPairing.js`, `lib/camfeedDevice.js`, `lib/pairingLiveness.js`, `components/CamViewfinder.jsx`, `components/CamPair.jsx`.
- **Show session state** — `lib/showSessionState.js` (354 lines), `lib/showState.js`, `lib/showWindow.js`.
- **Audio** — `lib/audioHost.js`, `lib/audioProcessing.js`, `lib/audioSyncCalibration.js`, `lib/micState.js`, `components/AudioHostProvider.jsx`, `components/AudioDeckPanel.jsx`.
- **Backing tracks, set lists, cue sheets** — `lib/setLists.js`, `lib/cueDirector.js`, `lib/cueSheetValidation.js`, `components/BackingTrackLibrary.jsx`, `components/CueSheetLibrary.jsx`, `components/SetListPanel.jsx`.
- **Versus** — `components/VersusSplit.jsx`, show-level "active performer" / current view facts already modelled on `shows` (matches ARCHITECTURE.md v2 exactly — see `app/api/show/active-performer/route.js`).
- **Notifications** — `components/Notifications.jsx`, `lib/unreadCount.js`, `docs/mvp3_02_notifications_versus_invite.sql`.
- **Wallet/ledger mechanics (correct by reading, partially device-tested)** — `lib/ledger.js` (104 lines): append-only, idempotent via `on conflict (idempotency_key) do nothing`, signed integer amounts, service-role-only writes (no insert policy exists for the browser), a DB trigger blocks update/delete even for service role (`docs/overnight2_06_wallet_transactions.sql`). This is correct and should not be rewritten — it needs *extending* to true double-entry pairs, not replacing (see "Missing" below).
- **Health telemetry** — `lib/healthLog.js`, `lib/publisherStats.js`, `lib/transportDiagnostics.js` — this is the closest thing to real instrumentation in the repo today and is sound.
- **Permission test scripts** — `scripts/route-auth-check.mjs`, `scripts/api-auth-probe.mjs`, `scripts/api-authz-probe.mjs` were written directly in response to `docs/SECURITY_AUDIT_2026-08-28.md` findings and are genuinely checking something (static route-auth shape plus live probes). Keep and extend these rather than discarding them for a new framework.

## Reuse with adaptation

- **Egress / recording pipeline** (`app/api/egress/{start,stop,verify,webhook}/route.js`, `components/EgressPage.jsx`) — a real, working LiveKit-egress-to-S3 pipeline with a directed portrait template (not a raw grid), already auth-fixed per the security audit (`verifyArtistAuth` + `verifyShowOwner` added). This is the same egress the YouTube addendum wants reused for the RTMP-to-YouTube leg and the training copy — needs a second egress output (RTMP to YouTube) added alongside the existing S3 recording output, not a rebuild. Flagged in `docs/YOUTUBE_ADDENDUM.md` as "same egress output... also recorded... Only one egress stream per show" — current code only does the S3 leg.
- **Auth** — `lib/supabaseAuth.js` (251 lines, real Supabase Auth email+password, replacing an old localStorage mock) is sound but is password/email only; ARCHITECTURE.md v2 wants passkeys + Apple/Google sign-in from launch, which isn't here.
- **Viewer entry (no-account path)** — `app/api/viewer-session/route.js`, `app/api/reactions/route.js`, `app/api/show-comments/route.js`, `app/api/prompt-responses/route.js` are all deliberately open/unauthenticated by design (viewers have no account, confirmed in code comments and `docs/SECURITY_AUDIT_2026-08-28.md`). This matches the YouTube addendum's viewer model but all of it needs re-pointing at an embedded YouTube player instead of the current LiveKit `ViewerStage`/`ShotRenderer` direct-view path — viewers currently watch the LiveKit-composed feed directly, not through YouTube.
- **Design screens vs components** — 106 `.dc.html` files exist in `design/`, matching the groups `design/README.md` describes. `canvas.json` groups them into 10 boards. Spot-checked: `YT-Show.dc.html`, `YT-Waiting.dc.html`, `WebYT-ShowPage.dc.html` and the rest of the `YT-*`/`WebYT-*` set (the YouTube viewer variant) have **no corresponding component yet** — there is no `PlayerSource`, no YouTube embed component, nothing under `components/` referencing an embedded player. Older boards like `Live.dc.html`, `Console.dc.html`, `KitCheck.dc.html` map reasonably well to the existing `components/LiveDemo.jsx`-era screens and mostly need re-skinning to the new visual tokens (Ink Black/Porcelain/Teal, PT Sans Narrow) rather than new logic.

## Missing / must build

Mapped to the six-phase build plan:

**Phase 1 (Foundations)** — everything in CLAUDE.md §4's "build first" list is genuinely absent:
- No organisation/permission model. `grep -r "organi[sz]ation"` across `lib/`, `app/`, `components/`, and every migration returns nothing. Today's model is a flat `profiles` table with role flags.
- No audit log. There is no `audit_log` table or write-only audit store anywhere. The only hits for "audit" are comments referencing `docs/SECURITY_AUDIT_2026-08-28.md` (a point-in-time review document, not a running log) and the health-event telemetry, which is operational logging, not a tamper-evident privileged-action log.
- Ledger is append-only + idempotent (good) but not double-entry — it's single signed rows per movement, not matching debit/credit pairs. Needs extending, not replacing.
- No consent/training-data-choice records anywhere in the schema or code. `grep` hits for "training" are all about the AI director's *own* training-data pipeline naming (e.g. `reaction_events` columns), not a user-facing consent toggle or audit trail for it.
- No data classification in the schema (no column/table tagging what's personal, financial, etc.).
- No correlation ids. One hit, in `components/LiveDemo.jsx`, is incidental, not a systematic correlation-id-through-logs-and-audit scheme.
- No `PlayerSource` interface or any YouTube API integration code exists. This is 100% greenfield for Phase 2/3.
- No environments: one Supabase project only (the frozen pilot one — do not touch), no `staging` branch, no CI.

**Phase 2 (Viewer experience, web)** — the YouTube embed, the `PlayerSource` interface, viewer-side vote/reaction playback-position stamping (currently reactions/votes are wall-clock, not playback-position — ARCHITECTURE.md v2 explicitly requires playback-position stamping for YouTube's added delay), the cookie-consent-gated embed.

**Phase 3 (Artist experience and live pipeline)** — the YouTube broadcast creation (API calls to create/end a broadcast, store the video id), the Google/YouTube OAuth connect flow with token storage and rotation, the second egress leg (RTMP out to YouTube) alongside the existing S3 recording leg, the Versus-to-two-channels fan-out.

**Phase 4 (Native apps)** — nothing native exists; this is a Next.js web app only (`next.config.js`, `app/` is Next.js App Router). Every native screen is greenfield, though the shot grammar, ledger, and session-state logic can likely be shared or ported since they're plain JS modules with no Next.js-specific coupling in most cases (`lib/shotTypes.js`, `lib/autoDirector.js`, `lib/ledger.js` have no Next.js imports).

**Phase 5 (Website)** — `WebHome.dc.html`, `WebForArtists.dc.html`, `WebPricing.dc.html` etc. exist as designs; no website routes exist in `app/` beyond the app itself (no marketing site routes under `app/`).

**Phase 6 (Hardening)** — penetration test, load test, restore drill, accessibility pass: none exist yet. `scripts/window-tests.mjs` and the auth probes are the only automated checks today.

## Data layer reality

60 `.sql` files sit directly under `docs/`, unordered, un-timestamped as a system (most have `_01`, `_02` sequence numbers within one round but rounds don't compose into one ordered migration history), with no `supabase/migrations/` folder and no linked Supabase CLI project (no `supabase/config.toml`).

**Duplicate files** (16 are tracked in git, under literal `" 2.ext"` names — almost certainly an accidental `git add -A` of macOS "keep both" copies, per the commit `05cf6b4 Untrack the files my own git add -A swept in`, which evidently didn't catch all of them):
- `docs/age_policy_migration 2.sql`, `broll_migration 2.sql`, `notifications_conflict_target_migration 2.sql`, `wallet_migration 2.sql` — all **byte-identical** to their non-`2` counterparts. Pure dead weight, safe to delete.
- `app/api/reactions/route 2.js`, `app/cam/pair/page 2.js`, `app/kit-check/page 2.js`, `app/live/page 2.js`, `app/wallet/checkout/page 2.js`, `app/welcome/page 2.js`, `app/icon 2.svg`, `components/AuthButton 2.jsx`, `components/EmptyState 2.jsx`, `components/MyProfileRedirect 2.jsx`, `components/RequireAuth 2.jsx`, `lib/countries 2.js` — these are **stale earlier versions** of the real file (confirmed by both `diff` and mtime: every `2`-suffixed file is older than its counterpart, several substantially so — e.g. `components/CamViewfinder 2.jsx` is missing an entire wake-lock/facing-mode/health-log subsystem that `CamViewfinder.jsx` has). Several of these (`lib/camfeedDevice 2.js`, `lib/brollLimits 2.js`, `scripts/route-auth-check 2.mjs`, `scripts/api-auth-probe 2.mjs`, `scripts/api-authz-probe 2.mjs`) are untracked, so they're just loose cruft on disk, not in history. None of this is functionally dangerous as long as nothing imports the `2` files (nothing does — they're dead code), but they are noise in any audit or search and should be deleted in Phase 1 cleanup.

**RLS coverage**, audited directly against every file (`grep -c "ENABLE ROW LEVEL"` / `"CREATE POLICY"` per file):
- Tables with RLS enabled **and** policies: `broll_*`, `mvp1_show_session_state`, `mvp2_backing_tracks`, `mvp2_set_lists`, `mvp2_set_list_items`, `overnight2_03_follows`, `overnight2_04_account_requests`, `overnight2_07_payment_intents`, `overnight2_09_cashout_requests`, `ownership_migration`, `profiles_migration`, `recordings_migration`, `scheduling_migration`, `wallet_migration`.
- Tables with RLS **enabled but zero policies** (meaning: nobody — not even the owner — can read/write via PostgREST; everything must go through the service role, which may be intentional for some of these but is worth confirming per table): `cue_sheets_migration.sql`, `overnight2_01_camfeed_pairings.sql`, `overnight2_06_wallet_transactions.sql` (intentional — ledger writes go through `lib/ledger.js`'s service-role path, confirmed above), `overnight2_08_webhook_events.sql`, `overnight2_11_reaction_events.sql`, `pilot2_02_viewer_sessions.sql`, `pilot2_03_show_comments.sql`, `pilot2_05_room_events.sql`, `pilot2_06_show_prompts.sql`, `pilot2_07_prompt_responses.sql`, `pilot2_08_show_moderators.sql`, `show_access_migration.sql`.
- Tables with **no RLS at all**: `age_policy_migration.sql`, `cue_sheets_migration_v2.sql`, `health_events_migration.sql`, `mvp2_04_show_session_state_set_list.sql`, `mvp3_01_shot_commands_artist.sql`, `mvp3_02_notifications_versus_invite.sql`, `mvp3_03_show_slots_invited_user.sql`, `notifications_conflict_target_migration.sql`, `overnight2_02_profiles.sql`, `overnight2_05_shows.sql`, `overnight2_10_recordings.sql`, `overnight2_12_shows_duration.sql`, `profile_fields_migration.sql`, `write_path_fixes_migration.sql`. **`overnight2_02_profiles.sql` and `overnight2_05_shows.sql` having no RLS is the one worth flagging loudest** — profiles and shows are core, broadly-readable-but-not-broadly-writable tables, and ARCHITECTURE.md calls RLS "the single highest-value control in the whole list." (Open question for NEEDS_KOREY/DECISIONS: confirm whether RLS on these two is actually enabled directly in the live Supabase dashboard rather than migration files — the pilot project predates some of this migration discipline, so dashboard-applied policies wouldn't show up in `docs/*.sql` at all. This audit can only see what's in the repo.)

## Infra reality

- No `.github/workflows/` directory — no CI, no staging pipeline, no promote workflow exist as files.
- No `supabase/` CLI project — no `config.toml`, no `supabase/migrations/`, no `supabase/rollbacks/`. Migrations are loose files in `docs/` as described above.
- No `SUPABASE_ACCESS_TOKEN` in the environment — the Supabase CLI cannot provision or link a project non-interactively from this session.
- No `gh` CLI installed or authenticated — no programmatic GitHub PR/secrets/environment management from this session.
- Docker daemon was not running when checked (an `open -a Docker` was fired in the background during this session; may or may not be up by the time this is read).
- Current git branch: `fix/mic-source-recovery`. No `staging` branch exists anywhere, local or remote. Branches present are feature branches, several `pilot-freeze*`/`pilot2-*` branches, and `main`.
- `.env.preview.local` and `.env.local` only reference the existing pilot Supabase project and Vercel preview config — this is the project CLAUDE.md explicitly says must not be touched (`pilot-freeze-v2`). No separate staging or production Supabase credentials exist anywhere in this repo or environment.
- No test framework (`jest`/`vitest`/etc.) in `package.json`. `playwright` is a devDependency but no playwright config or test files exist anywhere in the tree. "Tests" today means: `scripts/smoke.mjs`, `scripts/route-auth-check.mjs` (static), `scripts/api-auth-probe.mjs` / `api-authz-probe.mjs` (live, need a deployment), `scripts/window-tests.mjs`, and `npm run check` which chains eslint-based checks (`check:tdz`, `check:undef`) plus a build-warning check. These are real and were written in direct response to real incidents (per `docs/SECURITY_AUDIT_2026-08-28.md`), but there is no unit or integration test suite in the conventional sense, and nothing runs in CI because there is no CI.

## Open questions / ambiguities

For the DECISIONS/NEEDS_KOREY step to pick up:

- Whether `overnight2_02_profiles.sql` and `overnight2_05_shows.sql` genuinely have no RLS in the live pilot database, or whether policies were applied by hand in the Supabase dashboard and never captured as a migration file. Matters for whether the new staging project needs these written from scratch (it does, regardless — pilot stays frozen) but matters for trusting the migration history as a record of truth.
- Whether the ledger's single-signed-row-per-movement design should become true double-entry (matching debit/credit pairs) as a Phase 1 migration, or whether the existing append-only + idempotent design (which already satisfies "balances derivable, idempotency holds, no path creates money" in practice) is judged good enough and just needs a second mirroring entry added per transaction type.
- Whether "viewer-hours" (ARCHITECTURE.md v2's explicit "decision needed") gets resolved as part of Phase 1 metering design or deferred to Phase 2/3 when YouTube metering is actually built.
- The 16 tracked duplicate `" 2.ext"` files and the untracked ones alongside them — safe to delete, but flagging rather than deleting unilaterally since some are tracked in git history and deleting is a visible change outside pure documentation.
- Google/YouTube OAuth verification (sensitive scope, quota) is called out in both ARCHITECTURE.md v2 and YOUTUBE_ADDENDUM.md as something to log in NEEDS_KOREY on day one — this audit confirms there is currently zero code or config toward it, so it's a true cold start, not a partial one.
