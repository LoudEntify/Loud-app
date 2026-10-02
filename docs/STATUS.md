# STATUS — overnight build, 2 October 2026

Branch `claude/overnight-build-2026-10-02`, pull request [LoudEntify/Loud-app#3](https://github.com/LoudEntify/Loud-app/pull/3) into `staging`. Written as the last commit of the run. Plain English; the detail for each phase is in `docs/PHASE_2_HANDOFF.md` to `docs/PHASE_5_HANDOFF.md`, decisions in `docs/DECISIONS.md`, and everything that needs you in `docs/NEEDS_KOREY.md`.

## In one paragraph

Phases 2 to 5 are built on one branch, each a commit, each with tests that ran. A guest can watch, sign up, vote, chat and support; an artist can onboard, connect YouTube (mock), book, run Kit Check, go live, hand over a Versus stage, end, clip and read insights and earnings; the live pipeline composes and delivers through test doubles; the native app exists but has never been on a phone; the website is complete with the share page, legal drafts and a working contact form. Nothing was run against real YouTube, LiveKit, a payment provider or staging's database, because none of those credentials exist in this environment. Production (loudentify.app) is untouched.

## Test results (final)

| What | Result | How it ran |
|---|---|---|
| Migrations from an empty Postgres | 59 of 59 apply; 9 new ones with rollbacks rehearsed down and up | `scripts/db/apply-migrations.sh --fresh` locally and in CI |
| SQL access suites | 4 of 4 pass (audit log, phase 2, phase 3, phase 5) | `scripts/db/run-sql-tests.sh` |
| Unit tests | 42 of 42 pass | `npm test` |
| Lint and route auth check | pass; every API route states its auth model | `npm run check:lint` |
| Build | passes | `next build` |
| Browser e2e, viewer | 20 of 20 | `scripts/dev/e2e.sh` (real PostgREST, fake GoTrue, fixture player) |
| Browser e2e, artist | 8 of 8 | same run, fake camera, fake egress to files |
| Browser e2e, website | 11 of 11 | `E2E_SUITES=site scripts/dev/e2e.sh` after three fixes the suite found |
| Native | `npm install`, `expo config`, `expo install --check` pass | nothing installed on a device |
| CI on GitHub | `check` job (migrations from scratch, SQL tests, lint, unit tests, build) **green** on the final commits after a Node 22 fix; it had failed on the Phase 3/4 push because Node 20 could not expand the test glob. The `e2e` job was still running when this was written; its result is on the PR's Checks tab | `.github/workflows/ci.yml` |
| Staging database | **not verified** | the staging database password is wrong (NEEDS_KOREY, day one) |

## Per PRD row

From `docs/Loudentify_PRD_User_Stories (4).xlsx`, column "Build plan phase (v2)", rows in phases 1 to 5 (69 done, 43 partly done, 19 not started). "Done" means built and exercised by a test in this run; "partly" says what is missing; nothing is marked done on the strength of code alone.

| PRD id | Phase | Area | Feature | Status | Notes |
|---|---|---|---|---|---|
| 1 | 3 | Auth & Profile | Register | partly | Artist registration, log in and profile reuse the viewer flows plus the owner profile; edit profile is the pilot's screen |
| 2 | 3 | Auth & Profile | Log in / Log out | partly | Artist registration, log in and profile reuse the viewer flows plus the owner profile; edit profile is the pilot's screen |
| 3 | 3 | Auth & Profile | See profile | partly | Artist registration, log in and profile reuse the viewer flows plus the owner profile; edit profile is the pilot's screen |
| 4 | 3 | Auth & Profile | Edit profile | partly | Artist registration, log in and profile reuse the viewer flows plus the owner profile; edit profile is the pilot's screen |
| 5 | 3 | Auth & Profile | Edit profile | partly | Artist registration, log in and profile reuse the viewer flows plus the owner profile; edit profile is the pilot's screen |
| 6 | 3 | Auth & Profile | Edit profile | partly | Artist registration, log in and profile reuse the viewer flows plus the owner profile; edit profile is the pilot's screen |
| 9 | 3 | Live Performance - Solo/Versus | Perform Solo / Perform Versus | done | Book, Kit Check, countdown, go live, console (e2e with fake egress) |
| 10 | 3 | Live Performance - Solo/Versus | Go live | done | Book, Kit Check, countdown, go live, console (e2e with fake egress) |
| 11 | 3 | Live Performance - Solo/Versus | Consent to Recording | done | Recording consent is in the artist agreement step; training copy only with the separate choice |
| 12 | 3 | Multi-Camera & Production | Automate Content director / Control content direction | partly | Compositor chooses solo / conversation / A-B with corner and degrades to the healthy artist; a learned director is not built |
| 13 | 3 | Multi-Camera & Production | Control content direction | partly | Artist can switch Versus view and hand over the stage; manual shot control beyond that is the pilot's director panel |
| 14 | 3 | Multi-Camera & Production | Control content direction | partly | Artist can switch Versus view and hand over the stage; manual shot control beyond that is the pilot's director panel |
| 15 | 3 | Multi-Camera & Production | Control content direction | partly | Artist can switch Versus view and hand over the stage; manual shot control beyond that is the pilot's director panel |
| 16 | 3 | Multi-Camera & Production | Control content direction | partly | Artist can switch Versus view and hand over the stage; manual shot control beyond that is the pilot's director panel |
| 17 | 3 | Multi-Camera & Production | Automate Content director | partly | Compositor chooses solo / conversation / A-B with corner and degrades to the healthy artist; a learned director is not built |
| 18 | 3 | Multi-Camera & Production | Automate Content director | partly | Compositor chooses solo / conversation / A-B with corner and degrades to the healthy artist; a learned director is not built |
| 19 | 3 | Multi-Camera & Production | Control content direction | partly | Artist can switch Versus view and hand over the stage; manual shot control beyond that is the pilot's director panel |
| 20 | 3 | Multi-Camera & Production | Automate Content director | partly | Compositor chooses solo / conversation / A-B with corner and degrades to the healthy artist; a learned director is not built |
| 21 | 3 | Engagement | Send Stickers | partly | Vote with the artists as options; stickers not built |
| 22 | 3 | Engagement | Host Fan Live | not started | Host Fan Live |
| 23 | 3 | Engagement | Send comments | done | Comments visible on the console |
| 24 | 3 | Engagement | Reply Comments | not started | Reply / quote from the console |
| 25 | 3 | Engagement | Quote Comments | not started | Reply / quote from the console |
| 26 | 3 | Engagement | Like content | not started | Like content |
| 27 | 3 | Engagement | Follow artist | done | Followers gained in insights; follow on viewer side |
| 28 | 3 | Engagement | Send Stickers / Vote artist | partly | Vote with the artists as options; stickers not built |
| 30 | 3 | Competitions & Collaboration | Perform Versus | done | Versus invite by show_slots, A/B views, stage requests with 60 s TTL, handover (two-console e2e) |
| 31 | 3 | Content & Sharing | Watch recorded show | partly | Recordings row written at end show with visibility; playback uses the pilot's VOD page |
| 32 | 3 | Content & Sharing | Share recorded snippets | done | Clips capped at 90 s, saved with the handle |
| 33 | 3 | Financial | See Artist Financials | done | Earnings in pounds, pending vs ready, fans table, payout history (identity check stub) |
| 34 | 3 | Financial | See Artist Financials | done | Earnings in pounds, pending vs ready, fans table, payout history (identity check stub) |
| 35 | 3 | Financial | See Artist Financials | done | Earnings in pounds, pending vs ready, fans table, payout history (identity check stub) |
| 36 | 3 | Analytics & Ranking | See artists Chart | not started | Artist charts |
| 42 | 2 | Auth & Profile | Log in | done | One-page sign-up and log in on web; sessions via Supabase Auth |
| 43 | 2 | Auth & Profile | Log in / Log out | done | One-page sign-up and log in on web; sessions via Supabase Auth |
| 44 | 2 | Auth & Profile | See profile | done | Public profile at /u/username and /@username (public_profiles view only) |
| 45 | 2 | Auth & Profile | Edit profile | partly | Profile editing exists from the pilot (components/AccountSettings); not redesigned to the v2 boards |
| 46 | 2 | Auth & Profile | Edit profile | partly | Profile editing exists from the pilot (components/AccountSettings); not redesigned to the v2 boards |
| 47 | 2 | Auth & Profile | Edit profile | partly | Profile editing exists from the pilot (components/AccountSettings); not redesigned to the v2 boards |
| 50 | 2 | Viewing Experience | Watch Live competitions | partly | Live tab and Discover list live and upcoming shows (solo and Versus); "competitions" as a product are deferred (Coming soon on the website) |
| 51 | 2 | Viewing Experience | Watch recorded show | partly | Pilot recordings page remains; viewer recordings with chat in step not rebuilt |
| 52 | 2 | Viewing Experience | See Live Competitions | partly | Live tab and Discover list live and upcoming shows (solo and Versus); "competitions" as a product are deferred (Coming soon on the website) |
| 53 | 2 | Engagement | Send comments / Send Emogis | done | Chat and reactions stamped with playback position; hidden-word filter |
| 54 | 2 | Engagement | Send Stickers | not started | Stickers |
| 55 | 2 | Engagement | Like content | partly | Reactions (emoji) built; a separate Like on content not built |
| 56 | 2 | Engagement | Reply Comments | not started | Reply / quote comments |
| 57 | 2 | Engagement | Quote Comments | not started | Reply / quote comments |
| 58 | 2 | Engagement | Follow artist | done | Follow from the show screen and public profile |
| 59 | 2 | Engagement | Send Message | not started | Direct messaging (pilot has a basic thread; not in the v2 viewer flow) |
| 60 | 2 | Engagement | Host Fan Live | not started | Host Fan Live |
| 61 | 2 | Financial Support | Buy token / Vote artist | partly | Votes are one per account, never bought; token purchase is a test-mode stub on web only (payment provider is NEEDS_KOREY) |
| 62 | 2 | Financial Support | Buy token / Power vote artist | partly | Votes are one per account, never bought; token purchase is a test-mode stub on web only (payment provider is NEEDS_KOREY) |
| 63 | 2 | Financial Support | See artist Financials | not started | Fan-facing artist financials |
| 64 | 2 | Content & Sharing | Share live shows | done | Share sheet on the show screen; share page /s/:id with Open Graph; profile share link |
| 65 | 2 | Content & Sharing | Share recorded snippets | partly | Artist clips exist (Phase 3); fan-side sharing of snippets not built |
| 66 | 2 | Content & Sharing | See profile | done | Public profile at /u/username and /@username (public_profiles view only) |
| 67 | 2 | Content & Sharing | Send Message | not started | Direct messaging (pilot has a basic thread; not in the v2 viewer flow) |
| 68 | 2 | Content & Sharing | Share profile | done | Share sheet on the show screen; share page /s/:id with Open Graph; profile share link |
| 90 | 2 | Sign-up & Onboarding | Guest preview | done | 60-second guest preview then sign-up (tests + e2e) |
| 91 | 2 | Sign-up & Onboarding | One-page sign-up | done | One page, validated server-side |
| 92 | 2 | Sign-up & Onboarding | Age gate | done | 18+ gate; under-18 never stored (e2e) |
| 93 | 2 | Sign-up & Onboarding | Viewer onboarding | done | Onboarding screen after sign-up |
| 94 | 2 | Discover | Discover feed | done | Discover feed with snapping cards; live first |
| 95 | 2 | Discover | Feed gestures | done | Discover feed with snapping cards; live first |
| 96 | 2 | Live tab | Live tab | done | Live tab with day groups, filters, Remind me |
| 97 | 2 | Search | Search | done | Search with empty-state suggestion |
| 98 | 2 | Watching (YouTube) | Watch in embedded player | done | YouTube IFrame behind PlayerSource, nocookie host, nothing overlays, >=200x200 proven at 15 sizes |
| 99 | 2 | Watching (YouTube) | Resizing show layout | done | Phone / bigger / vote / guest / fold / tablet / computer layouts |
| 100 | 2 | Watching (YouTube) | Versus viewing | done | Three Versus views on the viewer side; artist switches them |
| 101 | 2 | Voting | Vote | done | One vote per account, playback-position stamped, delay-aligned attribution |
| 102 | 2 | Reactions | Reactions | done | Reactions with artist_slot and playback position |
| 103 | 2 | Waiting room | Waiting room | done | Waiting room with countdown, early chat, Remind me |
| 104 | 2 | Show end | End card | done | End card |
| 105 | 4 | Watching (YouTube) | Picture-in-picture | not started | Picture-in-picture (decide after device testing) |
| 106 | 5 | Privacy | Cookie consent | done | Cookie banner on app and website; embed and analytics off until chosen; cookie notice page with live choices |
| 107 | 2 | Financial Support | Support with tokens | done | Support: idempotent, 72.5% artist leg, caps, audited |
| 108 | 2 | Financial Support | Wallet and token purchase | partly | Wallet balance and history on web and native; purchase is a test-mode stub |
| 109 | 2 | Engagement | Messaging | not started | Direct messaging (pilot has a basic thread; not in the v2 viewer flow) |
| 110 | 2 | Auth & Profile | Become an artist | partly | "Perform" entry sends a viewer into artist onboarding; role change itself is the pilot's |
| 111 | 3 | Auth & Profile | Connect YouTube | done | YouTube connect at onboarding with readiness check (mock; real client untested) |
| 112 | 3 | Auth & Profile | Artist agreement | done | Agreement step; DRAFT text on the website |
| 113 | 1 | Auth & Profile | Training-data choice | done | Training-data choice recorded as a consent row at artist onboarding; changeable (consent_records) |
| 114 | 3 | Auth & Profile | Set up my stage | done | Mic saved to a place; loaded next show |
| 115 | 3 | Scheduling | Schedule a show | done | 30-minute lead rule, length options, reminders at offsets (e2e) |
| 116 | 3 | Scheduling | Versus invite | done | Versus invite by show_slots, A/B views, stage requests with 60 s TTL, handover (two-console e2e) |
| 117 | 3 | Scheduling | Show reminders | done | 30-minute lead rule, length options, reminders at offsets (e2e) |
| 118 | 3 | Kit Check | Kit Check | done | Six checks incl. two-minute frame hold (configurable) and a timed upload probe |
| 119 | 3 | Kit Check | Frame check | done | Six checks incl. two-minute frame hold (configurable) and a timed upload probe |
| 120 | 3 | Live Performance - Solo/Versus | Countdown and go-live | done | Book, Kit Check, countdown, go live, console (e2e with fake egress) |
| 121 | 3 | Live Performance - Solo/Versus | Live console | done | Book, Kit Check, countdown, go live, console (e2e with fake egress) |
| 122 | 3 | Live Performance - Solo/Versus | Versus view control | done | Versus invite by show_slots, A/B views, stage requests with 60 s TTL, handover (two-console e2e) |
| 123 | 3 | Live Performance - Solo/Versus | Stage handover | done | Versus invite by show_slots, A/B views, stage requests with 60 s TTL, handover (two-console e2e) |
| 124 | 3 | Live Performance - Solo/Versus | Fix sheet | done | Fix sheet for mic and camera |
| 125 | 3 | Live Performance - Solo/Versus | Foreground rule | not started | Native-only foreground rule and camera settings (native console not built) |
| 126 | 3 | Multi-Camera & Production | Pair a camera | partly | Pairing via the pilot's QR flow; native camera mode pairs and shows ON AIR; frames do not publish without LiveKit |
| 127 | 3 | Multi-Camera & Production | Camera settings | not started | Native-only foreground rule and camera settings (native console not built) |
| 128 | 3 | Multi-Camera & Production | Director moves | partly | Director moves limited to the compositor's rules |
| 129 | 3 | Multi-Camera & Production | Audio settings | partly | Pilot audio deck and libraries remain; not redesigned |
| 130 | 3 | Multi-Camera & Production | Studio library | partly | Pilot audio deck and libraries remain; not redesigned |
| 131 | 3 | Multi-Camera & Production | Operator | not started | Operator console (WebOperator board) |
| 132 | 3 | Content & Sharing | Post-show | done | Post-show: visibility, make a clip |
| 133 | 3 | Content & Sharing | Make a clip | done | Clips capped at 90 s, saved with the handle |
| 134 | 3 | Analytics & Ranking | Insights | done | Insights computed at end show |
| 135 | 3 | Auth & Profile | Profile owner mode | done | Owner profile with status strip and tabs |
| 136 | 3 | Financial | Allowance | partly | Metering counts viewer-hours; the allowance figures are an open v2 decision (pricing prints "to be set") |
| 137 | 3 | Financial | Earnings | done | Earnings in pounds, pending vs ready, fans table, payout history (identity check stub) |
| 138 | 3 | Financial | Cash out | partly | Cash-out UI and payout history; provider and identity check are stubs |
| 139 | 3 | Live pipeline | Composed picture | done | Compositor, one egress to three outputs (fake egress to files; LiveKit stub), broadcast lifecycle, retry-then-recreate with key rotation (unit tests + e2e) |
| 140 | 3 | Live pipeline | Egress to YouTube | done | Compositor, one egress to three outputs (fake egress to files; LiveKit stub), broadcast lifecycle, retry-then-recreate with key rotation (unit tests + e2e) |
| 141 | 3 | Live pipeline | Broadcast lifecycle | done | Compositor, one egress to three outputs (fake egress to files; LiveKit stub), broadcast lifecycle, retry-then-recreate with key rotation (unit tests + e2e) |
| 142 | 3 | Live pipeline | Delivery failure handling | done | Compositor, one egress to three outputs (fake egress to files; LiveKit stub), broadcast lifecycle, retry-then-recreate with key rotation (unit tests + e2e) |
| 143 | 2 | Delivery | PlayerSource interface | done | lib/player/PlayerSource.js (youtube | loudentify-llhls | fixture) on web and native |
| 144 | 3 | Metering | Viewer-hour metering | done | metering_events from player events, guests included |
| 146 | 3 | Cost | Cost tracking | not started | Cost tracking |
| 147 | 1 | Access control | Permission model | partly | RLS everywhere + public_profiles view; organisation/role model from Phase 1; full role matrix for operators/support not built |
| 148 | 1 | Access control | Tokens and sign-in | done | Supabase Auth sessions; every API route states its auth model (route-auth-check in CI) |
| 149 | 1 | Audit | Audit log | done | Hash-chained, append-only audit log; explicitly locked down (20261002000100); unreachable by anon/authenticated (SQL test) |
| 150 | 1 | Audit | Audit events | partly | Events written for sign-up, consent, support, YouTube connect/disconnect, broadcast lifecycle, key rotation, show control; not yet for every admin/config action (no admin console) |
| 151 | 1 | Money | Ledger | done | Double-entry ledger; Support writes three balanced legs (tests) |
| 152 | 1 | Privacy | Consent records | done | consent_records with document_version; written at sign-up and onboarding |
| 154 | 1 | Privacy | Data residency | partly | YouTube embed on the privacy-enhanced domain only after consent; no region pinning decisions made (NEEDS_KOREY) |
| 155 | 3 | Privacy | Retention and legal hold | partly | recordings.legal_hold_* and training_copy_path columns exist; retention jobs not built |
| 162 | 1 | Release | Environments and promote | partly | CI on every push/PR (migrations from scratch, SQL tests, lint, unit, build, e2e); staging/production promote flow unchanged from before; staging verification blocked on the database password |
| 163 | 1 | Release | Protected paths | done | Protected paths listed in NEEDS_KOREY "Reviews needed before promotion"; promote.yml already refuses unticked items |
| 164 | 1 | Release | Secrets and scanning | partly | Secrets only in env; YouTube tokens/keys encrypted per tenant; no secret scanning step added to CI |
| 165 | 1 | Observability | Instrumentation | done | Correlation ids on every route, journey_events pseudonymous, metering_events |
| 169 | 3 | Compliance | Google verification and quota | not started | Google verification (NEEDS_KOREY); quota handling exists in the mock only |
| 173 | 5 | Website | Public show pages | done | /s/:id with Open Graph, countdown, calendar, share box; /show/:id keeps its tags |
| 174 | 5 | Website | Website pages | done | Home, What's on, For artists, For fans, Pricing (figures to be set), About, Contact (working form), Help, Get the app, Legal (DRAFT) |
| 175 | 2 | Cross-device | Five states and accessibility | done | Five states on every new screen; e2e checks error/empty/offline; website suite adds alt/labels/h1/44px |
| 176 | 4 | Native apps | Native apps | partly | Expo app built for viewer flows + camera mode; never run on a device (needs Korey's accounts) |

## Known risks, honestly

1. **Nothing has touched real YouTube.** The Google client is written from the API reference and never executed. The first real connect/broadcast will find bugs. The mock proved the flows and the failure drills, not the wire format.
2. **The egress is a file-writing double.** Real video needs LiveKit credentials; the seat exists (`LiveKitEgress`) and refuses to start without them.
3. **Money is test mode only.** Token purchase is a stub; payouts, identity checks and refunds need a provider. The ledger and Support logic are real and tested.
4. **Staging has not been migrated.** Every migration is proven from scratch locally and in CI, but the staging password is wrong, so nothing was applied there. Until it is, the Vercel preview of the branch talks to a staging database without the new tables and the new screens will show their error states.
5. **The native app has never run on a device.** Expect first-run surprises in the WebView player, camera permissions and the tab bar.
6. **CI's unit tests did not run on GitHub for the Phase 3 and 4 pushes** (the Node 20 glob problem). The final commits run them and the `check` job is green; the browser `e2e` job on GitHub was still in progress at the time of writing, so read the Checks tab for its result.
7. **Legal pages are drafts** written by me, not a lawyer, and say so on the page.
8. **Pricing figures are not set**; the page prints "to be set" rather than a number.
9. **The website becomes the front door (`/`) when promoted**; the pilot's doors moved to `/pilot`. Promotion is your decision.
10. **Protected-path reviews** (audit lockdown, support, public_profiles, sign-up, identity migration, lifecycle, site_messages) are unticked in NEEDS_KOREY; `promote.yml` will refuse until they are.

## Morning checklist (in order)

1. Open [pull request #3](https://github.com/LoudEntify/Loud-app/pull/3) and look at the Checks tab on the last two commits. Green means the whole suite ran on GitHub. If the `check` job is red, open it and send me the last 40 lines.
2. Fix the staging database password (NEEDS_KOREY, top section, click-by-click). Then in Supabase → SQL Editor on staging, run nothing by hand: instead tell me it is fixed and I apply the migrations through the harness and run the verification queries, or run `DATABASE_URL=... scripts/db/apply-migrations.sh` yourself from a laptop with Node and psql.
3. Open the Vercel preview for the branch (link in the Vercel comment on the PR). Click through: `/` (website), `/whats-on`, `/discover` (app), a show, `/artist/onboarding` with a test account. Until step 2 is done, screens that need the new tables will show their error states; that is expected.
4. Read `docs/NEEDS_KOREY.md` top to bottom. Each item has the exact clicks. The ones that unblock the most: the staging password, the Google Cloud project for YouTube, a payment provider decision, the Expo/Apple/Google accounts.
5. Decide the pricing figures (five numbers) and put them in `lib/site/pricing.js`, or tell me and I will.
6. Send the four social handles and the three contact addresses (or add them in Vercel as the environment variables named in NEEDS_KOREY).
7. Read the four legal drafts on the preview (`/legal/terms`, `/legal/community-guidelines`, `/legal/cookies`, `/legal/artist-agreement`) and forward them to whoever reviews your legal text.
8. Tick the reviews you or Ugo have done in NEEDS_KOREY "Reviews needed before promotion", with a name next to each.
9. Decide whether the PR merges into `staging` as one piece or whether you want it split by phase (each phase is one commit, so splitting is mechanical; say which).
10. Do not promote to production yet. The website at `/` changes the front door, and the staging database must carry the migrations first.
