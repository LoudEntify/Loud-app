# Retrospective security audit — 2026-08-28

Full sweep of the authenticated and API surface built across the overnight
rounds. **31 API routes, every one read.** Findings by severity, with what
was verified against the deployed preview rather than inferred from source.

**One CRITICAL, fixed and verified. The four HIGH/MEDIUM findings were
then approved and closed in a follow-up round — see "Status: all closed"
at the foot of this document.**

Deployment probed: `https://loud-awkxbem3j-korey-alashe.vercel.app`
Fix commit: `d82837e`

---

## CRITICAL — fixed

### 1. Unauthenticated publish into any live show

`app/api/token/route.js` — `?camfeed=a|b` minted a **CAMERA-publish**
LiveKit token into **any room, for any caller, with no authentication of
any kind**.

The chain needed no account and no guessing:

| | Step | Why it works |
|---|---|---|
| 1 | Open any show's public link `/live?show={uuid}` | Share links are public by design |
| 2 | Read `room_name` from the network tab | `LiveDemo.jsx:694` resolves the show with `select('*')` through the **anon** client, so every viewer's browser receives `room_name` |
| 3 | `GET /api/token?room={room_name}&camfeed=a` | No `Authorization` header required |
| 4 | Publish a camera track | The token permits it |

**Measured before the fix**, no credentials sent:

```
HTTP 200
{"room":"probe-room","roomJoin":true,"canPublish":true,
 "canPublishSources":["camera"],"canSubscribe":true,"canPublishData":false}
```

A stranger could put their own camera on stage in someone's live show, in
front of their audience.

**Fixed** the same way `?contestant=` was closed on Accounts & Identity
Day 1: the branch is gone, the parameter is logged if anyone still sends
it, and the caller falls through to the subscribe-only grant every viewer
gets.

**Nothing real breaks.** The only caller was `components/CamPage.jsx` —
the legacy `/cam?room=…&slot=…` QR page, which **nothing in the current UI
links to** (confirmed by grep across `app/`, `components/`, `lib/`: every
pairing link produced anywhere is `/cam/pair?code=…`). Phase 0a's pairing
flow replaced it and is strictly better: a six-character code, a
per-device secret stored only as a SHA-256, and a phone that follows the
artist from Kit Check into the show. That page now says so rather than
silently failing to publish.

**Verified after the fix**, same probe: `canPublish:false`, `sources:[]`,
on all five token shapes.

---

## HIGH — queued, not fixed

### 2. `POST /api/egress/stop` — unauthenticated, and destructive

No auth of any kind. **Confirmed executing the LiveKit call with no
credentials** on the deployed preview (`HTTP 200 {"ok":true,
"stopped":false}` — `false` only because the probe used a room with
nothing recording).

Same `room_name` exposure as finding 1, so the same public show link
gives an attacker the one input it needs. Consequence is worse than it
looks: **a stopped recording is a performance that cannot be
re-recorded.**

### 3. `POST /api/egress/start` — unauthenticated

Same exposure. Starts a billed LiveKit egress on an arbitrary room and
writes to the S3 bucket. Cost and junk-file abuse rather than data loss.

**Why both are queued rather than fixed:** the fix is
`verifyArtistAuth` + confirming the caller owns the show with that
`room_name`, and passing the artist's bearer from the two call sites in
`components/LiveDemo.jsx` (lines 2824 and 3935). Both sites are **in the
live broadcast path**, and I cannot verify a change there without a real
show and a real device. Getting it wrong means recordings silently stop
working mid-performance. That is exactly the trade you told me not to
make while you are mid-QA.

**Say the word and I'll do it as its own round, with the device script
updated to prove recording still starts and stops.**

### 4. `/api/cue-sheets` GET and POST trust `artist_email` from the request

The route verifies the caller is *an* artist, then queries by whatever
`artist_email` the caller supplied — never comparing it to
`auth.user.email`.

- **GET**: read another artist's cue sheet for a track.
- **POST**: the upsert conflict target is `(track_hash, artist_email,
  name)`, so it can **overwrite** another artist's sheet — including the
  `Default` one their live show is about to load.

Needs an artist account (free) plus the target's email plus the identical
audio file, since `track_hash` is a SHA-256 of the bytes. That narrows it
a lot; it does not make it correct.

Worth noting the shape of this one: **`PATCH` and `DELETE` in the same
file get it right**, re-checking ownership against the row via
`ownsSheet()`. I wrote those later, for Product Ruling 2, and never went
back to the two methods above. A file can be half-secured and read as
though it is secured.

Fix is small and contained — scope both to the verified session and
ignore the parameter — but it changes who can read what, so it is your
call, not mine, mid-QA.

---

## MEDIUM — queued

### 5. `app/api/broll/upload/route.js` came back from the dead

`740dc0c` deleted it as part of the b-roll upload fix. **`68cb676` — the
artist-console crash fix — re-added it.** An accidental resurrection
while fixing something unrelated.

It is live now: `GET` returns **405, not 404**.

Two consequences:

- `docs/OVERNIGHT2_DEVICE_TEST.md` line 66 tells you to check it returns
  `404`. **That check will fail**, and my documentation is wrong.
- The route is the original body-buffering upload path — the one that
  hung forever. It is authenticated (`verifySession`, `POST` → 401 with
  no bearer), so it is not a hole; it is a trap that was supposed to be
  gone.

Recommend deleting it again and correcting that line.

### 6. `POST /api/participants` — unauthenticated PII write

Inserts an email address against any `show_id`, no session, no rate
limit. **Confirmed reaching the insert with no auth** (500 only because
the probe used a nonexistent show id, i.e. it failed at the foreign key,
not at a gate).

### 7. `POST /api/health-events` — unauthenticated write, no rate limit

**Confirmed accepting requests with no auth** (`HTTP 200
{"ok":true,"inserted":0}`). Up to 200 rows per request. Blast radius is a
junk diagnostics table, not a user — RLS is on with zero policies, so
only the service role can read it, and nothing surfaces it to anyone. But
it is floodable.

---

## LOW — noted, already compensated

### 8. `profiles_update_own` permits writing any column on your own row

Including `kyc_status` and `deactivated_at`. Already documented in
`docs/overnight2_02_profiles.sql`, and **already compensated**: every
gate that matters re-reads the value server-side through the service-role
client and never trusts the client's copy — `app/api/wallet/cashout`
does exactly this, deliberately, with a comment saying why. Narrowing the
policy to a column list is the real fix and belongs in a migration.

---

## What was checked and found sound

Not everything is a finding, and the things that hold up are worth naming
so a future round does not re-audit them from scratch.

| Area | Verdict |
|---|---|
| `verifyArtistAuth` / `verifySession` | Sound. Bearer → service-role `getUser` (real signature verification, not a decode) → `profiles.role` check. A forged bearer returns 401 on all 13 owner-only routes probed. |
| Secret handling | No secret reaches the client. Every file touching `LIVEKIT_API_SECRET` or `SUPABASE_SERVICE_ROLE_KEY` is under `app/api/` or carries `server-only`. Client env is `NEXT_PUBLIC_SUPABASE_URL` + anon key, and nothing else. |
| `/api/broll/url`, `/api/recordings/[id]/url` | Correct. Ownership checked against the row before signing; short-TTL signed URLs; the client never sees a `storage_path`. Public recordings skip auth deliberately, by a `visibility` column, not by omission. |
| `/api/wallet/cashout` | The strongest route in the codebase. Artists only, KYC read server-side, ledger hold written at request time, nothing moves money. |
| `/api/wallet/webhook` | Signature verified before any write; unsigned payload rejected (400). |
| `/api/camfeed/session` | No user session, but a real auth model: per-device secret compared against a stored SHA-256, identical response for "no such pairing" and "wrong secret", camera-publish only — no mic, no data channel. |
| `/api/show/active-performer` | Rotating `session_token` checked against `show_slots`, and the target slot must genuinely exist for that show. |
| New-table RLS | All 12 `overnight2_*` migrations account for it. Four tables have RLS on with **zero** policies — `camfeed_pairings`, `wallet_transactions`, `webhook_events`, `reaction_events` — which is deny-all-but-service-role, and correct for tables only ever written by a route. |
| Owner/public split on `/artist/{id}` | Confirmed twice: by you in signed-out Safari (public storefront, no console, no editable fields), and by the new signed-out gate pass, which finds no `Schedule a show` for a stranger. |

---

## The permanent checks added

Nothing in the repo was ever going to catch finding 1. It is not a crash,
not a type error, not a failing test — **the route worked perfectly, for
everyone**. `npm run check` was four checks deep and every one of them
asks whether the code *runs*.

### `npm run check:routes` — static, runs with the rest

Every route under `app/api/` must reference a recognised auth mechanism
or be allowlisted **with a written reason**. Allowlist entries carry a
status:

- **`settled`** — genuinely fine unauthenticated, argued in the reason.
- **`pending`** — a known, open finding. Prints as a loud warning on
  every single run and never goes quiet, but **does not fail the build**.

That split is deliberate. Failing the build turns a known issue into a
blocked QA sitting; a plain allowlist lets a real hole go green and be
forgotten inside a file nobody reopens. An open finding should be noisy
and non-blocking. Findings 2, 3, 6 and 7 are `pending` entries right now,
so they announce themselves every time you run `npm run check`.

Clearing one means **deleting** its entry, not rewording it.

It is a file-level grep and it is honest about that: it cannot tell you a
check is in the right place, covers every method, or scopes its query
correctly once it passes. **Finding 4 passes this check** — cue-sheets
does call `verifyArtistAuth`; it just then trusts a parameter.

### `npm run probe:auth` — live, needs a deployment

Asks the running deployment for capabilities with no credentials. The
central assertion is not a status code: it **decodes the minted LiveKit
token and inspects the grant**, because finding 1 was a perfectly healthy
`200` whose body was wrong three fields down.

A token route may hand a stranger a subscribe. It may never hand one a
publish.

32 assertions: five token shapes (including both closed bypasses, so
neither can come back), 13 owner-only routes with no bearer and again
with a forged one, and an unsigned webhook payload.

No writes, no real room names, no probing anyone's data — everything is
asked against obviously-fake identifiers. That is also its limit: it
cannot find an authz bug that only appears against a real row, which is
exactly why finding 4 needed reading the source.

### `npm run smoke` — signed-out gate pass

The existing pass proves gated pages **render for the account that owns
them**. The new one proves they **do not render for a stranger** — a
fresh context, no cookies, no storage, marker assertion inverted so a
marker that *does* appear is the failure.

Two different claims, and the second was never being checked. The
failures look nothing alike from outside: a page that crashes for its
owner is loud, while a page quietly showing a stranger someone's wallet
returns a healthy 200 and looks fine to every check written before this
one.

Both passes share one `probe()` function so "rendered" cannot come to
mean two different things.

---

## Authenticated routes loaded signed-in and confirmed rendered

Per the standing rule.

```
signed in as loud-smoke@loudentify.test — console at /artist/1a3c9fe8-…

✔ /settings   ✔ /wallet   ✔ /welcome   ✔ /kit-check   ✔ /live
✔ /live?show={unknown}    ✔ /artist/{own id}
✔ /discover   ✔ /notifications   ✔ /shows
ALL 10 ROUTES RENDERED CLEAN (7 of them GATED)

SIGNED-OUT GATE — the same gated routes, as a stranger:
✔ /settings  ✔ /wallet  ✔ /welcome  ✔ /kit-check  ✔ /live
✔ /live?show={unknown}  ✔ /artist/{own id}
7 gated routes all refused a signed-out visitor.
Every one still returned a 200.

npm run probe:auth — 32/32, no capability handed to an unauthenticated caller.
```

## What none of this covers

Every check here is about **who may call what**. None of them can tell
you a camera never appeared, a clip did not cut, a countdown counted to
the wrong moment, or that the CRITICAL above was ever actually exploited
against a real show — there is no audit log that would show it. That
still needs `docs/OVERNIGHT2_DEVICE_TEST.md` and a real phone.


---

# Status: all closed (2026-08-28, follow-up round)

Findings 2, 3, 4, 6 and 7 were approved for a dedicated round and are
fixed. Every `pending` entry in `scripts/route-auth-check.mjs` has been
**deleted**, not reworded.

| # | Route | Fix | Proven by |
|---|---|---|---|
| 2 | `/api/egress/stop` | verified artist + show ownership (`lib/verifyShowOwner.js`) | `probe:auth` 401 · `probe:authz` 404 · **Sitting 6.2 on a real show** |
| 3 | `/api/egress/start` | same | same |
| 4 | `/api/cue-sheets` GET+POST | `artist_email` derived from the session; parameter accepted, validated, no longer trusted | `probe:authz` — 403 cross-account, 200 own-account controls |
| 6 | `/api/participants` | `verifySession` + email from the session + show must exist | `probe:authz` 404 |
| 7 | `/api/health-events` | stays open, deliberately; rate-limited + bounded payloads | reasoning in the route header and the allowlist |

## Three things worth carrying forward

**The captured-token trap.** The dangerous half of the egress fix was not
the route, it was the client. A Supabase access token lives about an
hour; a show can be scheduled for three. A token captured at room mount
would have been expired at End Show, and the failure shape is the worst
available — recording starts, show runs, stop silently 401s, and nobody
finds out until a recorder has run to its own timeout uploading. The
bearer is now read fresh at call time. **A short test show does not test
this**; Sitting 6.2 says so explicitly.

**Identity before configuration.** Both egress routes checked env vars
*before* authenticating, so an anonymous caller received `500 Server
missing egress environment variables` — the server's configuration state,
handed to a stranger. It also made the gate untestable, which is how it
surfaced: `probe:auth` expected 401 and got the 500, and could not tell a
closed route from an open one.

**A new probe, closing a blind spot I had written down.**
`scripts/api-authz-probe.mjs` signs in through the app's own login form
and asks the question the signed-out probe cannot: *will you serve a
logged-in user something that belongs to someone else?* That gap is
exactly what let finding 4 live — the route authenticated perfectly and
passed `check:routes`; only its authorization was wrong. Every
"other person" in it is an RFC 2606 `.invalid` address that cannot
belong to anyone, and every refusal assertion is paired with a control
proving own-account access still works.

## What is still open

**The grandfather clause.** `shows.artist_id` is nullable, and
`verifyShowOwner` mirrors `docs/ownership_migration.sql`'s own RLS rule
(`artist_id is null or artist_id = auth.uid()`) rather than inventing a
stricter one that would stop an artist ending an older show's recording.
On such a row, any verified artist passes. Bounded — not anonymous, which
was the finding — but real, and it closes on backfill. The route logs
loudly whenever the clause is actually used.

**`EGRESS_TEMPLATE_BASE_URL` is not set on Preview**, so
`/api/egress/start` returns 500 there. Pre-existing, found while
verifying this round, and not mine to set — see Sitting 6's first box.
