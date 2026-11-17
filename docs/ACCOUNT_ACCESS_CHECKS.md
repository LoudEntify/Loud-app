# Account access and artist preparation

The browser stores Supabase Auth sessions. The database profile's `artist` or
`viewer` role determines the dashboard; choosing a different sign-in URL does
not change account permissions.

## Database setup

Run `docs/accounts_setup.sql` in the Supabase SQL Editor. It is safe to rerun
and adds `bio` and `avatar_url` for profile editing. Signup details are preserved
when a confirmed user first arrives; concurrent tabs resolve to the same profile.
Private profile rows remain owner-only. The public username endpoint returns
only availability, so private fan profiles do not break handle checks.

## Automated integration check

With `.env.local` configured and the development app running:

```sh
npm run dev
# In another terminal, with a Playwright Chromium browser installed:
npm run smoke:accounts
```

`SMOKE_URL` can point to a different app instance. `PLAYWRIGHT_BROWSERS_PATH`
can point to a separately installed test browser. The command uses the configured
Supabase project, creates unique temporary users and deletes those exact users
and their cascading profile rows in `finally`. It does not send emails.

It checks confirmation-session profile initialization, artist/fan login, role
routing, anonymous profile privacy, username collisions, artist profile editing,
dashboard progression and mobile sizing, password recovery and old-password
rejection, invalid reset links, and logged-out route protection. Email dispatch
for signup and forgot-password UI checks is stubbed; the actual confirmation and
recovery credentials are generated and verified through Supabase for test users.
This verifies the app and Auth integration, not mailbox delivery.

## Manual email check

Set your production Site URL and allow the intended `/auth/**` and
`/reset-password` URLs under Supabase Authentication URL Configuration. Request
signup and recovery using an email address you control; follow the email links
and verify they return to the intended app origin. This requires a working mail
provider and is separate from the automated checks.

## Artist dashboard

The dashboard shows actual profile completion and links to profile settings and
Kit Check. Profile edits update the next recommended action. Scheduled shows are
read for the current artist only; a failed query has a distinct unavailable
state rather than showing a false empty calendar. The current project still
needs its show schema before scheduling and broadcasting can be verified.
