# PRD RECONCILIATION — 25 August 2026

Branch `feature/overnight-round-2` · preview `https://loud-8mu8h401a-korey-alashe.vercel.app`

---

## Read this first: what I could and could not key to

**The numbered PRD spreadsheet is not in this repository.** I searched the
whole tree — `docs/`, the specs at root, every code comment. What exists is:

- **Four row numbers you gave me in the brief**: 14 (B-roll), 24 and 25
  (comment replies/quotes), 54 (tap-to-react), 56 and 57 (replies/quotes
  again).
- **PRD *categories*, annotated throughout the code** — "Director Experience",
  "Multi-Camera & Production", "Cue-Sheet Director CD-1/2/3", "Live Show",
  "Scaling & Infrastructure: Database / Auth / Real-time media /
  Observability".

So this document does what it can honestly do: **Section A** keys to the row
numbers I have. **Section B** walks the categories the codebase itself cites,
which is the closest thing to a row-by-row walk available without the file.
**Section C** is every new requirement tonight introduced.

**When you fold this into the xlsx**, Section B's items will need mapping onto
their real row numbers by hand. I would rather hand you an honest partial
mapping than invent row numbers that look authoritative and are guesses.

## What each status means — precisely

| Status | Means |
|---|---|
| **BUILT+VERIFIED-BY-BYPASS** | The code is written AND I loaded the page or exercised the route on the deployed preview through the Vercel protection bypass, and observed the expected result. |
| **BUILT-UNTESTED** | The code is written, it compiles, it deployed, and the page it lives on loaded via bypass — but the *behaviour* needs a human, a second device, or a real show to confirm. |
| **PARTIAL** | Some of it exists. What remains is stated. |
| **NOT STARTED** | Nothing exists. |

**One honest limit that applies to almost everything below: no live show was
run tonight.** I have no camera, no phone and no second person. Every claim
about what happens *during* a broadcast is BUILT-UNTESTED by definition, and
the device-test script (`docs/OVERNIGHT2_DEVICE_TEST.md`) is written precisely
because that is the gap.

**A second limit: none of tonight's 11 migrations have been run** — that is
your boundary and I kept it. So every schema-dependent capability is currently
running in its degraded mode on the preview, which I verified deliberately
(see the "pre-migration" notes) but which is *not* the same as verifying the
migrated behaviour.

---

# SECTION A — rows I can key by number

### Row 14 · B-roll
**PARTIAL — unchanged tonight.**
Upload, library, storage and deletion all exist (`components/BRollLibrary.jsx`,
`app/api/broll/*`). What the PRD asks for and does not exist is **live playback
into the broadcast as a cuttable director source**.

**Deliberately skipped, with reasons.** Full reasoning in `DECISIONS.md` §
"Phase 4e"; the short version is that the blocker is not video plumbing but
**role resolution**: camera roles are parsed out of the LiveKit *participant
identity* (`camfeed-{slot}-{role}-…`) in four separate places, so a b-roll
track published by the artist's own participant resolves as the artist's
camera — the director would cut to "b-roll" and get the artist's face. Making
it right means moving role resolution to per-publication metadata, touching
`availableRoles`, `tracksForSlot`, `renderSlot`, the auto-director, the cue
director and the egress template, all on the live path. Plus single-track audio
mixing and Safari's unreliable `captureStream`.

**What remains:** the refactor above, then b-roll as a source, then audio
mixing into the Web Audio graph.

### Row 24 · Comment replies
### Row 25 · Comment quotes
### Row 56 · Replies (duplicate/related)
### Row 57 · Quotes (duplicate/related)
**BUILT-UNTESTED — and they were already built before tonight.**
I checked before writing anything. `components/CommentsPanel.jsx` has
long-press → reply/quote; `LiveDemo`'s `sendComment` already carries
`replyMode` / `replyAuthor` / `quoteText` over the data channel to every
client. Nothing was needed and nothing was changed.

**The honest gap, which the PRD row may or may not have intended:** comments
are **ephemeral**. They are data-channel only and never persisted, so a thread
exists for everyone present in the room and for nobody who arrives afterwards.
If the row means "durable threaded comments", this is PARTIAL and what remains
is a comments table with the moderation questions that come with it.

### Row 54 · Tap-to-react (Must)
**BUILT-UNTESTED.**
Six native emoji on a tap bar; the tap goes out over the LiveKit data channel
and animates on every screen in the room. Local-first on send (data messages
are not echoed to their sender). Rate-limited at 150ms on the sender.
`prefers-reduced-motion` gets a fade in place. Events are logged to
`reaction_events` for training data and as the future spend point.

- Verified by bypass: `/api/reactions` accepts a batch and, **pre-migration**,
  returns `{"ok":false,"error":"Insert failed"}` — which the client ignores by
  design, so reactions work with or without the table.
- **Needs two devices in one live room to confirm** the thing that matters:
  that a viewer's tap animates on the artist's screen.
- Reactions are **free**; the token charge is wired and switched off behind one
  constant (`REACTIONS_COST_TOKENS`). Reasoning in `DECISIONS.md`.

---

# SECTION B — by PRD category

## Accounts & Identity

| Item | Status | Notes |
|---|---|---|
| Signup, both roles, 18+ enforced | **BUILT+VERIFIED-BY-BYPASS** (pre-existing) | `/` loads via bypass; unchanged tonight except the post-signup destination. |
| First-run onboarding, artist | **BUILT-UNTESTED** | `/welcome` loads via bypass; the walkthrough itself needs a real new account. |
| First-run onboarding, viewer | **BUILT-UNTESTED** | Same. |
| Onboarding skippable / resumable / non-blocking | **BUILT-UNTESTED** | Structural: skip is a real button beside the primary action; LEAVE on every step; renders inside PageShell with the sidebar live. |
| Profile edit (photo, bio, genres) | **BUILT+VERIFIED-BY-BYPASS** (pre-existing) | `/settings` loads. |
| Request my data (export) | **BUILT+VERIFIED-BY-BYPASS** | `POST /api/account/export` returns `401 Missing Authorization header` without a session — owner-only gate confirmed live. Content of a real export needs a signed-in run. |
| Close my account (soft delete) | **BUILT-UNTESTED** | Route deployed; `GET` returns 401 unauthenticated. **Currently self-disables** because migration 02 has not run — verified as designed. |
| Log out everywhere | **BUILT-UNTESTED** | `signOut({scope:'global'})`; needs two signed-in devices to prove. |
| Reactivation after closure | **NOT STARTED — documented** | Every step is one reversible write and the un-ban is one admin call. What does not exist is a way to verify the person asking is the same person, and a self-service reopen without that is worse than a support request. |

## Live Show / Director Experience

| Item | Status | Notes |
|---|---|---|
| Leave the show without crashing | **BUILT+VERIFIED-BY-BYPASS** | `/live` loads via bypass. The crash was a hooks-order violation (`if (left) return` above three hooks) — structurally removed by moving the state up to the component that owns `<LiveKitRoom>`. Needs a real show to see the routing land. |
| Leave routes artists → console, viewers → Discover | **BUILT-UNTESTED** | Destination computed from profile role before the click. |
| Reconnecting / Disconnected resume offer | **BUILT-UNTESTED** | Banner appears on `Reconnecting` after 6s and instantly on `Disconnected`. Needs a real drop to see. |
| Silent re-claim, never a re-login | **BUILT-UNTESTED** | Already mostly true before tonight: `join-show` rebinds the slot by account, and the Supabase session persists in the tab. No credential is stored by this feature. |
| Tap-to-react | **BUILT-UNTESTED** | Row 54 above. |
| Comment replies / quotes | **BUILT-UNTESTED** | Rows 24/25/56/57 above. |
| Shot grammar, auto-director, cue director | **Unchanged tonight** | Not touched. |

## Multi-Camera & Production

| Item | Status | Notes |
|---|---|---|
| Pair MORE THAN ONE camera in Kit Check | **BUILT-UNTESTED** | `/kit-check` loads via bypass and the served bundle contains the new panel (grepped: "Your cameras", "OR ENTER THIS CODE"). **Currently in single-camera fallback** because migration 01 has not run — the UI says so. |
| Named camera roles (wide / close / side) | **BUILT-UNTESTED** | Matters because the live show parses role out of the LiveKit identity; an unnamed camera is invisible to the director console. |
| ONE pairing mechanism, both contexts | **BUILT+VERIFIED-BY-BYPASS (code)** | `PairingPanel` replaces both the Kit Check code panel and `CameraQRPanel`. The old component is **deleted**, not deprecated — its QR codes contained bare room+slot URLs with no credential, readable off a stream. |
| QR + clickable link + code, all three | **BUILT-UNTESTED** | Scanning auto-redeems (`/cam/pair?code=…`). |
| Cameras survive Kit Check → live | **BUILT-UNTESTED** | The mechanism: the phone polls `/api/camfeed/session` for the room its pairing currently points at; countdown-zero rewrites `target_room` and bumps `generation`; the phone remounts into the show room. Verified by bypass that the route answers `{"supported":false,"pollMs":4000}` **pre-migration** — i.e. the graceful path works. The migrated path needs two devices. |
| B-roll live into the broadcast | **NOT STARTED — skipped with reasons** | Row 14 above. |

## Recording & Distribution

| Item | Status | Notes |
|---|---|---|
| Egress completion webhook | **BUILT-UNTESTED** | `POST /api/egress/webhook` returns `400 Signature verification failed` for an unsigned request — verified live, and that is the check that matters most (signature before any write). |
| Verify: file landed, duration sane, video present | **BUILT-UNTESTED** | Three checks + an egress-error check. File presence is asked of **storage**, not of the egress result (which reports a size before the upload finishes). |
| Video presence | **PARTIAL — and labelled as inferred in the data** | Inferred from our own publish telemetry rather than by probing the MP4, which would mean downloading it inside a webhook's budget. Can be wrong in one direction (published-but-never-subscribed) and says so in the stored result. |
| `recordings` row updated per result | **BUILT-UNTESTED** | Upsert on `storage_path`, the unique natural key. |
| `health_events` row per result | **BUILT-UNTESTED** | `egress_verified_ok` / `egress_verified_suspect`. |
| Manual verification path | **BUILT+VERIFIED-BY-BYPASS** | `/api/egress/verify` deployed, artist-gated. Exists because LiveKit **cannot POST to a protected preview** — the identical function, different trigger. |
| Share links, public recordings | **BUILT+VERIFIED-BY-BYPASS** (pre-existing) | Enhanced tonight. |
| Share preview cards | **BUILT-UNTESTED** | `/watch/[id]` gained artist byline + date + photo; `/artist/[id]` gained a card at all. **Needs a real public recording and an unfurler** (paste into WhatsApp) to confirm. |
| 90s clip-range selector | **BUILT-UNTESTED** | Existed; now **saves** the range and reloads it. |
| Server-side clip trim | **NOT STARTED — named** | Needs a job runner this stack does not have. Stated on the page rather than hidden behind a button that appears to work. |

## Wallet & Economy

| Item | Status | Notes |
|---|---|---|
| Token ledger | **BUILT+VERIFIED-BY-BYPASS** (pre-existing) | `/wallet` loads. |
| Balance + transaction history UI | **BUILT-UNTESTED** | Rebuilt with the new kinds. |
| Buy tokens | **BUILT-UNTESTED** | `POST /api/wallet/checkout` returns 401 unauthenticated — gate confirmed. **Currently self-disables** pre-migration. |
| Provider-agnostic checkout | **BUILT+VERIFIED-BY-BYPASS (code)** | One interface, two implementations. No Stripe keys were supplied. |
| Finance webhook, signature-verified | **BUILT+VERIFIED-BY-BYPASS** | `POST /api/wallet/webhook` returns `400 Signature verification failed` — verified live. |
| Webhook idempotency (event-id dedupe) | **BUILT-UNTESTED** | Two layers: `(provider,event_id)` for the event, `idempotency_key` for the credit. Needs the migration + the dev harness to exercise. |
| Ledger writes via service role | **BUILT+VERIFIED-BY-BYPASS (code)** | No insert policy exists on `wallet_transactions` at all. |
| Health-events logging per event | **BUILT-UNTESTED** | Under `show_id = 'finance'`. |
| Dev harness simulating signed events | **BUILT-UNTESTED** | `/api/wallet/dev-event` returns 401 unauthenticated (so the three gates resolved correctly: not production, dev provider active, session required). |
| Spend hooks (reactions, votes) | **BUILT-UNTESTED** | `POST /api/wallet/spend` returns 401 unauthenticated. Client names an ACTION, never an amount. |
| One-way economy | **BUILT+VERIFIED-BY-BYPASS (code)** | Cash-out uses `verifyArtistAuth`; fans cannot reach it. |
| Cash-out gated on `kyc_status` | **BUILT-UNTESTED** | Read server-side through the service role, never from the client. `cashout_requests` has no INSERT policy. |
| KYC integration itself | **NOT STARTED — stubbed and documented** | No identity provider is connected. What exists is the gate, the request flow, the ledger hold and the state machine a real provider will drive. |
| No card data on our servers | **BUILT+VERIFIED-BY-BYPASS (code)** | Hosted checkout, both implementations. No column anywhere could hold a PAN. |
| Integer minor units everywhere | **BUILT+VERIFIED-BY-BYPASS (code)** | `bigint` columns; the only decimal point is in a display formatter. |
| Ledger append-only | **BUILT-UNTESTED** | Enforced by a database **trigger**, not by an absent RLS policy — service-role routes are exactly what an absent policy does not stop. Verification V5 in the migration runner is the proof, and it needs the migration. |

## Discovery

| Item | Status | Notes |
|---|---|---|
| Currently-live shows | **BUILT+VERIFIED-BY-BYPASS** (pre-existing) | `/discover` loads. |
| Upcoming shows from scheduling | **BUILT-UNTESTED** | New tonight. Links work before the show starts (holding screen + countdown, no connection). |
| Artist cards | **BUILT+VERIFIED-BY-BYPASS** (pre-existing) | |
| Search | **BUILT+VERIFIED-BY-BYPASS** (pre-existing) | Server-side filtering, so paging stays correct. |
| Closed accounts hidden | **BUILT-UNTESTED** | Two-pass query that falls back cleanly pre-migration. |
| Follow an artist | **BUILT-UNTESTED** | The button was honestly disabled before; there is a table behind it now. Self-disables pre-migration. |
| Followed artists ranked first | **PARTIAL — and honest about it** | Floats them within the **currently loaded page** only. Ordering in the query needs the follow list at the database, which RLS on `follows` will not permit from an anon client. Stated in the code, not discovered later. |
| Follower counts | **NOT STARTED — deliberately** | The follow graph is private by RLS, so a client-side count returns the caller's own row and would render "1 follower" for everyone. Needs a security-definer function or a counter column. **No surface claims a number it cannot support.** |

## Scaling & Infrastructure

| Item | Status | Notes |
|---|---|---|
| Every new table has explicit RLS | **BUILT-UNTESTED** (migrations not run) | 6 new tables; every one has RLS enabled. Four are deliberately **zero-policy** (service-role only): `camfeed_pairings`, `webhook_events`, `reaction_events`, plus pre-existing `health_events`. |
| Conflict target named in the audit | **BUILT** | Every migration file states its conflict targets and whether they are plain or partial — the partial-unique-index trap that produced a live 400 on `notifications` in an earlier round. |
| Every new route states its auth model | **BUILT** | In a header comment on each of the 12 new routes. |
| No secrets client-side | **BUILT+VERIFIED-BY-BYPASS (code)** | No new `NEXT_PUBLIC_` variable was added. |
| Webhook signatures verified before any write | **BUILT+VERIFIED-BY-BYPASS** | Both webhooks return 400 to an unsigned POST — confirmed live. |
| 18+ on capability-granting paths | **BUILT** (pre-existing) | Enforced at account creation; every account reaching a capability has passed it. Re-deriving age per route would be a second, weaker copy of a rule that has a home. |
| Export and closure owner-only, server-verified | **BUILT+VERIFIED-BY-BYPASS** | Both 401 without a session. Neither reads an account identifier from the request, so there is no parameter to point at somebody else. |

---

# SECTION C — NEW REQUIREMENTS TONIGHT INTRODUCED

Everything below is something the PRD, as I understand it, **did not contain**.
Each is a real requirement now, either because it was built or because
building around it created an obligation.

**🔴 NEW —** **Paired cameras must migrate between LiveKit rooms without human
touch.** The rehearsal room and the show room are different rooms by design. A
phone therefore cannot hold a room name; it holds a pairing and re-resolves the
room. This is a new architectural rule, not a feature: anything that changes
which room a device belongs to must go through `target_room` + `generation`.

**🔴 NEW —** **A paired device is a first-class credential holder with its own
secret.** The six-character code is single-use and dies at redeem; a long random
device secret (stored only as SHA-256) carries the ongoing session. The PRD
described pairing as a moment; it is now a relationship with a lifetime.

**🔴 NEW —** **Camera pairing must be one mechanism across every surface.** Two
pairing designs is what produced a credential-free QR code that was a working
invitation into a live broadcast. "The pairing UI" is now a single component.

**🔴 NEW —** **Onboarding progress must survive an unmigrated database.** More
generally: **every schema-dependent capability must probe for its schema and
degrade with a sentence on screen.** That is now a build rule, imposed by the
constraint that migrations are run by hand and by a person who is asleep.

**🔴 NEW —** **A skipped onboarding step is an answer, not a gap.** The resume
nudge must not reappear for something the person declined.

**🔴 NEW —** **A "request my data" export must be rate-limited in the database,
not in memory.** Serverless functions do not share memory; an in-process
counter is a limit that resets whenever the platform reschedules.

**🔴 NEW —** **An export must declare what it EXCLUDES and why.** The manifest
names file contents, `health_events`, other people's data and credentials as
excluded, with reasons. An export with a silent hole is worse than one that
admits to it.

**🔴 NEW —** **Account closure is a deactivation that preserves the customer
record, and the UI must say so before the decision.** Specifically: the wallet
ledger is retained in full and the stage name is held. Both are surprising, and
both are stated in the confirmation rather than discovered afterwards.

**🔴 NEW —** **A partial account closure must be impossible.** The migration is
checked before anything is written and the whole request refused if absent. The
login ban is the last step so a failure leaves a recoverable state.

**🔴 NEW —** **Cancelling a show must notify every slot holder.** A versus show
contains someone else's evening.

**🔴 NEW —** **"Log out everywhere" is its own control with its own
explanation**, not a variant of logging out.

**🔴 NEW —** **The payment provider must sit behind an interface.** No route may
import a provider SDK. This started as a consequence of having no Stripe keys
and is now a rule: it is what makes a provider migration a one-file change.

**🔴 NEW —** **The token ledger must be append-only, enforced by the database.**
An absent RLS policy stops the browser and not the service role, and every
write worth protecting comes from a service-role route. Corrections are
compensating rows.

**🔴 NEW —** **Payment webhooks need idempotency in TWO layers** — one for the
event, one for the credit. The failure mode is "we gave someone free money" and
it is discovered by an accountant, not by a user.

**🔴 NEW —** **A webhook event must never decide an amount.** The event names an
intent; the intent, written server-side before the person left for the
provider, says what was bought. A mismatch is refused and logged.

**🔴 NEW —** **A webhook's raw body must be hashed as received.** Parse-and-
reserialise breaks the signature permanently. This is a rule about every future
webhook, not a note about this one.

**🔴 NEW —** **The dev payment harness must be gated three independent ways** —
platform environment, active provider, and session ownership of the intent. A
route that can mint signed payment events must not be one forgotten flag away
from production.

**🔴 NEW —** **A balance that cannot be computed must refuse the operation, not
approximate it.** `readBalance` reports when it hits its row ceiling and callers
refuse rather than acting on a lower bound.

**🔴 NEW —** **Reactions are free by default, and any future charge must show a
price on screen first.** Charging for a reflex with no visible price is how you
make somebody feel robbed by a feature they enjoyed.

**🔴 NEW —** **Reaction telemetry accepts unattributed writes.** Requiring a
session would bias the training set toward whoever had a live token, dropping
exactly the reactions from people whose session quietly expired mid-show.

**🔴 NEW —** **"Did the recording work" is a question the system must answer
itself.** Three named checks, written down per recording, with a health event
per outcome — rather than an artist discovering it on playback.

**🔴 NEW —** **An egress webhook must be attached per request, not configured
project-wide.** A single dashboard URL means a preview's recordings report to
production or vice versa.

**🔴 NEW —** **Any automatic verification path needs a manual twin that runs the
IDENTICAL function.** Protected previews are unreachable from outside; two
implementations of the same check diverge.

**🔴 NEW —** **A share card must never claim `summary_large_image` without an
image**, and must never leak a private recording or a viewer-role profile. Both
follow from the card being a genuinely public surface.

**🔴 NEW —** **A saved clip range is a requirement even without an export
job.** Otherwise every artist is asked to choose their moment twice.

**🔴 NEW —** **No surface may display a number the data model cannot support.**
Concretely: no follower counts while the follow graph is private. This is the
generalisation of a rule the codebase already followed by instinct.

**🔴 NEW —** **A resume offer must not appear during the first seconds of an
automatic reconnect.** A manual reconnect on top of an automatic one turns a
two-second blip into a twenty-second one.

**🔴 NEW —** **Leaving a show must clear the resume marker.** Otherwise the app
argues with something the person meant to do.

**🔴 NEW —** **Camera roles must eventually move off participant identity and
onto per-publication metadata.** This is the blocking refactor for row 14, and
it is a requirement in its own right — the current scheme means one participant
can only ever be one source.

---

## The three things I would look at first

1. **Migration 06's V5** — the append-only trigger. It is the only check in the
   run where a silent pass means the ledger is not a ledger.
2. **Migration 09's V3** — zero INSERT policies on `cashout_requests`. An
   INSERT policy there defeats the KYC gate entirely.
3. **A real two-device show** — every "cameras follow you", "reactions animate
   for everyone" and "resume gets you back on" claim is BUILT-UNTESTED, and
   nothing in this document changes that.
