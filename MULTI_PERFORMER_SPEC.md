# Multi-Performer Versus Spec (Pilot-Lite) — v1

Adds a second performer slot behind a secret-code claim, an entry gate
(email + consent) for every joiner, and a show-level "active performer"
layer that sits above the existing per-slot AI-director shot-cutting
(`lib/shotCommands.js`, unchanged by this spec). Complements
SHOW_LIFECYCLE_SPEC.md (shows table, soundcheck/live state machine) --
this spec extends that table and adds two new ones.

Locked decisions:
- `/cam` (camfeed QR-paired extra cameras) gets NO entry gate and NO
  code. `participants` captures people at the two real entry points
  (`/` join screen, and wherever a performer claims a slot); `/cam`
  captures a device, already tied to a slot by the QR link itself. If
  cheap, a `/cam` join may attribute itself to the claiming performer's
  email via the slot on its URL -- zero new UI either way; skip if not
  cheap.
- The new "spotlight" live layout (Section 6) is ADDED, not swapped in
  by deleting anything. `VersusSplit`/its 50/50 draggable-split mode
  stays in the codebase, untouched, unused by the live-show path once
  this ships. `BroadcastStage`/`ViewerStage` get routing changes only --
  their existing internals are not touched.
- `app/api/token/route.js`'s existing `?contestant=` param stays fully
  reachable and unmodified -- a client could still call it directly and
  claim a slot with no code. Accepted, not solved, for this pilot
  (same posture as the open `shows` RLS and no-secret QR links
  documented in SHOW_LIFECYCLE_SPEC.md). One `console.log` lands on
  that route (Stage 3) so any real-world use of the bypass is at least
  visible in logs. Goes on the post-pilot hardening list alongside
  secret rotation.
- **Session token rotation**: every successful `claim-slot` call --
  first claim OR a re-claim of an already-claimed code -- issues a
  brand-new random `session_token` and overwrites the row. This
  immediately invalidates whatever token was issued to a previous
  claim of that slot. Stated explicitly because it wasn't obvious:
  this only affects the privileged-action token (Section 4), never the
  LiveKit connection JWT itself, which is issued once per connection
  and unaffected by a later re-claim elsewhere.
- **LiveKit identity uniqueness**: `claim-slot` mints a fresh random
  suffix per connection -- `contestant-{slot}-{random}` -- never a
  name or a shared/predictable value. Two devices claiming the same
  code (e.g. original + reconnect-after-drop) must never end up with
  the same LiveKit identity, or LiveKit's same-identity takeover lets
  one silently kick the other offline. The `contestant-{slot}-`
  prefix is preserved unchanged so every existing consumer
  (`tracksForSlot`, `renderSlot`, the director, egress) keeps working
  with zero changes.

PRD: Live Show, Director Experience, Multi-Camera & Production (Artist
category) -- inferred from this codebase's own inline `// PRD: ... | S&I:
...` comment convention; no PRD file exists in this repo to check
against directly.
S&I: Database, Real-time media, Auth, Observability

Out of scope for tonight (explicit): fan voting, scoring, replay views,
artist thumbnail-size controls, reaction replay, any auth beyond the
codes, any change to the token route's production BEHAVIOUR (the log
line in Stage 3 is visibility, not a behaviour change).

---

## 1. Supabase: two new tables + one `shows` column

```sql
create table if not exists participants (
  id          uuid primary key default gen_random_uuid(),
  show_id     uuid not null references shows(id),
  email       text not null,
  role        text not null,          -- 'performer' | 'viewer'
  slot        text,                   -- 'a' | 'b' | null (viewer, or performer pre-code)
  consent     boolean not null default false,
  created_at  timestamptz default now()
);

alter table participants enable row level security;
-- No policies at all -- zero anon-key access, read or write. This is
-- the app's first table storing PII (email); only lib/supabaseAdmin.js
-- (service role) may touch it, via app/api/participants.
```

```sql
create table if not exists show_slots (
  show_id                  uuid not null references shows(id),
  slot                     text not null,          -- 'a' | 'b'
  code                     text not null,          -- human-friendly, e.g. "harbor42"
  claimed_by_email         text,
  claimed_at               timestamptz,
  session_token            text,
  session_token_issued_at  timestamptz,
  primary key (show_id, slot)
);

alter table show_slots enable row level security;
-- No policies at all -- zero anon-key access, read or write, of ANY
-- column. This is the one guarantee the whole secret-code mechanism
-- rests on: `code` and `session_token` must never be reachable with
-- the public anon key. Only lib/supabaseAdmin.js may touch this table.
```

```sql
alter table shows add column if not exists active_performer_slot text not null default 'a';
```

`active_performer_slot` is a new, clearly-named column rather than
repurposing the existing `shows.slot` column (schema'd in
SHOW_LIFECYCLE_SPEC.md, defaulted to `'a'`, but read by zero code paths
today) -- reusing an already-unused, ambiguously-named column for a new
meaning would be confusing for whoever reads this next, even though it
would technically work.

Pilot-honesty note: `participants`/`show_slots` are the first tables in
this codebase with RLS locked to fully deny the anon key. Every other
table (`shows`, `shot_commands`) is wide open to the anon key today
(documented gap, SHOW_LIFECYCLE_SPEC.md section 2) -- these two are
different specifically because one holds PII and the other holds
secrets a client must never be able to read or forge.

## 2. Service-role access (`lib/supabaseAdmin.js`)

First service-role usage in this codebase. Reads
`SUPABASE_SERVICE_ROLE_KEY` (server-only, guarded by the `server-only`
package so a client-bundle import fails at build time, not silently at
runtime). Every new API route in this spec (`/api/participants`,
`/api/performer/claim-slot`, `/api/show/active-performer`) uses this
client, never the existing anon `lib/supabaseClient.js`.

## 3. Entry gate (everyone)

New `'gate'` step at the front of `LiveDemo.jsx`'s existing state
machine (`'gate' → 'mode' → 'role' → 'joined'`). One email field, one
line of purpose copy ("We'll use your email to send you updates about
this show and Loudentify"), one unticked marketing-consent checkbox,
one button. Submits to `POST /api/participants { show_id, email, role,
slot, consent }` -- `role`/`slot` are `null`/`'viewer'` at this point
for anyone who hasn't claimed a performer code yet; a performer's row
gets its `slot` filled in once Section 4's claim succeeds (update, not
a second insert).

## 4. Performer secret codes + slot claim

Performers stop picking 'a'/'b' from a dropdown -- they type a code,
and the code determines the slot server-side. New route:

`POST /api/performer/claim-slot { show_id, code, email }`

1. Look up `show_slots` by `(show_id, code)` via the admin client.
2. Not found → reject.
3. Found, `claimed_by_email` is null or matches the current `email` →
   normal claim/rejoin.
4. Found, `claimed_by_email` is a *different* email → still allow
   (rejoin-after-drop case is exactly this), but the response carries a
   `warning` field the client surfaces, it does not block.
5. Mint a fresh LiveKit `AccessToken` here directly (own construction,
   not a call to `/api/token` -- keeps that route's behaviour
   untouched per the locked decision above), identity
   `contestant-{slot}-{randomSuffix}` (Section "Locked decisions" above
   for why the suffix must be fresh per connection, not derived from
   email/name).
6. Generate a new random `session_token`, overwrite
   `claimed_by_email`/`claimed_at`/`session_token`/
   `session_token_issued_at` on the row (rotation, per the locked
   decision above).
7. Update the joiner's `participants` row with the resolved `slot`.
8. Return `{ livekitToken, url, slot, sessionToken, warning? }`.

Also lands here: the one-line `console.log` on
`app/api/token/route.js`'s `?contestant=` branch (visibility for the
accepted-not-solved bypass, per the locked decision above).

## 5. Session token for privileged actions

The active-performer switch is never trusted as a bare data-channel
broadcast. `POST /api/show/active-performer { show_id, sessionToken,
targetSlot }`:

1. Look up `show_slots` where `session_token = sessionToken`.
2. Must belong to slot `'a'` for this `show_id`, else reject.
3. On success, write `shows.active_performer_slot = targetSlot`.

**This write is the actual security boundary.** The data-channel
message the client also broadcasts afterward (`{ type:
'ACTIVE_PERFORMER_SWITCH', slot }` or similar) is treated by every
receiver as nothing more than "go re-fetch `shows.active_performer_slot`
now" -- never as authoritative by itself. A forged broadcast (still
possible -- `canPublishData` is unchanged, see the codebase-wide gap
noted in today's research) never persists past the next reconciliation
read, because nothing ever writes local state directly off the raw
message. This is how "hiding the button isn't the security model" gets
satisfied without inventing message-signing crypto tonight.

## 6. Active-performer state + switch control

`shows.active_performer_slot` is the source of truth, read on join (so
late joiners land on the correct performer, not the default) via the
same shows-row fetch `LiveDemo.jsx` already does for lifecycle state,
and re-read whenever the low-latency data-channel poke arrives. New
component reusing `VideoDeckPanel.jsx`'s clickable-live-thumbnail
pattern (today scoped to camera angles within one slot), extended to
render one thumbnail per performer slot. Rendered only when `role ===
'a'` (UI gate, matching the existing `isMainPerformer` convention) --
backed by, not replaced by, the server-side token check in Section 5.

## 7. Live layout (spotlight)

New component (working name `SpotlightStage.jsx`) -- active performer
large, the other performer as a ~quarter-screen thumbnail; desktop
side-by-side, mobile stacked with a thumbnail row. Reuses the existing,
unmodified `renderSlot(letter)` from each caller exactly as
`VersusSplit` does today. `ViewerStage`/`BroadcastStage` route to this
component for live multi-performer shows; their other internals are
untouched.

## 8. Egress follows the show

`EgressPage` polls `shows.active_performer_slot` the same way (same
poll pattern already used for lifecycle state) and renders through the
same `SpotlightStage` component. Checklist against today's two bugs,
explicitly: any new CSS lands in `reactions.css` (already imported by
`EgressPage.jsx`) or another file `EgressPage` also imports, and no new
component gates orientation on `pointer: coarse`.

## 9. Director -- unchanged

`activeShot[slot]` (which camera angle) and `active_performer_slot`
(which performer is on stage) are independent axes.
`SHOT_COMMAND`/`DirectorShotPanel`/`lib/shotCommands.js` are not
touched by anything in this spec.

## 10. Build order & checkpoints

Real-device verification gate between every stage -- no building ahead
of verification.

- **Stage 1** (tonight): tables + RLS + `lib/supabaseAdmin.js`. Verify:
  anon key genuinely cannot read/write `show_slots` or `participants`
  (tested directly against Supabase's REST API, not assumed from RLS
  config alone); service-role client can.
- **Stage 2**: entry gate UI + `/api/participants`. Verify: real
  device submits, row lands correctly, checkbox defaults unticked.
- **Stage 3**: `/api/performer/claim-slot` + code-entry UI + the
  `contestant=` log line. Verify: two real devices claim different
  codes correctly; wrong code rejected; same-code rejoin-after-drop
  warns but succeeds and rotates the session token; two simultaneous
  claims of the same code never share a LiveKit identity.
- **Stage 4**: `/api/show/active-performer` + switch control. Verify:
  three real devices (A, B, viewer), A taps B, all three flip within
  ~1s; B's device shows no control; a late-joining 4th viewer lands on
  the correct current state via the shows-table read, not the default.
- **Stage 5**: `SpotlightStage` + routing. Verify on a real phone +
  desktop against the sketch; director's existing per-slot cuts still
  render correctly inside it.
- **Stage 6** (may slip to Saturday afternoon; freeze-blocking -- no
  new freeze cut, Sunday doesn't run this build, until this passes):
  egress reads `active_performer_slot` + renders `SpotlightStage`.
  Verify: real recording, a live switch actually appears in the output
  file.

**Cut line**: Stages 1-5 must be clean by Saturday noon rehearsal. If
not, Sunday runs `pilot-freeze-v2` solo, no extensions.
