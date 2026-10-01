# Build plan

1 October 2026. Step 2 of the Loudentify rebuild, following `docs/REPO_AUDIT.md`. Six phases. `docs/ARCHITECTURE.md` v2 wins on any detail; this plan sequences work against it and against `docs/YOUTUBE_ADDENDUM.md`.

**PRD rows, up front, once:** `docs/CLAUDE.md` §1 requires every PR to name the PRD rows it touches from `docs/Loudentify_PRD_User_Stories.xlsx`. That file has never been exported into this repo (`docs/EXPORT_THESE_HERE.md` has been asking for it since before this session). It is in `docs/NEEDS_KOREY.md` as a day-one blocker. Until it lands, every phase below cites `design/README.md`'s screen groups and `docs/ARCHITECTURE.md` sections as the closest thing to requirements rows that actually exists in the repo, and flags itself as "PRD rows: pending export" rather than inventing row numbers that would need reconciling later.

---

## Phase 1 — Foundations

**PRD rows:** pending export. Stand-in: `docs/ARCHITECTURE.md` "What to do in what order → Do first" (the eight-item list), `docs/CLAUDE.md` §§2–4 in full.

**Scaling area:** Database, Auth, Observability.

**Migrations:** the 43 existing `docs/*.sql` files restructured into `supabase/migrations/` (done this session — see `docs/REPO_AUDIT.md` "Data layer reality" and the migration-restructure commit), plus new migrations for: the organisation/role model, the append-only hash-chained audit log, extending the existing ledger to true double-entry pairs, consent/training-data-choice records, data-classification tagging, correlation-id plumbing, and closing the RLS gap the audit found on `profiles` and `shows`.

**Tests:** permission tests per role including negative cases (a non-owner request must return zero owner fields — the existing `scripts/api-authz-probe.mjs` pattern, extended to the new tables); ledger property tests (balances derivable, idempotency holds, no path creates money); local verification of every migration against a disposable Supabase instance before it is considered done.

**Definition of done, plain English:** there is a real staging environment separate from the frozen pilot database, with its own keys; a push to `staging` runs the checks and deploys automatically; the things the architecture doc says must exist before anything else — who's allowed to see what, an unchangeable record of every sensitive action, a ledger that can't silently create or lose money, a place to record whether someone agreed to AI training on their performance — all exist and are tested, even though nothing in the product uses them yet.

---

## Phase 2 — Viewer experience (web)

**PRD rows:** pending export. Stand-in: `design/README.md`'s "YouTube viewer variant" group (`YT-Waiting`, `YT-Show`, `YT-Focus`, `YT-Prompt`, `YT-GuestSignUp`, `YT-VersusTalk`, `YT-Versus`, `YT-VersusB`, `YT-FoldShow`, `YT-FoldVersus`, `WebYT-Show`, `WebYT-VersusTalk`, `WebYT-VersusA`, `WebYT-ShowPage`) plus `docs/YOUTUBE_ADDENDUM.md` in full.

**Scaling area:** Real-time media (the embed, not our own media path), Rate limiting (the open/no-account viewer endpoints the audit confirmed — `reactions`, `show-comments`, `prompt-responses`, `viewer-session`), Database (votes/reactions need playback-position stamps, which `docs/REPO_AUDIT.md` confirms don't exist yet — today they're wall-clock).

**Migrations:** `PlayerSource`-backing columns (video id, broadcast id) on `shows`; playback-position columns added to the vote/reaction/comment tables already restructured in Phase 1; a metering-events table for viewer-hours (generic shape now, per the deferred decision in `docs/DECISIONS.md` on what viewer-hours mean under YouTube delivery).

**Tests:** delay-alignment tests (votes, reactions and Support line up with playback position under 3–10s of delay, per `docs/ARCHITECTURE.md`'s testing table); layout/embed tests (nothing overlaps the player at any supported width, player never under 200×200, matching the phone/Fold/tablet/computer frame sizes in `docs/YOUTUBE_ADDENDUM.md`); the five states (loading, empty, error, offline, success) on every viewer screen per `docs/CLAUDE.md` §6; cookie-consent gating on the embed.

**Definition of done, plain English:** a viewer who has never signed up can open a show, watch it through the embedded YouTube player with nothing covering it, vote and react in a way that lines up with what they're actually watching rather than what the server thinks is happening, and the whole thing works on a phone, a Fold, a tablet and a computer at the sizes the designs specify.

---

## Phase 3 — Artist experience and live pipeline

**PRD rows:** pending export. Stand-in: `design/README.md`'s artist Versus group (`YT-ArtistTalk`, `YT-ArtistRequest`, `YT-ArtistHandover`, `YT-ArtistPerform`, `YT-KitCheck`, `WebYT-Artist`) plus the existing artist show-flow boards (`Create`, `Schedule`, `KitCheck`, `Countdown`, `Console`, `FixSheet`, `PostShow`, `ClipEditor`, `Insights`, `CameraMode`), and `docs/ARCHITECTURE.md`'s "The path (v2)" and "YouTube delivery rules (v2)".

**Scaling area:** Real-time media, Background jobs (broadcast create/end, stream-key rotation), Auth (third-party OAuth grants).

**Migrations:** a `youtube_connections` table (tokens encrypted with per-tenant keys, never returned to a client, matching `docs/ARCHITECTURE.md`'s identity-store isolation rule); a `broadcasts` table (video id, stream key reference, state, per show — and per artist in Versus, since the composed show streams to both channels); audit-log entries (from Phase 1's audit log) for every connect, refresh failure, disconnect, broadcast created/started/ended/made-private, and stream-key rotation.

**Tests:** failure drills reusing the documented 20 September incident pattern plus the YouTube-specific ones `docs/ARCHITECTURE.md` names explicitly (YouTube ingest drops, a rejected stream key, a channel not enabled for live, an artist disconnecting mid-show); compositor tests for the three Versus views (conversation split, Artist A performing with B's corner window at ~31% frame width, and the mirror) and the stage-request/handover confirmation flow; confirmation that the existing, device-tested AI director and camera-pairing code (`docs/REPO_AUDIT.md` "Reuse as-is") is untouched by any of this.

**Definition of done, plain English:** an artist connects their YouTube channel once at onboarding, and from then on, scheduling and going live creates and ends the broadcast automatically; the picture artists and viewers see is produced by the same director and camera pairing that already works today, now also sent out to YouTube; if YouTube's side breaks mid-show, the artist keeps performing, the recording keeps going, and viewers get an honest message instead of a dropped show.

---

## Phase 4 — Native apps (iOS and Android)

**PRD rows:** pending export. Stand-in: the whole product surface, since `docs/REPO_AUDIT.md` confirms nothing native exists today — this is a Next.js web app only.

**Scaling area:** Stateless hosting (the native apps are clients of the same API, not a second backend), Auth (passkeys, Apple/Google sign-in, per `docs/ARCHITECTURE.md`'s identity section).

**Migrations:** device/push-token tables if native push notifications are wanted; otherwise this phase should need very few new migrations, because the data layer already exists by Phase 3 — native apps are a new client, not a new backend.

**Tests:** device testing on real phones, which `docs/CLAUDE.md` §7 names explicitly as Korey's gate, not something to be called done from a simulator; permission tests re-run against the native auth flow (passkey/Apple/Google), since `docs/ARCHITECTURE.md` requires those from launch and the current web app is email+password only (`docs/REPO_AUDIT.md` "Reuse with adaptation").

**Definition of done, plain English:** the same shows, same director, same ledger, same chat and votes, now on an iPhone and an Android phone as real apps — with no payments screen at all, balances only, per the settled product decision in `docs/CLAUDE.md` §4 — and a device checklist in `docs/NEEDS_KOREY.md` for Korey to actually hold the phones and try it before it's called pilot-ready.

---

## Phase 5 — Website

**PRD rows:** pending export. Stand-in: `design/README.md`'s "computer app (Web*)" and "website" groups — `WebHome`, `WebForArtists`, `WebForFans`, `WebPricing`, `WebAbout`, `WebContact`, `WebLegal`, `WebGetApp`, `WebHelp`, `WebIdentity`, `WebDiscover`, `WebLiveUpcoming`, `WebShowPage`, `WebOperator`, `WebEarnings`, `WebBuyTokens`, `WebVersus`, `WebKitCheck`.

**Scaling area:** Stateless hosting.

**Migrations:** none expected — the website reads the same data Phases 1–3 already expose; if a marketing-specific need appears (e.g. a waitlist table) it gets added then, not speculatively now.

**Tests:** accessibility (contrast, tap targets, screen-reader labels, per `docs/ARCHITECTURE.md`'s testing table); layout correctness at the 1440-wide computer frame `design/README.md` specifies; the five states on every page that has them (show pages, live/upcoming lists).

**Definition of done, plain English:** the public website — home, pricing, for-artists, for-fans, legal, help, and the show/live pages people get linked to — matches the approved designs and is live at the production domain, separately from the sign-in-required app.

---

## Phase 6 — Hardening

**PRD rows:** pending export. Stand-in: `docs/ARCHITECTURE.md`'s "Do before launch" list and "The honest risk list" table.

**Scaling area:** all seven areas in `docs/CLAUDE.md` §1's PR-description list, with Observability as the throughline — this phase is where "we built it" becomes "we can prove it holds."

**Migrations:** none new expected; this phase verifies retention, legal-hold and deletion mechanics against what Phases 1–3 built, rather than adding schema.

**Tests:** an external penetration test focused on access control between users and the money paths; a realistic load test (one popular show, thousands joining in the same minute); the quarterly restore drill `docs/ARCHITECTURE.md` requires, run for real at least once; the failure-drill list in full, not just the subset exercised ad hoc in earlier phases; a written incident plan with the 72-hour GDPR breach-notification route named.

**Definition of done, plain English:** before the first public show, the things that would be expensive or embarrassing to discover live — a security hole, a cost blow-up under real load, a backup that doesn't actually restore, a moderation queue nobody is watching — have been deliberately gone looking for and fixed, not left to be found by a viewer or a regulator.

---

## Open items this plan surfaces (tracked in `docs/NEEDS_KOREY.md`)

- The PRD spreadsheet export, blocking real PRD-row citation in every phase above and in every future PR description.
- Google/YouTube OAuth verification and quota (Phase 3 cannot ship without it being in progress well ahead of time — Google verification review has its own lead time).
- New staging and production Supabase projects, and the GitHub repo environments/secrets `.github/workflows/{ci,staging,promote}.yml` already assume — Phase 1 cannot actually run on staging until these exist.
