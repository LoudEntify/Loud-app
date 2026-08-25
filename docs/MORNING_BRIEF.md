# MORNING BRIEF — overnight build #2

25 August 2026 · branch `feature/overnight-round-2` · head `fe978f5`
Preview: `https://loud-8mu8h401a-korey-alashe.vercel.app`

**Nothing is merged. Nothing touched production. I did not touch the
database.**

---

## The 90-second version

Five phases landed. In plain terms:

1. **Kit Check now pairs a whole rig, and the phones follow you on stage.**
   You can pair three cameras instead of one, and when the countdown hits zero
   they walk into the live show with you — nobody picks up a phone. That was
   the point of Kit Check and it did not previously work.
2. **Leaving a show no longer crashes**, and it takes you somewhere sensible —
   your console if you are an artist, Discover if you are watching.
3. **New accounts get a first run.** Artists: photo, bio, genres, then a nudge
   to put a date in the diary, then an introduction to Kit Check. Fans: genres,
   then artists to follow. Skippable at every step, and it remembers where you
   were.
4. **You can ask for all your data, and you can close your account** — properly,
   with the consequences stated before you decide rather than after.
5. **Money works end to end.** Tokens can be bought, spent and cashed out —
   through a payment provider you have not connected yet, which is deliberate
   and explained below.
6. **Recordings now check themselves**, reactions work on stage, share links
   unfurl with the artist's name and photo, and Discover shows what is on
   later, not just what is on now.

**The one thing I could not do: run a show.** No camera, no phone, no second
person. Everything about what happens *during* a broadcast is written, deployed
and unverified. `docs/OVERNIGHT2_DEVICE_TEST.md` is one script covering all of
it, ordered so you reset as little as possible. About 75 minutes.

**Do this first**: `docs/MORNING_MIGRATIONS.md`. Eleven files,
paste-verify-paste-verify, about 15 minutes. **The app works right now without
them** — every feature that needs a table checks for it and says so on screen
rather than breaking — so there is no emergency and no half-state to be afraid
of.

---

# PHASE 0 · Tonight's three fixes

## 0a — Kit Check pairs a rig, not a camera

### What exists now that didn't yesterday

You can pair **three cameras**, each with a name the director console
understands: WIDE, CLOSE, SIDE. Each one gets a QR code you scan, a link you
tap, and a six-character code you can read down a phone — three ways in, one
credential behind them.

### Why it couldn't do this before, which is more interesting than it sounds

Not a missing feature — a **state shape**. Kit Check held one variable that was
simultaneously "the artist's seat in the rehearsal room" and "the one pairing
code". Two jobs in one variable is *why* a second camera could never exist:
pairing again overwrote the first. Splitting them into a session plus an array
is most of the fix.

The camera **names** matter more than they look. The live show works out what
kind of shot a camera is by reading its LiveKit identity — literally splitting
`camfeed-a-wide-3f9c` on hyphens and taking the third piece. A phone paired
without a role is connected, publishing, and **invisible to the director
console**. That is the worst failure shape there is, because nothing looks
broken.

### What you'll notice

Kit Check's "Add a camera" box is now "Your cameras", with three buttons. Each
paired camera gets a card that says WAITING, then LIVE when the phone actually
arrives. The composed view grows to fit — one camera reads as a preview, two as
a comparison, three or more as a rig.

Scanning the QR **pairs the phone by itself**. You do not walk over and tap
anything, which was the friction the QR was supposed to remove in the first
place.

### Risk and debt

- Pairing still uses session-only auth rather than artist-only. It did before,
  and tightening it inside a "multi-camera" change would have silently broken
  any not-yet-upgraded account. Flagged as a deliberate non-change.
- Six cameras per artist, capped server-side. More than anyone will prop, and
  it stops a stuck client minting codes forever.

## 0a — one pairing mechanism, and a hole closed on the way

There were **two** pairing designs. Kit Check printed a code. The live show
printed three QR codes containing `…/cam?room=X&slot=a&role=wide` — **with no
credential in them at all.**

That was fine as a pilot shortcut and stopped being fine the moment those QR
codes could appear in a frame. **Anyone who could read one off a stream could
join your live broadcast as a camera.**

The live show had the right *shape* — a picture, a link, a code — and the wrong
contents. So that shape is now the only pairing UI anywhere, and all three
affordances describe the same single-use pairing code. The old component is
**deleted**, not deprecated: leaving a credential-free QR generator in the tree
invites it back.

**You'll notice**: the ADD CAMERA panel on the live screen looks like Kit
Check's now, and its QR codes are white-on-transparent so they do not punch a
white block into your frame.

## 0b — the cameras come with you

### The mechanism, because you asked for it deliberately

**A paired phone no longer knows which room it is in. It knows which *pairing*
it is, and it asks the server where that pairing currently lives.**

The rehearsal room and the show room are different LiveKit rooms and have to
be — a rehearsal must never collide with a broadcast. So "the phone follows"
cannot mean "the same room stays valid". It has to mean the phone re-resolves.

1. When a phone redeems a code it gets a **pairing id** and a **device secret**
   (long, random, never shown to a human, stored only as a hash).
2. It asks `/api/camfeed/session` every ~4 seconds: *where do I belong?* Back
   comes a room, a token, and a **generation number**.
3. At countdown-zero, Kit Check rewrites `target_room` on every one of your
   live pairings and bumps `generation`.
4. The next poll returns a generation the phone has not seen. It tears down and
   reconnects — into the show room. **Nobody picks up a phone.**

**Why a counter and not a timestamp**: the comparison has to be exact, and a
phone's clock versus a server's clock is a difference we do not control.

**Why your client triggers it and not a scheduler**: the show room's name is
only knowable once a specific show is resolved, and your own browser is the one
thing that certainly knows which show you are walking into. A scheduler would
have to guess, and a wrong guess puts a camera in somebody else's broadcast.
The server re-checks that the show is yours regardless.

**Why the six-character code cannot be the ongoing credential**: it is six
characters *because a human reads it off a screen in bad light*. That is exactly
why it must die at redeem.

### What you'll notice

The phone's header changes from "PAIRED — REHEARSAL CAMERA" to "LIVE — SHOW
CAMERA" on its own, with a line saying the show started and it came across.
Kit Check now promises this in words underneath the composed view, so you know
before you rely on it.

### Risk and debt

- **The handover has a hard 2.5-second ceiling.** If the migrate call is slow,
  you are pushed to the show regardless. A camera arriving four seconds late is
  a shrug; *you* arriving four seconds late is the show starting without you.
  Worst case degrades to the old behaviour — phones stay behind, re-pairable
  from the live screen.
- **The device secret lives in tab memory only, not localStorage.** A phone
  that reloads has been picked up by a person, and a person can scan again.
  Persisting a publish credential to disk on a borrowed phone is the worse
  trade.
- Untested with real devices. This is the single most important thing in the
  test script.

## 0c — the leave crash

### What was actually wrong

Not LiveKit. Not routing. **A hooks-order violation.**

`RoomInner` had `if (left) return <…>` at line ~2790, and three React hooks
below that line. While `left` was false every hook ran. The instant Leave set it
true, the component returned three hooks short, React threw *"Rendered fewer
hooks than expected"*, and with no error boundary above it the page painted
white.

The shape of it is worth recognising on sight: **the guard was correct in
isolation and the hooks were correct in isolation.** What was wrong was a
conditional return sitting above hooks in a 2,300-line file, where the
relationship is invisible from either end.

There is a **sibling with the identical defect** (the camera-feed early return)
that has never crashed — purely because that condition is constant for the
component's life, so the branch is chosen once at mount. Noted rather than
"fixed": changing it is churn, and the crashing one no longer exists.

### The fix, and why not the obvious one

Not "move the return below the hooks". A component rendering "you left" from
*inside* `<LiveKitRoom>` is still in the room. The state moved **up one level**,
to the component that owns `<LiveKitRoom>` — so flipping it unmounts the room.

### What you'll notice

Leave works. Then it **takes you somewhere**: artists to their console
(recordings, next show, numbers), viewers to Discover. Destination is worked out
from your role *before* the click, so pressing Leave never pauses to look up who
you are. There is a 600ms beat — enough that the teardown does not race the
navigation, and enough that you see it worked rather than a screen swap that
reads as a glitch.

---

# PHASE 1 · Onboarding

### What exists now that didn't yesterday

A first run for both roles at `/welcome`, and a dismissible bar that offers to
finish it later.

**Artist**: photo + bio + genres → schedule your first show → meet Kit Check.
**Fan**: genres → follow some artists → Discover.

### The argument the screen is making

It is **not a form to complete before the product unlocks** — the product is
already unlocked. It is the shortest path from "I just made an account" to "I
have done the one thing that makes this place work for me": for an artist, a
date in the diary; for a fan, a reason for Discover to show them anything.

That is enforced structurally, not by good intentions:

- **Skip is a real button** with a plain word on it, the same size as the
  primary action, sitting beside it. Not a grey link in a corner. Someone who
  does not want to upload a photo at 11pm has given us an answer.
- **LEAVE is in the top right of every step**, and the walkthrough renders
  *inside* the normal shell with the sidebar live. The point made structurally:
  this is a route you can walk out of.
- **A skipped step is an answer, not a gap.** The nudge only appears for steps
  you have neither done nor declined. Asking again after someone said no is
  nagging.
- **Signup routes here; login does not.** Routing every login through
  onboarding until it is "complete" turns a helper into a gate that reappears
  every session.

### What you'll notice

New accounts land on the walkthrough. Steps that hand off elsewhere — "schedule
a show", "open Kit Check" — mark themselves done *before* navigating, because
making you come back and press "done" is asking you to file a report on
yourself.

### Also: the FOLLOW button became real

It has always honestly said it did nothing. Viewer onboarding's second step
cannot be real against a button like that, so there is a `follows` table now
and the button works.

**Deliberate omission worth knowing about**: there are **no follower counts
anywhere**, and that is not laziness. The follow graph is private by RLS — you
can see who *you* follow, an artist can see who follows *them*, and nobody can
enumerate a third party's. A client-side count under those rules returns your
own row, so it would render "1 follower" for everyone on the platform. A real
count needs a security-definer function or a maintained counter column. Neither
is built, and **no surface claims a number it cannot support**.

### Risk and debt

- **Onboarding progress falls back to localStorage** if `profiles.onboarding`
  does not exist yet. That is normally the wrong answer and is defensible *here
  and nowhere else*: it is the lowest-stakes data in the product and the worst
  case is being offered a setup step twice. It upgrades itself silently the
  first time the real column accepts a write.
- Untested with a real new account.

---

# PHASE 2 · Account control

## 2a — Request my data

### What exists now

A button in Settings that assembles your whole account — profile, shows,
recordings, wallet ledger, notifications, follows, B-roll, cue sheets, slot
claims — into one JSON file that downloads straight to your device.

### The parts that took thought

- **There is no parameter to abuse.** The route reads no account identifier
  from the request at all; it resolves your token to a user and filters every
  query by that. There is nothing an attacker could point at somebody else's
  account because there is nothing to point.
- **Rate-limited in the database, not in memory** — three per rolling 24 hours.
  Serverless functions do not share memory, so an in-process counter is a limit
  that resets whenever the platform feels like it. The refusal names a **time**
  you can retry, because "try again tomorrow" invites a midnight retry loop.
- **No file bytes.** Recordings and B-roll are listed with metadata and paths.
  A JSON document with a 400MB video base64'd into it is not an export, it is a
  denial of service against the person who asked for it.
- **It declares what it excludes and why.** The file opens with a manifest, and
  the manifest has an `excluded` block naming file contents, `health_events`,
  other people's data and credentials. `health_events` is out because it is
  keyed by LiveKit participant identity rather than account id — a best-effort
  filter of a diagnostics table risks handing someone else's session to the
  wrong person.

## 2b — Close my account

### What it does

Login disabled · profile hidden everywhere public · recordings made private ·
upcoming shows cancelled with a notification to every slot holder · **wallet
ledger retained in full** · **stage name held**.

### The two surprising ones, and why the UI defends them out loud

**The ledger is never deleted.** Money that moved, moved. A financial record you
can delete is not a financial record — and it is the part you are most likely to
need again, whether that is a tax question, a chargeback, or just checking what
happened.

**The name is held.** Not possessiveness: releasing a closed artist's name lets
someone else claim it and be mistaken for them, in a product where the name *is*
the identity.

"Close my account" means something different on every platform. The only way
someone makes an informed decision is to be told **before** they decide,
including the parts they will not like. That costs us a few people who wanted a
hard delete, and saves every one of them the experience of finding out
afterwards. The screen says, in as many words, *"This is a deactivation, not a
deletion"*, and points at support for anyone who genuinely wants erasure.

### The engineering that matters

- **A partial close must be impossible.** The migration is checked *before
  anything is written* and the whole request refused if absent. An account whose
  shows were cancelled but whose login still works is worse than one that was
  never closed. Settings asks the server up front and renders the section
  disabled with a reason, rather than offering a button that half-works.
- **The login ban is the LAST step.** Everything before it is a database write
  that can be retried; banning is the one action that would stop you coming back
  to a half-finished closure and trying again. If it fails, the response says so
  rather than reporting success.
- **Slot holders are told individually.** A versus show contains someone else's
  evening; cancelling it silently is the failure that would actually hurt
  somebody.

### Reactivation

**Documented, not built.** Every step is one reversible write and the un-ban is
a single admin call, so the path exists. What does not exist is a way to verify
that the person asking is the same person — and a self-service reopen without
that check is a worse feature than a support request.

## 2c — Log out everywhere

Clean, so built. Revokes every refresh token on every device. Offered as its own
control with its own explanation, because "sign out of this browser" and "sign
out of the phone I left at a friend's house" are different intentions.

### Risk and debt — one you should know about

`profiles_update_own` currently lets an account write **any column on its own
row**, including `kyc_status` and `deactivated_at`. So a determined user with a
browser console can set their own `kyc_status` to `'verified'`.

That is why nothing security-relevant is authorised by reading those from the
client — cash-out re-reads `kyc_status` server-side through the service role,
and `cashout_requests` has no INSERT policy at all. Tightening the policy to a
column allow-list needs a trigger or a split table. **It is the correct next
hardening step** and I am naming it rather than leaving it implicit.

---

# PHASE 3 · Money

## The provider situation

You left the Stripe key placeholder empty, so I built it **provider-agnostic** —
which is the shape it should have anyway.

Every route talks to one interface. No route imports a payment SDK. Swapping
providers, or running two during a migration, is a change to a single file.

**Two implementations:**

- **Stripe**, active the moment `STRIPE_SECRET_KEY` is set. Written against the
  REST API with **no SDK** — two calls and one HMAC, all stable, short and
  documented, against a dependency that would have to be added and audited
  tonight.
- **Dev**, otherwise — and this is the important bit. **It is not a mock that
  returns success.** It mints a reference, sends you to a checkout page, and
  emits a genuinely HMAC-signed event that goes through the *identical*
  verification, idempotency and ledger path. The only thing it does not do is
  take money.

That distinction is the whole value. When your Stripe keys arrive, what changes
is **which signature is checked** — not whether events are verified, not whether
replays are caught, not whether the ledger write is idempotent. All of that will
already have been exercised.

**To go live with Stripe**: set `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`,
point a Stripe webhook at `/api/wallet/webhook`, subscribe to
`checkout.session.completed`. Nothing else changes. The dev harness disables
itself automatically.

## The hard rules, and where each is actually enforced

| Rule | Enforced by |
|---|---|
| One-way economy | Cash-out uses artist-only auth. Fans cannot reach it. |
| Only KYC-verified artists cash out | `kyc_status` read **server-side through the service role**, never from the client. Plus zero INSERT policies on `cashout_requests`. |
| No card data on our servers | Hosted checkout on the provider's domain, both implementations. No column anywhere could hold a card number. |
| Integer minor units | `bigint` columns. The only decimal point in the codebase is inside a display formatter. |
| Ledger append-only | **A database trigger** that blocks UPDATE and DELETE for everyone — including the service role and including you in the SQL editor. |

That last one deserves a sentence. RLS with no UPDATE policy stops the browser.
It does **not** stop the service role, and every write worth protecting comes
from a service-role route. So the guarantee is a trigger. A mistake is corrected
by writing a compensating row — not a workaround, but what double-entry
bookkeeping has done for six hundred years, and the only version where the
history of the correction survives.

## The webhook

This is the only place a balance goes up because of money, so it is written to
be boring and paranoid.

- **Signature checked before any write that matters.** A failed event is
  *recorded* and then refused — keeping rejections is how you find out you are
  being probed, and how you diagnose a rotated secret quietly rejecting real
  traffic.
- **The raw body is hashed exactly as received.** Parsing to JSON and
  re-serialising changes whitespace and key order and the signature never
  matches again. This is the single most common way a webhook integration
  breaks.
- **Five-minute timestamp tolerance.** A signature with no freshness check is
  valid forever, which is the entire replay attack.
- **Idempotency in two layers, and they are not redundant.** One stops the same
  *event* being processed twice; the other stops the same *credit* being written
  twice. The failure mode is "we gave someone free money", and it is discovered
  by an accountant.
- **The event never decides the amount.** It names an intent; the intent —
  written server-side before you left for the provider — says what was bought.
  An event claiming ten million tokens credits what the intent says.
- **Every outcome writes a health event** under `show_id = 'finance'`, so "did
  the webhook fire and what did it decide" is one query.

## What you'll notice

`/wallet` has three purchase tiers with real prices, a working balance, and a
transaction list that now understands reactions, votes, cash-outs and refunds.
Artists get a cash-out section that explains the identity check rather than just
refusing. Purchases show up as **two rows** — the purchase and the bonus,
separate on purpose, so you can see you were given something and an accountant
can separate revenue from promotion.

The simulated checkout has an orange band across the top saying **NO MONEY WILL
MOVE**, and three test buttons: pay, replay, tampered signature. Two of them are
supposed to fail, and watching them fail is the point.

## Risk and debt — two, named plainly

- **The balance check is a check, not a lock.** Two concurrent spends could each
  read a balance of 1 and each write a debit. Exposure is bounded by the cost of
  one action per concurrent request; the append-only ledger makes any overdraft
  *visible* and correctable; the fix is a SQL function that checks and inserts
  in one statement. That is a migration and a round of testing I could not do
  properly tonight.
- **Balances are summed with a 5,000-row ceiling**, because PostgREST cannot SUM
  without a database function. Past the ceiling the number would silently start
  being wrong — the worst possible failure for a balance — so the code
  **reports** when it hits the ceiling and every caller refuses the operation
  rather than acting on a lower bound.
- **KYC itself is stubbed.** No identity provider is connected. What exists is
  the gate, the request flow, the ledger hold, and the state machine a real
  provider will drive.

---

# PHASE 4 · The PRD sweep

## 4a — Recordings check themselves

**Until tonight nothing answered "did the recording work".** A row said a file
was *supposed* to exist. Whether it landed, how long it was, and whether it
contained any picture were unknown until you clicked play on your own show.

Three failures, one check each:

1. **The file never landed** — the egress "succeeded" and the S3 upload did not.
   Caught by asking **storage** for the object, deliberately not the egress
   result's own size, which is written before the upload completes.
2. **The duration is nonsense** — under ten seconds means the recorder started
   and died.
3. **The file has no picture** — a recording of a room where nobody published
   video is a real file of real duration containing only audio. The nastiest of
   the three, because every other signal looks healthy.

**Honest limitation, and it is written into the data itself**: video presence is
*inferred* from our own publish telemetry, not by probing the MP4 (which means
downloading it inside a webhook's budget). It can be wrong in one direction —
published-but-never-subscribed reads as fine — and the stored result says
`inferred: true`. Catching that properly is the transcode worker's job.

**The webhook is attached per egress request**, not configured in the LiveKit
dashboard. Two reasons: no manual setup step, and — the one that matters — a
project-wide dashboard webhook points at *one* URL, which means a preview's
recordings would report to production or vice versa.

**And it cannot reach a protected preview.** LiveKit's POST is intercepted
before it arrives. So `/api/egress/verify` runs the **identical function** from
your own session — not a lesser fallback, literally the same code with a
different trigger, because two implementations of "is this recording good"
diverge and then you cannot tell which is right.

## 4b — Tap-to-react (PRD row 54)

Six native emoji at the bottom of the stage. One tap. **The tap goes out over
the LiveKit data channel and animates on every screen in the room within a frame
or two — nothing waits for a server.** A reaction that arrives after the moment
it was reacting to is not a reaction.

- **Your own reaction is indistinguishable from everyone else's**, deliberately.
  The feeling being built is "this room is enjoying this"; highlighting your own
  turns a shared moment into a personal receipt.
- Rate-limited on the sender, because the real failure mode is one person
  filling everybody else's screen.
- The whole layer is click-through, so a floating emoji can never eat a click
  meant for the video underneath.
- `prefers-reduced-motion` gets a fade in place. A wall of drifting emoji is
  exactly the motion that triggers vestibular symptoms.
- Events are logged with an **offset from showtime**, which is the column the
  training data is actually about: wall-clock is useless for comparing across
  shows; "42 seconds in" lines up with a shot change.

**Reactions are free**, and that is *why they are free* rather than why they are
not built. The spend path is fully wired — the endpoint accepts it, the ledger
kind exists, the column is there — and switched off behind one constant.
Charging a token for a tap someone makes reflexively, with no price anywhere on
screen, is how you make somebody feel robbed by a feature they enjoyed. Turning
it on is that constant plus showing the price.

## 4c — Comment replies and quotes: already built

I checked before writing anything. Long-press → reply/quote already existed and
already travelled over the data channel to every client. Nothing was needed.

**The honest gap**: comments are **ephemeral** — never persisted — so a thread
exists for everyone present and for nobody who arrives later. If the PRD row
means durable threaded comments, that is a comments table with the moderation
questions that come with it.

## 4d — Share cards, and a clip range that survives

Watch links now unfurl with the artist's name, the date and their photo; artist
profiles unfurl at all. Both read under RLS, which is what makes them safe — a
private recording and a viewer-role profile are invisible to the same query that
builds the card. A closed account has no card, for the same reason it has no
storefront.

**`og:image` only when there genuinely is one.** No branded fallback: every
unfurler handles a missing image gracefully and none handles a broken URL
gracefully, and `summary_large_image` with no image produces a visibly broken
card where plain `summary` would have been fine.

**The clip range is saved now.** It still does not cut the video — that needs a
job runner this stack does not have, and the page says so rather than hiding it
behind a button that appears to work. But the range used to die with the page,
which meant that when the export job eventually exists, every artist would be
asked to pick their moment again. Now the handles come back where you left them.

## 4e — B-roll live into the broadcast: SKIPPED, with reasons

Not attempted, per your instruction to skip rather than half-ship the live path.
Here, half-shipping means a black frame in somebody's broadcast.

**The blocker is not video plumbing — it is role resolution.** Publishing a clip
is achievable. Making the director console see it as a *separate cuttable
source* is not, in one night, because camera roles are encoded in the LiveKit
**participant identity** and parsed by string position in four places. A b-roll
track published by your own participant carries **your** identity — so it would
resolve as your camera, and cutting to "b-roll" would show your face.

Doing it right means moving role resolution from identity parsing to
per-publication metadata: `availableRoles`, `tracksForSlot`, `renderSlot`, the
auto-director, the cue director and the egress template. All on the live path,
all currently correct.

Three further blockers, each independently sufficient:

1. **Audio.** The broadcast publishes one processed track from the Web Audio
   graph. B-roll audio has to be mixed *into* that graph, not published
   alongside it — a second audio track doubles the room's audio and invites
   feedback.
2. **Safari.** `captureStream()` on a video element is Chrome-first with a
   prefixed, historically unreliable Safari implementation. Artists perform on
   phones.
3. **Egress.** The recording composes the same directed view, so a role
   resolution that is wrong for viewers is baked into the file permanently.

**The right sequence** is: per-publication source metadata (a refactor worth
doing on its own merits) → b-roll as a source → audio mixing. That refactor is
the next real piece of live work.

## 4f — The resume ladder

**One rule: a performer who drops mid-show is never asked to log in again.**

Most of it already existed and is worth naming so nobody builds a second
mechanism on top: your Supabase session persists in the browser, and `join-show`
**rebinds your slot by account** — it is not told which slot, it looks up who is
asking and returns what was already yours. A silent re-claim is one API call
with a credential the tab already holds.

What is new is the offer being *reachable*:

- **Reconnecting shows no button for the first six seconds.** LiveKit is already
  retrying, and a manual reconnect on top of an automatic one turns a
  two-second blip into a twenty-second one.
- After that it becomes "Still trying…" **with** a RESUME button. On a hard
  disconnect the button is there instantly.
- Resume unmounts and remounts the room rather than trying to repair a
  connection already given up on.
- Suppressed once the show has ended — a RESUME button over the ended card is a
  promise the room cannot keep.

**No credential is stored by this feature, and there must not be.** Publish
rights in localStorage would be a far worse trade than one extra API call. What
*is* stored is a marker in session storage — which show this device was
performing in — which grants nothing and answers one question the app otherwise
cannot: are you **arriving** or **coming back**? Those deserve different
sentences, and you now get "You're back on slot A — nothing was lost."

**Leaving forgets the marker**, so a performer who deliberately walked off stage
is not greeted with "you're back on" — the app arguing with something they meant
to do.

## 4g — Discover on real data

**"Coming up" is the addition that matters.** "Who is on right now" only helps
someone who happens to open the app at the right moment. A diary is what makes
this a page you come back to. The links work *before* the show starts — `/live`
shows a countdown and connects nothing until the broadcast window opens — so
they are real destinations, not dated dead links.

Cancelled shows and closed accounts are excluded from both sections. Followed
artists float to the top with a FOLLOWING chip.

**One limitation stated in the code rather than discovered later**: they float
to the top of what is *currently loaded*. Paging happens server-side, so a
followed artist on page four is not dragged forward until page four is fetched.
Ordering in the query means getting your follow list to the database — an `.in()`
filter that grows with how many people you follow, or a join RLS will not permit
from an anon client. A partial sort that admits to being partial beats a follow
step whose result is invisible.

---

# What this all rests on

## Every schema-dependent feature degrades rather than breaking

This is the rule that made an overnight build possible against a database I
could not touch, and it is now a build rule worth keeping.

Each capability **probes for its schema** and, if absent, falls back to previous
behaviour with a sentence on screen explaining why. Concretely, right now on the
preview:

- Kit Check offers one rehearsal camera and says multi-camera needs the pending
  update.
- Account closure disables itself rather than half-closing an account.
- Following disables itself and says so.
- Onboarding falls back to per-device storage.
- Reactions animate perfectly and simply are not recorded.
- Discover's queries fall back to their pre-migration form rather than
  returning nothing.

**Nothing 500s and nothing is silently wrong.** After the migrations, each one
switches itself on.

## Security posture

- 6 new tables, all with RLS enabled. **Four are deliberately zero-policy**
  (service-role only): camera pairings, webhook events, reaction events, and the
  pre-existing health events. A policy appearing on any of them is a regression.
- 12 new routes, each stating its **auth model in a header comment**.
- Both webhooks verify signatures **before any write**, confirmed live on the
  preview (400 to an unsigned POST).
- Export and closure are owner-only and read **no account identifier from the
  request**, so there is no parameter to point at someone else.
- **No new `NEXT_PUBLIC_` variable.** No secret moved client-side.
- Every migration states its **conflict targets** and whether they are plain or
  partial — the partial-unique-index trap that produced a live 400 on
  `notifications` in an earlier round.

## Where to start

1. **`docs/MORNING_MIGRATIONS.md`** — 15 minutes, paste-verify-paste-verify.
   Do not skip 06·V5, 08·V3 or 09·V3; each is a check where a silent pass means
   a real problem.
2. **`docs/OVERNIGHT2_DEVICE_TEST.md`** — one script, all phases, ordered for
   minimal resets. About 75 minutes.
3. **`docs/PRD_RECONCILIATION_2026-08-25.md`** — status per requirement, plus
   every new requirement tonight introduced, flagged **🔴 NEW**.
4. **`DECISIONS.md`** — every judgment call with its reasoning, if you want the
   argument rather than the summary.

**One thing I could not do that you should know about**: the numbered PRD
spreadsheet is not in the repository. I keyed to the four row numbers you gave
me and walked the PRD *categories* the codebase itself cites. Section B of the
reconciliation will need mapping onto real row numbers by hand — I would rather
hand you an honest partial mapping than invent numbers that look authoritative.
