# Loudentify: standing instructions for Claude Code

Read this file first, every session. It overrides habits. Korey Alashe (CEO) is the product owner. He is not an engineer and will not be available to answer questions while you work.

## 1. How to work (autonomy)

- Never ask Korey a question or for approval. Decide, then write one line in `docs/DECISIONS.md` (date, decision, reason, the option you rejected) and carry on.
- If something truly needs a human (create an account, paste a secret, Apple or Google store credential, legal sign-off, a third-party approval), add an entry to `docs/NEEDS_KOREY.md` with exact click-by-click steps, then continue with other work. One blocker never stops the whole run.
- Run everything yourself: migrations on staging, tests, the dev server, builds. Fix failures and re-run until green. Do not hand back red work.
- Report in plain English first (what changed, what Korey can try, what is blocked), technical detail after. No jargon in the summary.
- Work in small pull requests. Each PR description must name: the PRD rows touched (`docs/Loudentify_PRD_User_Stories.xlsx`), the Scaling and Infrastructure area (Database, Stateless hosting, Real-time media, Background jobs, Rate limiting, Auth, Observability), the migrations, and the tests added.
- Instrument before fixing. Never claim success without verifying against the running environment. Never build on an unconfirmed hypothesis.

## 2. Environments and release flow

Three environments: local, staging, production. Separate Supabase projects, separate keys, separate data.

- You only ever hold STAGING credentials. Production credentials exist only as GitHub environment secrets (environment name `production`) and are used only by the `promote` workflow. Never put a production key in the repo, a cloud environment variable, a chat, or your context.
- Flow: feature branch, PR into `staging`, CI runs tests, PR merges when green (enable auto-merge), the `staging` pipeline applies migrations to the staging database and deploys staging. Korey tests on staging. When he approves, he runs the `promote` workflow (manual run, one approval click on the `production` environment). It merges `staging` into `main`, applies the same migration files to production, and deploys production.
- Build and keep these workflows: `ci.yml`, `staging.yml`, `promote.yml`. If a push to `.github/workflows` is rejected for permissions, add the files to `docs/NEEDS_KOREY.md` as ready-to-paste content and carry on.
- Protected paths (money and ledger code, identity and auth, permissions and row-level security, the audit log, and their migrations) need a recorded human approval (Ugo or Korey) before they can be promoted. You may merge them into `staging` yourself. The `promote` workflow must check for the approval and refuse if it is missing. List each one in `docs/NEEDS_KOREY.md` under "Reviews needed before promotion" with a plain-English summary of the risk.
- Never touch `pilot-freeze-v2` or the existing pilot Supabase project. They are the frozen fallback. The new build uses new staging and production projects (region: UK/EU, London if available).
- Never force-push. Never rewrite history on `staging` or `main`.

## 3. Migrations (always)

- SQL files in `supabase/migrations/`, timestamped, never edited after they have been applied anywhere. Every migration has a matching rollback script in `supabase/rollbacks/`.
- Ritual before each migration: check foreign key types (uuid vs bigint has bitten us), check `information_schema.columns` for every altered table, audit conflict targets, check policies, write verification queries, finish with `notify pgrst, 'reload schema'`.
- Apply to staging through the pipeline, then run the verification queries against staging and record results in the PR. Rehearse destructive migrations against a copy first.
- Row-level security on every table in the core store, with permission tests for every role, including negative cases. A non-owner request must never receive owner fields.
- Test data is synthetic. Production data never goes to staging.

## 4. Architecture rules (summary only: `docs/ARCHITECTURE.md` v2 is the full standard and wins on detail)

1. The show must never stop. Failed checks warn, they do not kill the stream. Degrade order: analytics, viewer counts, comments read-only, single camera, video quality, then end with an honest message and keep the recording. Money and safety controls fail closed.
2. Least data, least access, least time.
3. Anything touching money, identity or someone else's data leaves an audit trace. If it cannot be audited it does not ship.
4. Own the record, rent the delivery. YouTube carries the picture, but show state, recordings, chat, votes and money stay ours, and delivery stays behind `PlayerSource`.

Build first, because they cannot be retrofitted: row-level security and the permission model (users belong to organisations, a solo artist is an organisation of one); the separate append-only hash-chained audit log; the double-entry append-only ledger with idempotency keys; consent and preference records including the training-data choice (legitimate interests basis, separate line at sign-up for performers only, switchable any time, every change audited); data classification in the schema so export and delete can be automated; correlation ids and journey events.

Also: no payments in the native apps (balances only); 18+ gate by date of birth, under-18 date never stored; short-lived access tokens, rotating refresh tokens, passkeys and Apple/Google sign-in; signed short-lived media URLs; no card or ID document data ever stored by us; artist share 72.5% recorded at transaction time; competition outcomes from verified-fan votes, never token volume; no human has standing production credentials.

## 5. Product decisions that are settled

- Zoom is lens zoom only, never digital. Default 1.2x, editable per camera. LUTs and background blur are not at launch.
- Do not change the AI director shot grammar. Cuts, close-ups, wide, moving zoom, pan and B-roll inserts are individually switchable by the artist.
- One feed per physical device. Camera healthy means frames keep arriving, not that it connected. Watch mic on the raw input.
- Reactions are stamped with the viewer's playback position, not wall clock. Reaction design is on hold: leave a tab beside emoji.
- Shows are booked at least 30 minutes ahead. No unscheduled go-live. Hours running out never stops a show.
- Active performer and the current Versus view are show-level facts on `shows`, not per-artist rows.
- Viewer delivery goes behind one interface (`PlayerSource`) with two implementations: `youtube` (first) and `loudentify-llhls` (later, when funded). Switching is configuration, not a rewrite. See `docs/YOUTUBE_ADDENDUM.md`.

## 6. Design

`design/` holds the approved screens (reference markup, not production code). Match layout, copy, states, colours and behaviour. `[Square brackets]` are data placeholders. Tokens: Ink Black #011627, Porcelain #fdfffc, Teal #2ec4b6, Red #e71d36, Orange #ff9f1c, font PT Sans Narrow, silk gradients, touch targets at least 44px, text contrast at least 4.5:1 (teal or orange text only on ink). Every screen needs loading, empty, error, offline and success states. Nothing may ever overlay the YouTube player frame.

## 7. Testing and gates

Permission tests per endpoint and role; ledger property tests (balances derivable, idempotency holds, no path creates money); realistic load test; failure drills (camera stall, mic dies, connection drops). Device testing on real phones is Korey's gate: list each build's device checklist in `docs/NEEDS_KOREY.md`. Nothing is called pilot-ready before a dress rehearsal on real devices.
