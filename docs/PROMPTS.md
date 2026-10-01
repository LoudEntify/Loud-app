# Prompts to send, in order

Send one prompt per cloud session (one session per phase). Wait for the plain-English summary before sending the next.

## 1. Kickoff (audit, plan, Phase 1)

Read CLAUDE.md, then everything in docs/ and design/. Follow CLAUDE.md exactly. Do not ask me questions or for approval at any point. Decide, log it in docs/DECISIONS.md and keep going. Anything that needs me goes in docs/NEEDS_KOREY.md with exact steps, and you carry on with other work.

Job: build Loudentify (native iOS and Android apps, the web app and the website) to the approved designs in design/ and the architecture in docs/ARCHITECTURE.md, with YouTube delivery for viewers as set out in docs/YOUTUBE_ADDENDUM.md. Reuse what already works in this repo (Supabase tables and functions, the LiveKit setup, the AI director and shot grammar, the pilot-tested pieces) and fit it to the new designs. Do not rebuild anything that is tested and agreed.

Step 1. Audit the repo. Write docs/REPO_AUDIT.md: what exists, what is reusable for each screen group in design/, and what conflicts with the architecture.
Step 2. Write docs/BUILD_PLAN.md with these phases, each listing PRD rows, Scaling and Infrastructure area, migrations, tests and a plain-English definition of done: 1 Foundations, 2 Viewer experience (web app first), 3 Artist experience and the live pipeline, 4 Native apps, 5 Website, 6 Hardening.
Step 3. Do Phase 1 now: staging and production environments as described in CLAUDE.md section 2 (ci.yml, staging.yml, promote.yml), then everything in the "build first" list in CLAUDE.md section 4. You hold staging credentials only. Run the migrations on staging through the pipeline, verify them, and run all tests. Keep going until Phase 1 is merged to staging and verified there. Then give me a plain-English summary, what to test, and what is in NEEDS_KOREY.md.

## 2. Phase 2: viewer experience (web app)

Continue with Phase 2 in docs/BUILD_PLAN.md. Build the viewer experience on the web app to the designs in design/ (use the YT- and WebYT- boards for watching). Include: guest 60-second preview and one-page sign-up, Discover, Live, search, public profile, wallet balance, waiting room, the show screen with the YouTube player behind PlayerSource, chat, emoji, votes, Support (web only), the three Versus views, the five states on every screen, and journey instrumentation. Use seeded synthetic shows and a YouTube test stream or unlisted video so you can run it end to end yourself. Run the app, the unit tests and browser tests yourself and fix what fails. Migrations go to staging through the pipeline. Stop when it is verified on staging and tell me what to try.

## 3. Phase 3: artist experience and live pipeline

Continue with Phase 3. Build: artist onboarding including connecting a YouTube account, Schedule (30 minute rule), Kit Check showing only the artist's own camera in the broadcast frames, the live console for solo and Versus (Conversation and Perform buttons, stage request with confirmation), the Fix sheet, the egress compositor that builds the composed picture (solo, conversation split, performing with corner window lower right) and sends one stream to YouTube plus the recording and training copy, Versus streaming to both artists' channels, post-show summary, clips and insights. Use LiveKit and the existing director. Log the Google verification and YouTube quota steps in NEEDS_KOREY.md on day one. Test with synthetic publishers and a YouTube test channel. Stop when verified on staging and give me a device test checklist.

## 4. Phase 4: native apps

Continue with Phase 4. Choose one cross-platform framework that lets us reuse the web code and the design tokens, and record why in DECISIONS.md. Build the iOS and Android apps to design/ for the same flows as the web viewer and artist screens, plus camera mode (a phone as a camera). No payments in the native apps. Set up cloud builds so I can install test builds on my phone. Anything that needs my Apple or Google accounts goes in NEEDS_KOREY.md with exact steps. Run all tests you can run without a device, and give me a device test checklist.

## 5. Phase 5: website

Continue with Phase 5. Build the website to design/: home with the animated hero, live and upcoming, public show pages (the page artists share, with the YouTube embed), for artists, for fans, pricing, get the app, about, help, contact, legal, cookies and the cookie banner. Respect reduced motion. Do not let animation delay page load. Open Graph tags for sharing show pages.

## 6. Phase 6: hardening

Continue with Phase 6. Permission tests for every endpoint and role, ledger property tests, a realistic load test (one popular show, thousands joining in a minute), failure drills (camera stall, mic dies, connection drops), data export and account closure, the report queue and one-tap report, audit log write-failure alerting, a restore drill script, and drafts of the DPIA, legitimate interests assessment and Online Safety Act risk assessment in docs/ for a solicitor to review. Fix everything that fails. Summarise results in plain English.

## 7. When staging is approved and I want production

Staging is approved. Get production ready but do not run the promote workflow yourself. Check promote.yml, list the migrations that will run on production with their rollback scripts, list the post-deploy checks, and write docs/RELEASE_NOTES.md in plain English. Tell me when it is ready for me to run.

## 8. Resume or steer any time

Read docs/NEEDS_KOREY.md, docs/DECISIONS.md and the last pull requests, then continue from where you stopped. Here is what I found when I tested staging: [paste notes]. Fix these first, then carry on with the current phase. Same rules: no questions, log decisions, run everything yourself.
