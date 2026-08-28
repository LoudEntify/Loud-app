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

## Setup — done

The check signs in **through the app's own login form**. No preview-only auth
bypass: a deployed auth side door is a real hazard for a saving of about ten
lines, and signing in normally also proves the login path still works.

| | |
|---|---|
| Email | `loud-smoke@loudentify.test` |
| Password | in `./smoke.env` (gitignored, on your machine) |
| Role | artist, handle `loud_smoke_test` |

Created through the normal signup form, then **confirmed by setting
`email_confirmed_at` in SQL** — this Supabase version has no Confirm button in
the dashboard.

Two things that surfaced getting here, both worth keeping:

- The first signup attempt returned `500 "Error sending confirmation email"`.
  That was Supabase's built-in email **rate limit**, not broken SMTP —
  retrying the next day succeeded. **During a heavy testing session, real
  signups will start failing the same way.** Custom SMTP is the fix if that
  ever matters.
- That 500 rendered on screen as the literal string `{}`. Fixed — errors now
  go through a message extractor rather than assuming `.message` exists.

### If you ever need to recreate it

`npm run smoke:bootstrap` creates the account directly with
`email_confirm: true`, skipping the email entirely. It needs the service-role
key (Supabase → Project Settings → API), which is the only reason I could not
run it myself — it is marked Sensitive in Vercel and cannot be read back.

```bash
export NEXT_PUBLIC_SUPABASE_URL='https://YOUR-PROJECT.supabase.co'
export SUPABASE_SERVICE_ROLE_KEY='eyJ...'
set -a; . ./smoke.env; set +a

npm run smoke:bootstrap             # create (or adopt an existing user)
npm run smoke:bootstrap -- --delete # remove it again, profile and all
```

It writes one row in `auth.users` plus its `profiles` row. No schema change.

## Running it

```bash
# point smoke.env at the deployment you want, then:
set -a; . ./smoke.env; set +a
npm run smoke
```

Green looks like this — and this is a real run, not an example:

```
signed in as loud-smoke@loudentify.test — console at /artist/1a3c9fe8-…

ROUTE                              AUTH  STATUS  RENDERED  ERRORS
✔ /settings                        yes   200     yes       0
✔ /wallet                          yes   200     yes       0
✔ /welcome                         yes   200     yes       0
✔ /kit-check                       yes   200     yes       0
✔ /live                            yes   200     yes       0
✔ /live?show=0000…0000             yes   200     yes       0
✔ /artist/{own id}                 yes   200     yes       0
✔ /discover                         —    200     yes       0
✔ /notifications                    —    200     yes       0
✔ /shows                            —    200     yes       0
ALL 10 ROUTES RENDERED CLEAN (7 of them GATED)
```

### What the `/live` rows do and do not cover

Both mount `LiveDemo` and render its **resolution** screens — bare `/live`
lands on *"No show here — this link is missing a show"*, and an unknown id on
*"That link doesn't point at a show we can find."* That is a real render of
the live page's component tree, so a crash in it is caught.

It is **not** a live show. An actual room needs LiveKit and an open broadcast
window; that is the device script's job, and running it on every smoke
invocation would bill LiveKit minutes.

**Deliberately not seeded with a real show.** A permanent smoke-test show
would sit in Discover's COMING UP where real people can see it, and
creating/deleting one per run would make the check write to the database every
time it runs. Neither is worth what it would add over the two states above.

> The first run of this check reported `/live` as a FAILURE — marker
> `LOUDENTIFY` not found, body 257 chars. That was **the harness, not the
> app**: `LOUDENTIFY` only appears in the `HoldingScreen`, a state neither of
> these routes reaches. Bare `/live` renders correctly and always did. Kept
> here because a check that fails loudly on its own bad assumption is behaving
> exactly as intended.

Exit code is 0 only if **every** route rendered **and** the sign-in
succeeded. A failed sign-in does not abort the run — it continues signed out
and reports everything as unverified, which is an honest result rather than a
green tick on nothing.

## Where it fits

| Check | Catches | Cost |
|---|---|---|
| `npm run check:tdz` | use-before-define — crash 2's class | seconds |
| `npm run check:undef` | undefined identifiers — **crash 3's class** | seconds |
| `node scripts/window-tests.mjs` | the show-window and Kit Check handover predicates — **the countdown's class** | instant |
| `npm run check:build` | a build that WARNS about a missing import and still exits 0 — the same silent class as crash 3 | ~30s |
| `npm run smoke` | **anything that throws or fails to render, signed in** — crash 1's class, and the others as a backstop | ~40s |

`npm run check` runs the first four. `npm run smoke` needs a deployment and
credentials, so it stays separate.

**None of these replace the device script.** They catch *dead pages*. They
cannot tell you a camera didn't appear, a clip didn't cut, or a countdown
counted to the wrong moment — that is still `docs/OVERNIGHT2_DEVICE_TEST.md`
and a real phone.

## The standing rule — now actually satisfiable

From here on, a definition-of-done names **which authenticated routes were
loaded signed-in and confirmed rendered** — not that something returned 200.

That rule was written before it could be met. It can be met now: the account
exists, the check runs in about forty seconds, and a green run names every
route it covered. Paste its table.

If it could not run, say so and name which surfaces are therefore unverified —
as the previous round did, when six were.

**The contrast, from one run against the same healthy deployment**, because it
is the clearest statement of why this exists:

| | `/settings` | `/wallet` | `/welcome` | `/kit-check` | `/live` | `/artist/{id}` |
|---|---|---|---|---|---|---|
| **Signed out** | 200, blank | 200, blank | 200, blank | 200, blank | 200, blank | 200, blank |
| **Signed in** | rendered | rendered | rendered | rendered | rendered | rendered |

Six routes. The old check saw the top row and called it green.

### What it still cannot tell you

It catches **dead pages**. It cannot tell you a camera never appeared, a clip
did not cut, a countdown counted to the wrong moment, or a paired phone stayed
in the rehearsal room. Every one of those has happened, and every one needs
`docs/OVERNIGHT2_DEVICE_TEST.md` and a real phone.
