# The authenticated smoke check

**One command that signs in and confirms the gated pages actually render.**

```
npm run smoke
```

---

## Why this exists

Three crashes in a row shipped past a verification that looked thorough:

| | Crash | Surface |
|---|---|---|
| 1 | Leave threw "Rendered fewer hooks than expected" | inside a live show |
| 2 | `Cannot access 'tP' before initialization` (TDZ) | artist console |
| 3 | `windowClosesAt is not defined` | artist console |

**Every one was on an authenticated surface, and every one passed a
"bypass-loaded, HTTP 200" check.** That check gets past *Vercel's*
deployment protection and stops there — it never gets past *Loudentify's*
login. `/artist/{id}` returns `200` as the login-redirect shell, so the check
went green while the console was dead.

The set of pages the old check could reach was exactly the set that cannot
crash in an interesting way.

**Here is that gap, measured.** A signed-out run against a healthy deployment:

```
ROUTE                              AUTH  STATUS  RENDERED  ERRORS
✖ /settings                        yes   200     NO        0
✖ /wallet                          yes   200     NO        0
✖ /welcome                         yes   200     NO        0
✖ /kit-check                       yes   200     NO        0
✖ /profile                         yes   200     NO        0
✔ /discover                         —    200     yes       0
✔ /notifications                    —    200     yes       0
✔ /shows                            —    200     yes       0
```

Five routes, `200` each, **nothing rendered on any of them**. An HTTP-status
check calls all five green.

## What "rendered" means here

Not a status code, and not "HTML came back". Each route must:

1. raise **zero** uncaught page errors,
2. log **zero** console errors (a short, specific ignore list covers the
   headless browser having no camera — nothing else),
3. and contain a **marker**: a string only the real, rendered surface
   produces.

The marker is the important half. `/settings` has to contain
`REQUEST MY DATA`; the artist console has to contain `Schedule a show`. A
login screen contains neither, so **a redirect to login cannot pass as a
render** — which is precisely how the old check was fooled.

## One-time setup — ONE CLICK REMAINS

The check signs in **through the app's own login form**. No preview-only auth
bypass: a deployed auth side door is a real hazard for a saving of about ten
lines, and signing in normally also proves the login path still works.

**The account already exists.** I created it through the normal signup form:

| | |
|---|---|
| Email | `loud-smoke@loudentify.test` |
| Password | in `./smoke.env` (gitignored, on your machine) |
| Role | artist, handle `loud_smoke_test` |

*(The first attempt returned `500 "Error sending confirmation email"`. That
turned out to be Supabase's built-in email RATE LIMIT, not broken SMTP —
retrying the next day succeeded. Worth knowing on its own: during a heavy
testing session, real signups will start failing the same way.)*

**What is left is one click, and only you can do it** — the address is not a
real inbox, so the confirmation email cannot be opened:

> **Supabase → Authentication → Users → `loud-smoke@loudentify.test` → ⋯ →
> Confirm email**

Then:

```bash
set -a; . ./smoke.env; set +a
npm run smoke
```

Sign-in currently fails with **"Email not confirmed"** — the check reports
that exact message, which is the error-extractor fix working.

### If you would rather not confirm by hand

Either of these removes the need entirely:

**Turn off Confirm-email for the preview project** — Supabase →
Authentication → Providers → Email → *Confirm email: off*. Worth weighing on
its own merits: with it on and no custom SMTP, signups fail whenever the
built-in quota is hit.

**Or seed the account with the admin API** — the original Option A below.
I could not run it: the service-role key is marked Sensitive in Vercel and
cannot be read back.

### Option A — create the account (recommended, ~1 minute)

Get your service-role key from **Supabase → Project Settings → API**, then:

```bash
export NEXT_PUBLIC_SUPABASE_URL='https://YOUR-PROJECT.supabase.co'
export SUPABASE_SERVICE_ROLE_KEY='eyJ...'          # not stored anywhere
export SMOKE_EMAIL='loud-smoke@loudentify.test'
export SMOKE_PASSWORD='pick-something-long'

npm run smoke:bootstrap
```

**What it writes:** one row in `auth.users` with `email_confirm: true`, plus
its `profiles` row (role `artist`). Nothing else. No schema change — the
migration boundary is untouched.

`npm run smoke:bootstrap -- --delete` removes it again, profile and all.

> **Why the admin API and not the signup form?** I tried the form first. On
> this project it returns
> `500 {"code":"unexpected_failure","message":"Error sending confirmation
> email"}` — email confirmation is on and SMTP is not configured, so no user
> is created at all. `email_confirm: true` is the documented way to seed an
> account past that. (That 500 also surfaced a real bug, now fixed: it
> rendered on screen as the literal string `{}`.)

### Option B — turn off email confirmation on the preview project

**Supabase → Authentication → Providers → Email → Confirm email: off.** Then
the normal signup form works and you can create the account by hand, or with
the browser-driven version of the bootstrap. No admin call anywhere.

Worth considering on its own merits: with confirmation on and no SMTP, **real
signups on this project are currently failing too**.

## Running it

```bash
export SMOKE_URL='https://loud-xxxx-korey-alashe.vercel.app'
export VERCEL_AUTOMATION_BYPASS='...'   # Vercel → Settings → Deployment Protection
export SMOKE_EMAIL='loud-smoke@loudentify.test'
export SMOKE_PASSWORD='...'

npm run smoke
```

Green looks like:

```
ALL 8 ROUTES RENDERED CLEAN (5 of them GATED), SIGNED IN AS loud-smoke@loudentify.test
```

Exit code is 0 only if **every** route rendered **and** the sign-in
succeeded. A failed sign-in does not abort the run — it continues signed out
and reports everything as unverified, which is an honest result rather than a
green tick on nothing.

## Where it fits

| Check | Catches | Cost |
|---|---|---|
| `npm run build` | syntax, imports that don't resolve, type-ish errors | seconds |
| `npm run check:tdz` | use-before-define (crash 2's class) | seconds |
| `npm run check:undef` | **undefined identifiers (crash 3's class)** | seconds |
| `npm run smoke` | **anything that throws or fails to render, signed in** (crash 1's class, and the other two as a backstop) | ~40s |

`npm run check` runs the two static sweeps together. `npm run smoke` needs a
deployment and credentials, so it stays separate.

**None of these replace the device script.** They catch *dead pages*. They
cannot tell you a camera didn't appear, a clip didn't cut, or a countdown
counted to the wrong moment — that is still `docs/OVERNIGHT2_DEVICE_TEST.md`
and a real phone.

## The standing rule this creates

From here on, a definition-of-done names **which authenticated routes were
loaded signed-in and confirmed rendered** — not that something returned 200.
If the smoke check could not run, that is stated, along with which surfaces
are therefore unverified.
