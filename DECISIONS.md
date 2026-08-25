# Overnight product round — decision log

Branch: `feature/overnight-product-round`. Preview only, never merged to main, never deployed to production.

Every judgment call made without you, with a one-line reason. Newest section at the bottom.

---

## 1. Auth-first home + rebrand

- **Live show moved from `/` to `/live`.** The root had to become the auth landing, and the show needed a stable home; `/live` is the obvious name and keeps every existing deep link shape (`/cam`, `/egress`) untouched.
- **Signed-in users skip the landing.** Hitting `/` while authenticated redirects to `/dashboard` (artist) or `/discover` (viewer) rather than showing a login form to someone already logged in.
- **Viewers are gated at `/live`, not at the root.** Gating the route the show actually lives on means a shared show link prompts login and then lands you on the show, instead of dumping you on a generic home page.
- **Rebrand is a literal string swap, not a redesign.** "Neon Meridian" was a placeholder artist name doubling as the wordmark; every instance becomes "Loudentify" and nothing else about the mark changes tonight.

## 2. Signup fields

- **Date of birth, not age.** You asked for age; I collect DOB and derive age. Age is a number that silently goes stale in the database, and anything later that needs an age threshold (13+, 18+ for payouts) needs the birth date anyway. Reversible either way, but only DOB can produce a correct age tomorrow.
- **Username is unique, lowercase, `a-z 0-9 _`, 3–20 chars.** Usernames end up in URLs and mentions; letting mixed case or spaces in now creates a migration later.
- **"Stage name" is a label, not a column.** Artists see "Stage name", fans see "Username", both write to `username`. One namespace means an artist and a fan can never collide, which is what you want the day handles become public.
- **Country via ISO alpha-2 codes + `Intl.DisplayNames`.** Storing the code (not the label) keeps the data stable if display names change, and deriving labels from the browser means no 250-line hardcoded list to maintain.
- **Signup degrades gracefully before the migration runs.** The profile insert tries the full field set and, if the columns don't exist yet, retries with the original ones and logs a warning — so the preview is usable tonight and gets richer the moment you run the SQL.
- **Genres kept optional at signup.** Making a multi-select mandatory on a signup form is the classic way to lose signups; the field is there, skipping it is allowed, and Settings already edits it.

## 3. Placeholder purge

- **Deleted `ArtistProfile.jsx` outright.** `/artist` now renders the signed-in artist's *real* public page through the same component fans see, so an artist is never looking at a flattering mockup of themselves.
- **Stats removed, not zeroed.** Shows-watched, reactions-sent, follower/"signal" counts and view counts are gone rather than showing `0`. Nothing counts them yet, and a `0` claims a measurement that isn't happening — while a wall of zeros reads as a dead platform.
- **Top supporters → empty state.** Invented revenue is the fastest way to make an artist distrust every other number on the page.
- **Messages → honest empty state.** There is no threads table, no delivery, no recipients. A fake inbox is worse than an empty one because it invites a reply to someone who doesn't exist.
- **Archived VOD chat → empty.** Live comments aren't persisted anywhere, so there is genuinely nothing to replay.
- **Discover is real.** Artists come from `profiles` where `role='artist'`; live shows from `shows` in soundcheck past their slated time. Genre filter chips are built from genres real artists actually have, so the filter can never offer a genre nobody performs.
- **`select('*')` for shows.** `title`/`performance_mode` only arrive with the scheduling migration; naming them in the query would 400 the whole thing beforehand, so Discover reads defensively and works before and after.

## 4. Scheduling + broadcast window

- **Kit Check is a separate route (`/kit-check`), not a mode inside the live page.** This is what makes "zero LiveKit connection" *provable* rather than asserted — there is no `LiveKitRoom` anywhere in that component tree, so it cannot connect by accident.
- **Camera ownership is inverted where it matters.** Kit Check acquires the camera with its own `getUserMedia`, attaches it to an element it owns, flips it, stops it and releases it. No LiveKit lifecycle is involved at all. The *live* path still lets LiveKitRoom own the camera — see "what I did not do" in the summary.
- **The window opens 30 minutes before showtime** and closes 3 hours after, unless the artist ends the show. A window that never shuts is a LiveKit bill that never stops. 30 minutes reuses the existing soundcheck constant rather than inventing a second "how early can I start" number.
- **GO LIVE is disabled, not hidden, before the window.** A greyed button that says when it unlocks teaches the rule; a missing button just looks broken.
- **Reminders are generated lazily by the artist's own session, not by a job.** There is no cron in this stack. The honest consequence: a reminder appears the next time you open Loudentify after it comes due, not at the exact minute. A unique `dedupe_key` makes running the check on every page load harmless.
- **Push and email are NOT wired.** Both need infrastructure (a service worker + VAPID keys, or an email provider) that isn't trivially achievable in one night. Logged as follow-up; in-app entries are real.
- **The countdown overlay doesn't block.** 50% opacity and `pointer-events: none`, so the artist can still see and fix their framing during the final 60 seconds — which is exactly when they'd want to.
- **Kit Check releases the camera and mic before handing over to the live page.** Two owners of one device is how you get a black frame on stage.
- **More fake stats found and removed** while wiring this in: FOLLOWERS 84.2K, TOKENS EARNED 312K, SIGNAL 8,420 on the dashboard.

## 5. B-roll

- **Clips live in the existing recordings bucket under `broll/`.** No second bucket and no second access model to keep in sync — B-roll inherits the private-bucket + signed-URL posture recordings already have.
- **Owner-only, no public visibility flag.** B-roll is working material, not published content.
- **Caps are shown before the picker, not after the upload.** 100MB/clip, 500MB/artist, with a quota bar that turns orange past 80% so the ceiling is visible before it blocks anything.
- **A failed row insert deletes the uploaded object.** Storage and the table can never disagree about what exists.
- **Live playback into the broadcast is NOT built** — see the summary. Upload, manage, delete and quota are real.

## 6. Recordings grid

- **Poster frames come from the real file** — a muted `<video>` seeked ~1s in via a media fragment — so there is no separate thumbnail pipeline to build, store or invalidate.
- **Signed URLs are fetched sequentially.** A handful of recordings; firing N signing requests at once buys nothing on an already-rendered page.

## 7. Share + clip range

- **Sharing requires public, and the toggle is on the share page.** A share link to a private recording dead-ends for everyone it's sent to; making them go back to the dashboard to fix that is a trap.
- **`/watch/[id]` is a server component** so `generateMetadata` produces real preview cards. It reads under RLS, so a private recording can't leak its title through an unfurl.
- **Instagram is a copy-link button that says so.** Instagram has no web share endpoint; any "share to Instagram" button on the web is a copy-link button in costume.
- **Clip export is visibly not switched on.** The range picker is real and wired; the export needs a background job runner this stack doesn't have. A button that appears to work and silently does nothing is worse than an honest note.

## 8. Wallet

- **Balance is summed from the ledger, never stored.** A stored balance and a ledger can disagree, and when they do the artist is looking at a number nobody can reconstruct.
- **There is no insert policy on `wallet_transactions`.** Nothing client-side can credit a balance. Real money movement will write through a service-role route.
- **Purchase tiers with dollar prices removed.** A price tag that can't be paid invites a fan to try and hit nothing.

## 9. Sign-out + account reset (morning follow-up)

- **`signOut()` existed but was never called from any UI.** That is the whole reason a session was a one-way door. `AuthButton` is the missing call site, placed on `/profile` and `/artist`.
- **Sign-out redirects even if the server call fails.** A session that can't be revoked remotely — deleted user, expired token, no connection — must still let you out locally. Being stuck signed in as an account that no longer exists is exactly the trap being fixed.
- **Sign-out clears the legacy `loudentify:accountType` flag.** Sidebar and AccountSettings still read it; leaving it behind means the nav keeps insisting you're an artist after you've logged out.
- **Account deletion is a script you run, not something I execute.** Same pattern as every other migration here, and it keeps an irreversible action under your hand. It's transaction-wrapped with a `rollback` you flip to `commit`.
- **Three foreign keys had to be detached first.** `shows.artist_id`, `show_slots.claimed_by_user_id` and `cue_sheets.artist_id` reference `auth.users` *without* cascade, so a plain delete fails with a FK violation. The script nulls them first.
- **Storage files are not deleted by the SQL.** Deleting a row doesn't delete the object it points at; recordings, B-roll and avatars would be left orphaned in the bucket. Called out as an explicit step rather than left as a surprise.

## 10. Performer codes retired (post-wipe access ruling)

- **Solo needs no code, anywhere.** Logged in + owns the show + inside the window is the whole check. The code field is gone from the live path, not just bypassed.
- **Versus slot B is a single-use invite link**, bound to whoever accepts it while logged in. Re-minting an invite replaces the token, which *is* the revoke — no separate revoke endpoint to forget about.
- **The window is enforced server-side in `join-show`, not just by the button.** A disabled button is a courtesy; the API is the rule, and it's what keeps LiveKit unbillable outside a scheduled show.
- **Already-bound accounts get straight back in, with no token.** That single branch is both "the opponent refreshes after accepting" and Round D's resume-your-slot: after acceptance the invite is consumed, so every later join is recognised by *account*. Session tokens still rotate per join, now keyed to (account, scheduled show).
- **Slot rows are created on demand, not at schedule time.** `join-show` upserts slot A when the owner goes live; the invite route upserts slot B when they invite. Fewer rows that can drift out of sync with a show that gets deleted.
- **Invite lookup is readable logged-out; accepting is not.** You should be able to see who's asking and to what before deciding to make an account. It exposes only what the sender already chose to share.
- **Invalid, already-accepted and re-minted invites all return the same message.** Distinguishing them would let someone probe which tokens ever existed.
- **`claim-slot` is deprecated in place, not deleted.** Pre-ruling rows still carry codes; deleting the only path that understands them would strand a legacy show mid-flight.

### Camfeed decision (item 4)

- **Extra cameras pair as DEVICES, not people — short-lived code from the artist's dashboard.** A phone taped to a mic stand has no account and shouldn't need one. `camfeed_pairings` (in the migration) is scoped to one show + one slot with an expiry, service-role only, zero RLS policies — a pairing code that the anon key can read stops meaning anything.
- **This is deliberately a different job from the retired performer code.** That code proved *who you were*, which is exactly why it had to go. This proves only that the device was handed a code by someone who could already see the artist's dashboard — a much weaker claim, which is all a camera needs to make.
- **Table and rationale are shipped; the pairing exchange endpoint and QR panel rewiring are not.** Camfeeds still join through the existing `/api/token?camfeed=` path tonight. Flagged as the next piece rather than half-built.

## 11. Profile/dashboard consolidation + role fluidity

- **`/artist/[id]` is the one profile route; the owner sees the console there.** "Dashboard" is gone as a destination. `/dashboard`, `/profile` and `/artist` all resolve through one helper so there is exactly one answer to "where do I live", whichever link got you there.
- **Enforcement is the database, not `isOwner`.** `isOwner` decides what to *render*. What keeps private data private is RLS: `broll_clips`, `wallet_transactions` and `notifications` are select-own; `recordings` returns own-rows-or-public. A visitor's client cannot fetch the private rows at all — nothing arrives and then gets hidden.
- **`shows` is the deliberate exception.** Its RLS is open, and upcoming shows are public information in both modes anyway. Flagged rather than silently relied on.
- **`RecordingsLibrary` takes an `owner` prop but doesn't filter on it.** The query is identical in both modes; RLS decides what comes back. Filtering client-side would have implied the security lived here.
- **The header is the same component in both modes.** An artist should always be looking at the page their audience sees, not a flattering variant of it.
- **Follow is disabled with a reason, not hidden.** There's no follows table. A button that silently does nothing is worse than one that admits it isn't built.
- **The sidebar stopped reading the legacy `accountType` flag.** It pointed PROFILE at `/dashboard` or `/profile` based on localStorage; now both resolve correctly, so it just points at `/profile` and the mock dependency is gone from the nav.
- **Deleted `ArtistDashboard.jsx` and `MyArtistProfile.jsx`.** Both were fully superseded; leaving them invites someone to edit the wrong file.
- **Upgrade goes through a server route, not a client profile update.** `profiles_update_own` would technically permit a browser to flip its own `role`. Routing it through `/api/profile/become-artist` creates one place to add terms acceptance, age thresholds or verification before that matters — rather than discovering later that role is self-serve from a console.
- **Added `verifySession` alongside `verifyArtistAuth`.** The upgrade request is by definition made by someone who is *not yet* an artist, so the artist check would 403 the very request meant to make them one. Kept in the same file so nobody reaches for the wrong one.
- **Upgrade is one-way.** Downgrade raises questions this round doesn't answer — scheduled shows, public recordings, an invited opponent mid-flight — and a half-answered downgrade is worse than none.
- **The handle does not change on upgrade.** Both roles already share one username namespace, so there is nothing to claim; the stage name is the display name, which is separate and non-unique.
- **After upgrading you land on your new console**, not back on settings — landing on settings hides the thing that just changed.

## 12. Age policy — SPEC CORRECTED to 18+

- **Previously 13, now 18.** Recorded as a correction, not a preference: paid voting mechanics, UK Online Safety Act exposure and safeguarding all land on the same floor.
- **Enforced in three places, because each is bypassable alone.** The signup form; `/api/profile/become-artist` server-side; and a DB check constraint — the only one a browser cannot route around.
- **Re-checked at the upgrade, not assumed from signup.** Every point where someone *gains capability* re-asks the question.
- **A null date of birth is refused at upgrade, not waved through.** Accounts predating the field give no basis to assert 18. The safe default for an age gate is "no".
- **The DB constraint is `NOT VALID`** so legacy rows don't block the migration — with a verification query to list anyone already non-compliant, since the constraint won't have caught them.
- **Self-declaration is sufficient at this stage**, as instructed. Formal age assurance is a documented later phase, and the constraint is what it will tighten around.

## 13. Discover layout

- **List is the default; grid appears at 50+ items.** A short list reads as a *line-up* — four names stacked look deliberate. Four cards in a three-column grid read as a grid that failed to fill, which makes a young platform look abandoned.
- **Narrow viewports never flip to grid** (under 700px). A two-column grid of thumbnails is worse than a list on a phone at any count.
- **Live Now is always a list**, at any size. "Who is on right now" is a bounded set by nature and a line-up is exactly what it should look like.
- **Infinite scroll, not pagination.** Page numbers imply a catalogue you navigate; this is a feed you browse. It's also what the mobile swipe surface needs.
- **The feed lives in `lib/discoveryFeed.js`, not in the component.** Mobile swipe-discovery is the same sequence consumed one item at a time instead of scrolled, so it calls the same paged source and gets the same uniform item shape (`id, kind, title, subtitle, href, row`). A component-local fetch would have forced that surface to reimplement paging and then drift.
- **Filtering is server-side.** Filtering after the fetch makes every page a different size and eventually skips matches entirely.
- **IntersectionObserver with a 400px margin**, so fetching starts before the user hits the bottom and costs nothing while they read.

## 14. Kit Check — Add Camera: option (b), a scoped documented exception

**I assessed (a), the local preview path, and rejected it. Honestly:**

It is buildable but not reliable. Signalling is genuinely easy — Supabase Realtime is already a dependency and could carry the offer/answer. The problem is *media*. A phone-to-laptop WebRTC connection needs STUN (free) for most networks and **TURN for the rest** — symmetric NAT, mobile data, guest and venue wifi. We have no TURN server. The result would be a rehearsal feature that works reliably on a home network and fails unpredictably at a venue, which is the worst possible place for it to fail and precisely where a kit check matters most. Building a second media path to sit alongside a proven one, without relay infrastructure, in one round, is not a trade worth making.

**So: (b), bounded and loud.**

- **A rehearsal room, never the show room** — namespaced `rehearsal-{userId}`.
- **Opt-in.** Kit Check stays zero-LiveKit unless the artist presses ADD CAMERA, and the button says plainly that this part goes online.
- **Capped at 20 minutes**, enforced twice: a visible countdown, and a hard TTL on the tokens themselves so the room dies even if a client never disconnects cleanly.
- **Pairing codes are single-use and expire in 10 minutes.** Ambiguous characters removed from the alphabet — someone is typing this off a screen in bad light.
- **The paired device gets CAMERA publish only.** No microphone (it would double the room audio and feed back), no data channel (a lens has no business sending shot commands), no subscribe.
- **The badge tells the truth.** "NOT CONNECTED — NOTHING IS BEING SENT" becomes "REHEARSAL ROOM OPEN — CONNECTED" the moment it does. The value of this page is the artist knowing which state they're in; a feature that quietly broke that would poison the rest of it.
- **The file header comment was corrected.** It claimed there was no LiveKitRoom on the page; that stopped being true, so it now says so rather than reading as a false guarantee.
- **Kit Check hands the camera over before connecting** — two owners of one device produces a black tile.
- **`/cam/pair` is its own page**, not a mode bolted onto `/cam`. This device does one job, and the existing cam page carries show-time machinery irrelevant to it.

**The cost shape, stated plainly:** two or three participants for at most twenty minutes, per rehearsal. That is a rounding error against a show, and it is bounded by construction rather than by the artist remembering to close a tab.

## 15. Write-path fixes + downgrade

- **`shows.artist_name` made nullable, not dropped.** Two live readers still use it — the recordings-sync title builder and the viewer holding screen. Dropping would have traded a loud insert failure for two quiet display regressions, and a dropped column can't be walked back. The app now populates it from the profile, so those readers keep getting a real name; nullable is the safety net.
- **B-roll writes moved to service-role API routes.** The direct-from-browser version could never have worked: the recordings bucket has *no* storage policies by design (recordings are signed server-side), so the client storage write was always going to be refused. Now realigned with the recordings pattern — one writer, one place to enforce quota, and storage and the table can't disagree.
- **Quota is now enforced server-side too.** The client still checks it for a fast error, but a check that only runs in a browser is a suggestion.
- **Delete removes the object before the row.** That order can leave an orphaned *row* — visible and fixable. The reverse leaves an orphaned *file* — invisible, and it eats quota forever.
- **`camfeed_pairings.show_id` made nullable, and the route omits the key rather than sending null.** A rehearsal isn't tied to a show; an artist should be able to pair a camera before scheduling anything.
- **Real database errors now reach the user on every new write path.** A generic "Could not create a pairing code" is what turned a one-line NOT NULL violation into a test sitting. It's the caller's own failed write — nothing sensitive in showing it.

### Downgrade

- **Recordings go private, not deleted.** Nothing stays public without an active artist identity behind it — but the footage is theirs, and re-upgrading should hand it back intact.
- **Future shows cancelled, with everyone told.** A scheduled show nobody can perform is worse than no show. Slot-B holders are notified too: someone accepted an invite to a show that isn't happening, and finding that out by turning up is unacceptable.
- **`'ended'` is reused rather than adding a `'cancelled'` state.** The schema's CHECK has three states and nothing reads the distinction; inventing one would mean a migration for a difference no code consumes.
- **Wallet untouched. Stage name, B-roll and cue sheets retained.** Money is money; and re-upgrade should restore their identity as they left it, not hand them a stranger's page.
- **The role flips LAST.** If any earlier step fails, the console hasn't been taken away yet, so a retry is clean rather than leaving someone half-downgraded.
- **A failed notification doesn't block the downgrade.** They explicitly asked for it; a missed message must not trap them in a role.
- **Two-step confirm listing every consequence.** A one-click role flip that silently hides an artist's public work would be indefensible.

## 16. Go Live threading — the live path becomes show-aware

Closes the finding in `docs/WRITE_PATH_AUDIT.md` and the two failures the window-opening test surfaced live.

### What actually broke, named precisely

- **The "session lost at the countdown" was not a lost session.** `RequireAuth` had already verified it, and it was still in `localStorage` throughout. `LiveDemo` carried its *own* three-screen entry gate from the multi-performer round — watch-or-perform, then a full **"Artist sign in"** form — which never once looked at the session it was already sitting behind. An artist walking out of Kit Check on a 60-second countdown was asked to authenticate a second time, by a second login form, at the worst moment in the product.
- **A second, latent copy of the same bug lived in `RequireAuth`:** the post-login return path was built from `pathname` alone, which drops `?show=`. Anyone who *did* log in came back to a `/live` with no show in it. Fixed in the same round — the query string is part of the destination.
- **"Couldn't reach the show yet" was `registerParticipant` throwing** because the pilot-room lookup found nothing post-wipe. A mailing-list insert was a hard precondition for being in the show.

### The decisions

- **The entry gate is deleted, not hidden.** Every question it asked is now answered by something authoritative: who you are by the session, solo-or-versus by `shows.performance_mode`, which slot by `join-show`. A question whose answer is already known is friction, and this one was charging that friction at showtime.
- **The server decides performer vs. viewer, and a 403 is not an error.** The client makes no entitlement guess. `join-show` re-checks ownership, invite binding and the window; a 403 routes to the viewer token, because "not on the line-up" is the ordinary answer for the entire audience.
- **…except for the show's owner, where the same failure is shown loudly.** `show.artist_id === session.user.id` is known client-side and decides how loud a failure is. Silently seating an artist in the audience of their own show is the worst possible way for them to learn something went wrong.
- **`?show=` missing gets exactly one recovery, then a plain message.** A signed-in artist with a show whose window hasn't closed unambiguously meant that show — so it resolves *and rewrites the URL*, leaving an address bar that's correct to share. Everything else says what's missing. Nothing falls back to a room.
- **`'pilot-room'` survives nowhere as a default.** Not in `LiveDemo`, not in `/api/token` (a missing room is now a 400 — a token is the wrong way to find out the caller has a bug), not in `/cam` (a camera quietly publishing into a fallback room is worse than a link that says it's stale).
- **The show state write moved from `room_name` to the primary key.** Same row, but a lookup that can only ever match once is the right shape for the write that decides whether every viewer sees a show at all.
- **Pre-window viewers no longer connect.** Following a show link hours early gets the holding screen with the countdown and *no LiveKit connection* — the same broadcast-window rule Kit Check exists to honour, now applied to the audience side too. The one-second clock carries them in when the window opens; nobody taps anything on either side of the stage.
- **`selfName` can never fall back to an email address.** It's published to the room on every comment. The old gate typed it in by hand; deriving it from the account made an email the obvious fallback, and that would have been a live privacy leak, not a default.
- **Discover links to the show, not to `/live`.** It lists N live shows; a link with no id could only ever have taken you to one of them.
- **No migration.** `health_events.show_id` and `shot_commands.show_id` are both `text` and already carry a room name (the recorder logs `room.name` into the same column), so per-show rooms keep the live and recording timelines joinable with no schema change. Checked column-by-column against `docs/`, per the standing rule.

### Still true, and worth stating

`shows.room_name` has no uniqueness constraint at the database level. Names are minted random per show at schedule time, so collisions are a rounding error — but the recordings-sync attribution heuristic leans on room names, and that comment now says exactly this rather than claiming one-room-per-pilot.

## 17. The crash the threading round shipped — post-mortem and fixes

I shipped §16 with a bundle grep and no page load, said so in the handover, and the first device test hit a client-side exception before anything else could be tested. The caveat was accurate and it was not a substitute for loading the page. Fixed, plus the two findings behind it.

### The crash: a temporal dead zone that predates this round

`ReferenceError: Cannot access 'tP' before initialization` demangles to `endedSelfViewTrack`. `releaseLocalDevices` (LiveDemo, RoomInner) both reads it and lists it in its `useCallback` dependency array — and **a dependency array is evaluated during render**, not when the callback runs. The `useState` that defines it sat ~130 lines below. So every render of `RoomInner` touched a `const` still in its TDZ and threw.

- **It has been latent since `21e8432` (the device-release round, 23 Aug), not since §16.** What §16 changed is that people can now *reach* `RoomInner`. The old entry gate — the same one that demanded a second password — was also, accidentally, keeping everyone away from a crashing component. This is the second thing that gate was hiding.
- **Fixed by moving the declaration above its consumer,** not by removing it from the dep array. The dependency is real; the ordering was the bug.
- **The class is now swept and gated.** `npm run check:tdz` runs `no-use-before-define` across `app/`, `components/` and `lib/`. It found exactly one real hazard (this one) and four cosmetic ones, all now fixed so the check is *green* — a check that always prints nine known-safe errors is a check nobody reads. It runs via `npx`, adds no dependency and creates no `.eslintrc`, deliberately: an ESLint config in this repo would make `next build` start linting and could fail deploys on unrelated pre-existing warnings.
- **Two "safe for now" orderings fixed alongside it** — Kit Check's `addCamera`→`stopCamera` and ShotRendering's `timer`. Both were genuinely safe (neither runs during render) and both were one refactor away from being this bug again.

### Finding 2: the countdown was counting to the wrong moment

Not a timezone bug, not a wrong constant. **The trigger was keyed to the broadcast window opening (T−30min) when it wanted showtime (T−0).** A show scheduled five minutes out has an already-open window the instant Kit Check loads, so the 60 seconds started immediately and put the artist on stage roughly four minutes early.

- **The countdown is now derived from `slated_at` on every clock tick, not stored and decremented.** It can't drift, and opening Kit Check at T−20s shows twenty seconds rather than a fresh sixty.
- **The window still gates it, but only permits it.** `isWindowOpen` remains the cost rule; showtime is the trigger. The knock-on is the good kind: the artist gets the full ~29 minutes of the window in Kit Check instead of being yanked out the moment it opened.
- **A late arrival clamps to zero and hands over immediately** rather than rendering a negative number or a fresh minute.
- **The overlay copy changed with it.** "YOUR WINDOW IS OPEN" was accurate about the old trigger and would be a lie about the new one; it says "YOU'RE ON IN" now.

### Finding 3: the notifications 400 — right symptom, wrong cause

The hypothesis was "no unique constraint exists". **The constraint exists.** `docs/scheduling_migration.sql` created `notifications_dedupe_idx` on `(user_id, dedupe_key)` — but **`where dedupe_key is not null`**, i.e. partial. Postgres will not infer a partial unique index from `ON CONFLICT (cols)` unless the statement repeats the predicate, and PostgREST's `on_conflict=` parameter cannot emit one. Hence 42P10 → 400.

- **The fix is to drop the predicate, not to add an index.** A plain unique index is inferrable and changes nothing about null handling: Postgres already treats NULLs as distinct in a unique index, so multiple null-`dedupe_key` rows per user stay legal exactly as the partial index intended. `docs/notifications_conflict_target_migration.sql`, with the verification query.

### The audit-method gap, and what the re-sweep found

The original audit checked **permission** and was right about all eleven rows. It never asked whether an upsert's **conflict target is resolvable** — a different question with a different signature (400, not 403). Two method changes:

- **A "conflict target → index" column,** where naming a *partial* index is a defect, not a note.
- **Enumerate by call site, not by table.** That alone surfaced two writes the first sweep had folded into parentheticals — and one of them, `/api/profile/become-viewer`'s cancellation notices, was a live 400 behind a row previously marked OK. "Service role, therefore fine" was the wrong instinct: the service role bypasses RLS, not conflict-target inference.

Result: 13 rows, two broken (both `notifications`, both fixed by the one migration), `cue_sheets` flagged as correct-but-migration-dependent.

### Process

Protection Bypass for Automation is now wired into my verification. **"Page loaded and rendered, confirmed via bypass" is a required line in every definition of done from here** — and where a page can only be reached behind app auth, I say exactly how far the load got rather than implying more.

---

# OVERNIGHT BUILD #2 — 2026-08-25

Branch `feature/overnight-round-2`, cut from `feature/overnight-product-round`.
Nothing merges to `main`; nothing deploys to production. Every judgment call
made without being able to ask is recorded here with the reason.

## Standing constraints honoured this run

- **I did not touch the database.** Every schema change is a numbered,
  idempotent file in `docs/` (`overnight2_01_…` onward) with its verification
  queries inline, plus one runner doc (`docs/MORNING_MIGRATIONS.md`).
- **The app must render before those files are run.** Every schema-dependent
  capability is behind a server-side probe that degrades to the previous
  behaviour and says so in plain words on screen, rather than 500ing. This is
  stated per feature below.
- **One migration file per table per round.** No table is split across two
  files.

## Phase 0a — Kit Check pairs a RIG, not a camera

**The bug was in the state shape, not in the UI.** Kit Check held a single
`rehearsal` object that was simultaneously "the artist's seat in the rehearsal
room" and "the one pairing code". Two responsibilities in one variable is why
a second camera could never exist: pairing again replaced the first one.

- **Split into `rehearsal` (the artist's own session) and `pairings` (an
  array).** The rehearsal room is opened once, on the first Add, and reused by
  every camera after it.
- **Cameras are named, not numbered.** WIDE / CLOSE / SIDE, matching
  `lib/shotTypes.js`'s shot grammar. This is load-bearing rather than
  cosmetic: the live show parses a camera's role out of its LiveKit identity
  (`camfeed-{slot}-{role}-…`), so a phone paired without a role is connected,
  publishing, and **invisible to the director console** — the worst failure
  shape, because nothing looks broken.
- **Six live cameras per artist, capped server-side.** More than any artist in
  this pilot will prop, and it stops a stuck client minting codes forever.
- **Ending a rehearsal does NOT revoke pairings.** A code that stopped working
  because the artist closed the composed view would be a trap — the phones are
  still propped and still coming to the show. Removing a camera is an explicit
  act.
- **The rig survives a page reload.** Kit Check re-lists the artist's live
  pairings on mount, because an artist who reloads a tab has not changed their
  mind about where they put three phones.

**Judgment call — pairing stays `verifySession`, not `verifyArtistAuth`.**
The previous route used session-only auth and I kept it. Tightening to
artist-only is defensible, but it would newly break any account that has not
yet upgraded, and doing that silently inside a "multi-camera" change is the
wrong place for a permissions change. Flagged as a deliberate non-change.

## Phase 0a — one pairing UI, both contexts

There were two mechanisms. Kit Check printed a six-character code plus a
sentence asking the artist to type a URL from memory into another phone. The
live show printed three QR codes whose URLs were `/cam?room=…&slot=…&role=…`
— **containing no credential at all**.

- **The live show had the right shape and the wrong contents.** A picture you
  point a camera at, a link you can tap, and a code you can read down a phone
  line are three affordances for three real situations. So `PairingPanel`
  keeps all three — and all three now describe the *same single-use pairing
  code*.
- **`components/CameraQRPanel.jsx` is deleted, not deprecated.** A bare
  room+slot URL in a QR code is an invitation into a live broadcast for anyone
  who can read it off a stream. Leaving it in the tree as dead code invites it
  back.
- **Scanning pairs the phone.** The QR encodes `/cam/pair?code=…`, and that
  page redeems automatically. Asking an artist with a guitar in their hands to
  walk over and tap a button on each phone is exactly the friction the QR
  existed to remove.
- **`tone` prop, not two components.** Kit Check is porcelain; the live panel
  floats over video, where nothing may have a background fill. Same component,
  two palettes, including the QR itself rendered light-on-transparent over
  video — a white block punched into a live frame is not acceptable.

## Phase 0b — how the cameras survive the transition

**The mechanism, stated plainly: a paired phone does not know which room it is
in. It knows which pairing it is, and it asks the server where that pairing
currently lives.**

The rehearsal room (`rehearsal-{artist_id}`) and the show room
(`shows.room_name`) are different LiveKit rooms, and they have to be — a
rehearsal must never be able to collide with a broadcast. So "the phone
follows" cannot mean "the same room stays valid". It has to mean the phone
re-resolves its room.

1. At redeem the device is handed a **pairing id** and a **device secret**
   (random, never shown to a human, stored only as a SHA-256).
2. It polls `POST /api/camfeed/session` every ~4s with both, and gets back the
   room it belongs to, a token for that room, and a **generation counter**.
3. At countdown-zero Kit Check calls `POST /api/camfeed/pair {action:'migrate',
   show_id}`, which rewrites `target_room` on every one of that artist's live
   pairings and bumps `generation`.
4. The next poll returns a generation the phone has not seen. The phone
   remounts its `LiveKitRoom` — keyed on `room:generation`, so this is a clean
   unmount/mount, never a token swapped under a live connection — and it is in
   the show room. Nobody picks up a phone.

**Why a counter and not a timestamp.** The comparison has to be exact, and a
phone's clock versus the server's clock is a difference we do not control.

**Why the artist's client triggers it and not a server job.** The show room's
name is only knowable once a specific show is resolved, and the artist's own
client is the one thing that certainly knows which show it is walking into. A
scheduler would have to guess, and guessing wrong puts a camera in somebody
else's broadcast. The route re-checks show ownership server-side regardless.

**Why the code cannot be the ongoing credential.** It is six characters
because a human reads it off a screen in bad light. That is exactly why it
must die at redeem and why a separate, long, machine-only secret carries the
session.

**Judgment call — the handover has a 2.5-second ceiling.** The migrate call is
fired with a hard timeout, after which the artist is routed to the show
regardless. A camera arriving four seconds into a show is a shrug; an artist
arriving four seconds late is the show starting without them. If migrate
fails, the phones stay in the rehearsal room and can be re-paired from the
live screen — i.e. it degrades to the pre-tonight behaviour, never worse.

**Judgment call — the device secret is held in tab memory only, not
localStorage.** A phone that reloads has been picked up by a person, and a
person can scan the code again. Persisting a publish credential to disk on a
borrowed phone is a worse trade than one re-scan.

**Pre-migration behaviour.** `pairingCapabilities()` probes once per server
process for the columns `overnight2_01` adds. Without them: one rehearsal
camera, no role, no follow — exactly today's behaviour — and Kit Check prints
a sentence saying multi-camera switches on when the migration is applied.
Nothing 500s and nothing is silently wrong.

## Phase 0c — the leave crash

**Root cause: a hooks-order violation, not a LiveKit or routing problem.**
`RoomInner` had `if (left) return …` at line ~2790 and three hooks below it
(`useMemo`, `useRef`, `useEffect`). While `left` was false all hooks ran; the
instant Leave set it true the component returned three hooks short and React
threw *"Rendered fewer hooks than expected"*. With no error boundary above it,
that paints white.

- **The guard was correct in isolation and the hooks were correct in
  isolation.** What was wrong was a conditional return sitting above hooks in
  a 2,300-line component, where that relationship is invisible from either
  end.
- **The sibling early return for `isCamFeed` has the identical defect and has
  never crashed** — purely because `isCamFeed` is constant for the
  component's whole life, so the branch is chosen once at mount. Noted rather
  than "fixed": changing it would be churn, and the real fix is that the
  crashing one no longer exists.
- **The fix is not to move the return below the hooks.** A component rendering
  "you left" from *inside* `<LiveKitRoom>` is still in the room. The state
  moved up one level, to the component that owns `<LiveKitRoom>`, where
  flipping it unmounts the room.
- **Leave now routes.** Artists to `/artist/{id}` (their console — recordings,
  next show, numbers), viewers to `/discover`. Destination is computed from
  the profile role *before* the click, so pressing Leave never pauses to look
  up who you are. Unknown role falls back to Discover, which works for every
  account and is never a dead end.
- **600ms, then navigate.** A beat after `room.disconnect()` so the route
  change does not race LiveKit's teardown, and so the person who pressed Leave
  gets a moment of confirmation rather than a screen swap that reads as a
  glitch. A real link is rendered underneath in case that navigation is slow
  or blocked.

## Phase 1 — onboarding, both roles

**The shape of the screen is an argument about what onboarding is for.**
It is not a form to be completed before the product unlocks — the product is
already unlocked. It is the shortest path from "I just made an account" to
"I have done the one thing that makes this place work for me": for an artist,
a date in the diary; for a fan, a reason for Discover to show them anything.

- **Three rules, enforced structurally rather than by good intentions.**
  Skippable (every step has a real button with a plain word on it, the same
  size as the primary action, not a grey link in a corner). Resumable
  (progress saved per step; coming back lands on the first step that is
  neither done nor skipped). Never blocking (LEAVE is in the top right of
  every step, and the walkthrough renders *inside* PageShell with the sidebar
  live — the point made structurally, not just in copy).
- **A skipped step is an answer, not a gap.** The resume nudge only appears
  when there is a step the person has neither done nor deliberately passed on.
  Asking again after someone has said no is nagging.
- **Hand-off steps mark themselves complete before navigating.** An artist who
  goes off to schedule a show has done that step; making them come back and
  press "done" is asking them to file a report on themselves.
- **Signup routes to `/welcome`; login does not.** Routing every login through
  onboarding until it is "complete" turns a skippable helper into a gate that
  reappears every session. Returning accounts get the dismissible bar instead.
  A `?next=` still wins — someone who followed a show link and signed up to
  watch it lands on the show.
- **The nudge is never rendered on a live surface.** Gated in PageShell on
  `!liveOverlay` rather than inside the component, so no live surface can
  accidentally opt back in. A setup reminder over someone's performance is
  indefensible.
- **Dismiss lasts the browser session.** Not forever (they may have meant "not
  now") and not one page load (that would make it a nag).

**Judgment call — onboarding state is one jsonb blob, not a column per step.**
Onboarding steps are product, and product changes weekly. Adding a step should
not be a migration, and reordering steps must never be able to reinterpret
existing progress — so the blob stores step KEYS, and an unknown key is
ignored.

**Judgment call — a localStorage fallback, which is normally the wrong
answer.** `profiles.onboarding` arrives with a migration I cannot run. Rather
than break a brand-new account's first minute in the product, a failed write
falls back to localStorage keyed by user id, and upgrades itself silently the
first time the real column accepts a write. This is defensible *here and
nowhere else*: onboarding progress is the lowest-stakes data in the product,
and the worst case of losing it is being offered a setup step twice.

## Phase 1 — the FOLLOW button became real

Viewer onboarding's second step is "follow a few artists", which cannot be a
real step against a button that has always honestly admitted it does nothing.
So `follows` exists now (`docs/overnight2_03_follows.sql`), and
`ProfileSurface`'s button is wired to it.

- **Composite primary key `(follower_id, artist_id)`, no surrogate id.** The
  natural key *is* the fact. One person cannot follow one artist twice, and
  expressing that as the key means the database enforces it rather than the
  app remembering to.
- **No UPDATE policy.** A follow is created or deleted; an UPDATE policy could
  only ever be a way to rewrite who followed whom.
- **The follow graph is private, and no surface claims a follower count.**
  RLS lets a fan read their own follows and an artist read their own
  followers. Nobody can enumerate a third party's. A consequence worth naming
  rather than discovering later: a client-side `count` under these policies
  returns the caller's own row, so it would render "1 follower" for everyone.
  A public count needs a security-definer function or a maintained counter
  column — neither is built, and nothing displays a number it cannot support.
- **Suggestions are genre-matched then newest-first, deliberately NOT ranked
  by popularity.** At this platform's size a popularity ranking is a handful of
  accounts shown to everyone forever, which is how a new artist never gets a
  first listener.
- **The button still admits when it cannot work.** If the migration has not
  been run, it disables itself and says so, exactly as the old placeholder did.
  That habit was right and is kept.

## Phase 2a — request my data

- **Owner-only with no parameter to abuse.** The route reads no account
  identifier from the request at all — `verifySession` resolves the Bearer
  token to a user and every query is filtered by that id. There is nothing an
  attacker could point at somebody else's account because there is nothing to
  point.
- **Rate limited in the database, not in memory.** Three per rolling 24 hours,
  counted from `account_requests` rows. Serverless functions do not share
  memory, so an in-process counter is a limit that resets whenever the
  platform reschedules. A pre-migration in-process fallback exists and is
  labelled as the weaker thing it is.
- **The window is rolling, and the refusal names a time.** "You can request it
  again after 14:32" is a real answer; "try again tomorrow" invites a midnight
  retry loop.
- **No file bytes.** Recordings and B-roll are listed with metadata and
  storage paths. A JSON document with a 400MB video base64'd into it is not an
  export, it is a denial of service against the person who asked for it.
- **A section that cannot be read says so, in the export.** An export with a
  silent hole in it is worse than one that reports "this part was unavailable,
  here is why". The file opens with a manifest listing what is included AND an
  `excluded` block naming what is not and the reason.
- **`health_events` is excluded on purpose and said so out loud.** It is keyed
  by LiveKit participant identity, not account id, so filtering it to one
  person is not reliably possible — and a best-effort filter of a diagnostics
  table risks handing someone else's session to the wrong person.
- **`Cache-Control: no-store, private`.** This response is a person's entire
  account; it must never sit in a shared cache or a browser's disk cache.
- **Downloaded from a blob, not a link.** The request needs an Authorization
  header and `<a download>` cannot send one.

## Phase 2b — close my account

**A deactivation that preserves the customer record, and the UI says so.**
"Close my account" means something different on every platform, and the only
way a person makes an informed decision is to be told what happens *before*
they decide — including the parts they may not like. Stating it plainly costs
a few people who wanted a hard delete and saves every one of them finding out
afterwards.

What happens: login disabled (a reversible Supabase ban, not a deletion),
profile hidden everywhere public, recordings made private, upcoming shows
cancelled with a notification to every slot holder, wallet ledger retained in
full, stage name retained against the record.

- **The ledger is never deleted, and the copy defends it rather than burying
  it.** Money that moved, moved. A financial record you can delete is not a
  financial record — and it is the part the person is most likely to need
  again.
- **The name is held, and the reason is stated.** Not possessiveness:
  releasing a closed artist's name lets someone else claim it and be mistaken
  for them, in a product where the name IS the identity.
- **The migration is checked BEFORE anything is written, and the whole request
  refused if it is missing.** A partial close — shows cancelled, login still
  working — is the one outcome that must not be reachable. The Settings
  section asks the server up front and renders itself disabled with a sentence
  saying why, rather than offering a button that half-works.
- **The ban is the LAST step.** Everything before it is a database write this
  route could retry; banning is the one action that would stop the person
  coming back to a half-finished closure and trying again. If it fails, the
  response says so explicitly rather than reporting success.
- **Slot holders are notified individually, per cancelled show.** A versus
  show has someone else's evening in it; cancelling it silently is the failure
  that would actually hurt somebody. The notification upsert names its
  conflict target `(user_id, dedupe_key)` — the plain, non-partial index —
  because a partial index in exactly this position produced a live 400 in an
  earlier round.
- **Ownership is re-checked on every write even though the route runs as
  service role.** "The client could have done this anyway" is not a reason for
  a server route to skip the check.
- **Closed profiles return a named "has closed their account" screen, not a
  404.** Someone following an old link deserves to know the account is gone
  rather than be told the link was wrong, which would invite them to assume
  they mistyped and try again.

**Judgment call — reactivation is documented, not built.** Every step is a
single reversible write and the un-ban is one admin call, so the path exists.
What does not exist is a way to verify that the person asking is the same
person — and a self-service reopen with no such check is a worse feature than
a support request. Named in the morning brief.

**Known limitation, stated rather than discovered later.** `profiles_update_own`
lets an account write any column on its own row, including `deactivated_at`
and `kyc_status`. That is why nothing security-relevant is authorised by
reading those from the client — cash-out re-reads `kyc_status` server-side
through the service role. Tightening the policy to a column allow-list needs a
trigger or a split table; it is the correct next hardening step and is named
in the brief rather than left implicit.

## Phase 2c — log out everywhere

**Clean, so built rather than documented.** `supabase.auth.signOut({ scope:
'global' })` revokes every refresh token the account holds, on every device.
Offered as its own control with its own explanation rather than folded into
the ordinary log-out, because "sign out of this browser" and "sign out of the
phone I left at a friend's house" are different intentions and only one of
them is destructive to the person's other sessions.

Account closure calls it too — the account is banned server-side, but the
access token in the closing tab stays valid until it expires, and leaving
someone sitting in a live session for an account they just closed is a
confusing few minutes.

## Phase 3 — the token economy

**No Stripe keys were supplied, so the provider is behind an interface —
which is the shape this should have had anyway.** Every route in
`app/api/wallet/*` talks to `getPaymentProvider()` and knows nothing about
Stripe. Swapping providers, or running two during a migration, is a change to
one file.

Two implementations, one interface:

- **Stripe**, active the moment `STRIPE_SECRET_KEY` is set. Written against the
  REST API with **no SDK** — two calls and one HMAC, all stable and short,
  against a dependency that would have to be added tonight and audited. If
  Stripe's API were complicated here this would be the wrong call; it is not.
- **Dev**, otherwise. **Not a mock that returns success** — it mints a
  reference, sends the person to a checkout page, and emits a genuinely
  HMAC-signed event that goes through the *identical* verification,
  idempotency and ledger path. The only thing it does not do is take money.
  That distinction is the whole value: when real keys arrive, what changes is
  which signature is checked — not whether events are verified, not whether
  replays are caught, not whether the ledger write is idempotent.

**Judgment call — the dev signing secret is derived, not configured.** When
`PAYMENTS_WEBHOOK_SECRET` is unset it is derived from the service-role key by
HMAC under a fixed label — the same construction as HKDF's expand step, so the
output leaks nothing about the input. It means the harness works with zero new
configuration. It is used for the DEV PROVIDER ONLY; the Stripe path derives
nothing and refuses to verify without a real `STRIPE_WEBHOOK_SECRET`.

### The hard rules, and where each one is actually enforced

- **One-way economy.** Cash-out uses `verifyArtistAuth`, not
  `verifySession` — fans buy and spend, they never cash out. That is the
  difference between a token and a currency.
- **KYC-gated cash-out.** `profiles.kyc_status` is read **server-side through
  the service role** and is never taken from the request. This matters more
  than usual: `profiles_update_own` currently lets an account write any column
  on its own row, `kyc_status` included, so the client value is untrusted *by
  construction* and the server read is what makes the gate real. There is also
  no INSERT policy on `cashout_requests` — a client that could insert could
  insert `kyc_status_at_request: 'verified'` and skip the gate entirely.
- **No card data.** Hosted checkout on the provider's domain, both
  implementations. No route accepts, forwards, logs or stores a card number,
  and there is no column anywhere that could hold one.
- **Integer minor units everywhere.** Pence, never a float, never a decimal
  string. The only decimal point in the codebase is inside a formatter whose
  output is for eyes and never for arithmetic.
- **Append-only ledger, enforced by the database.** A trigger blocks UPDATE and
  DELETE for everyone including the service role. RLS having no UPDATE policy
  only stops the browser, and every write worth protecting comes from a
  service-role route. A mistake is corrected with a compensating row — not a
  workaround, but what double-entry bookkeeping has done for six centuries, and
  the only version where the history of the correction survives.

### The webhook

- **Signature verified before any write that matters.** A failed event is
  recorded and then refused — keeping rejections is how you find out you are
  being probed, and how you diagnose a rotated secret silently rejecting real
  traffic.
- **The raw body is read as TEXT and hashed as-is.** `JSON.parse` then
  `JSON.stringify` changes whitespace and key order and the signature never
  matches again. This is the single most common way a webhook integration is
  broken, so the reason sits next to the code that depends on it.
- **Timestamp tolerance of five minutes.** A signature with no freshness check
  is valid forever, which is the entire replay attack.
- **Idempotency in two layers, and they are not redundant.**
  `webhook_events (provider, event_id)` stops the same EVENT being processed
  twice; `wallet_transactions.idempotency_key` stops the same CREDIT being
  written twice if anything else contrives to call the credit path. The failure
  mode is "we gave someone free money", and it is discovered by an accountant.
- **The insert IS the lock.** Two concurrent redeliveries race to insert the
  same event id; the unique index lets one win and the loser sees zero rows and
  stops. Insert-and-check, not select-then-insert, which has a window.
- **The event never decides the amount.** It names an intent; the intent says
  what was bought, decided server-side before the person ever left for the
  provider. An event claiming ten million tokens credits what the intent says.
  A genuine mismatch is refused with a 409 and logged, not reconciled.
- **Status codes are chosen for what they make the provider do.** 400 on a bad
  signature (do not redeliver — it will never start matching). 200 on a
  duplicate (it IS handled; a non-2xx would redeliver forever). 500 only where
  a redelivery could genuinely succeed.
- **Every outcome writes a `health_events` row** under `show_id = 'finance'`,
  so "did the webhook fire and what did it decide" is one query rather than a
  log search.

### Spending

- **The client names an ACTION, never an amount.** A client that could send an
  amount could send a negative one, which in a signed-integer ledger is a
  credit.
- **Votes are wired even though the feature is not built.** The ledger, the
  balance check and the idempotency shape are the same for every spend, and
  building them once against two callers is how the second arrives without a
  second implementation of "can this person afford it".

**Known debt, named rather than left to be found in a reconciliation:**

- **The balance check is a check, not a lock.** Two concurrent spends could
  each read a balance of 1 and each write a debit. The exposure is bounded by
  the cost of one action per concurrent request, the append-only ledger makes
  any overdraft *visible* and correctable, and the fix is a SQL function that
  checks and inserts in one statement — a migration and a round of testing this
  build could not do properly tonight.
- **Balance is summed client-of-the-database-side, with a 5,000-row ceiling.**
  PostgREST cannot SUM without a database function. Past the ceiling the number
  would silently start being wrong, which is the worst possible failure for a
  balance — so `readBalance` REPORTS when it hits it and every caller refuses
  the operation rather than acting on a lower bound.

### The dev harness

Gated three independent ways, because a route that can mint signed payment
events must not be one forgotten flag from being live: `VERCEL_ENV !==
'production'` (the platform's own marker, not a flag we set), the dev provider
being the active one (the moment a Stripe key exists it has no signing key and
refuses), and a session that owns the intent being settled.

It calls the webhook handler **directly rather than over HTTP** — a
server-to-server fetch from a protected preview to itself is intercepted by
deployment protection and never arrives. Direct invocation is also more honest:
it is unambiguously the same code, not a similar request.

Three buttons, and two of them are failures: pay (expect a credit), replay the
same event id (expect `duplicate`, no second credit), tampered signature
(expect rejection, no ledger row), plus a valid-signature/wrong-amount case to
prove the amount check refuses a mismatch rather than trusting the event.

## Phase 4a — did the recording actually work?

Until tonight nothing answered that. A `recordings` row said a file was
SUPPOSED to exist; whether it landed, how long it was and whether it
contained any picture were unknown until an artist clicked play on their own
show and found out the hard way.

Three specific failures, one check each:

- **The file never landed.** The egress "succeeded" and the S3 upload did not.
  Caught by asking STORAGE for the object — deliberately not the egress
  result's own `size`, which is written when the recorder finishes muxing,
  before the upload completes, so a failed upload reports a healthy size for a
  file that does not exist.
- **The duration is nonsense.** Under ten seconds means the recorder started
  and died.
- **The file has no picture.** A room-composite egress of a room where nobody
  published video produces a real file of real duration containing nothing but
  audio. The nastiest of the three, because every other signal looks healthy.

**Judgment call — video presence is INFERRED from our own telemetry, and
labelled as inferred.** `health_events` already records every track publish, so
the question becomes "did anyone publish video in this show". Probing the MP4
itself means downloading and parsing it inside a webhook's budget. The proxy
can be wrong in one specific direction — video published but never subscribed
by the recorder would read as `has_video` true against a file with no picture —
and that is written into the stored result rather than left as a footnote.
Catching it properly is the transcode worker's job.

- **`verified_at` set with a failing check is the system WORKING.** The
  checks record what is true; a suspect recording is a successful verification,
  not an error, which is why the webhook returns 200 for one.
- **The webhook is attached PER EGRESS REQUEST, not configured in the LiveKit
  dashboard.** A project-wide dashboard webhook points at one URL, which means
  a preview deployment's recordings would be reported to production or vice
  versa. Carrying the URL on the request keeps each deployment's results with
  that deployment — and removes a manual setup step.
- **`app/api/egress/verify` runs the IDENTICAL function**, not a similar one.
  Two implementations of "is this recording good" diverge, and then a recording
  is verified by one path and suspect by the other with no way to tell which is
  right. It exists because LiveKit cannot POST to a deployment-protected
  preview — the automatic path is unreachable there, and this is the same
  check with a different trigger.
- **Status codes are chosen for what they make LiveKit do:** 400 on a bad
  signature (never redeliver), 200 on a suspect result (handled — the answer
  will not change), 500 only when the check itself could not complete.

## Phase 4b — tap-to-react (PRD row 54)

**The shape of the feature is the point: the tap goes out over the data
channel and animates on every screen in the room within a frame or two.
Nothing waits for a server.** A reaction that arrives after the moment it was
reacting to is not a reaction. The database write is batched, fire-and-forget,
and never a dependency.

- **Native emoji, six of them, no picker.** A reaction is a reflex; anything
  that turns it into a decision has already lost. Native emoji also render
  everywhere, need no assets and no loading state.
- **Your own reaction is indistinguishable from everyone else's.** The feeling
  being built is "this room is enjoying this" — highlighting your own would
  turn a shared moment into a personal receipt.
- **Local-first on send.** Data messages are not echoed to their sender, so
  appending locally is the ONLY way the person who tapped sees their own
  reaction. Same asymmetry that once left the artist who ended a show as the
  one client that never saw `SHOW_ENDED`.
- **Rate-limited on the sender at 150ms.** The real failure mode of a reaction
  feature is one person filling everybody else's screen.
- **`pointer-events: none` on the whole layer.** A floating emoji must never
  eat a click meant for the video underneath it.
- **`prefers-reduced-motion` gets a fade in place.** A wall of drifting emoji
  is exactly the motion that triggers vestibular symptoms, and a reaction that
  fades in place still says everything it needs to.
- **`offset_ms` from showtime is the column the training data is about.**
  Wall-clock is unusable for comparing across shows; "42 seconds in" lines up
  with a shot change.

**Judgment call — reactions are FREE tonight, and that is why they are free
rather than why they are not built.** The spend path is fully wired
(`/api/wallet/spend` accepts `action: 'reaction'`, the ledger kind exists,
`reaction_events.tokens_spent` is the column). It is switched off behind one
constant because charging a token for a tap a person makes reflexively, with
no price anywhere on screen, is how you make somebody feel robbed by a feature
they enjoyed. Turning it on is that constant plus showing the price on the bar
— a design decision, not a feature.

**`reaction_events` accepts UNATTRIBUTED writes, deliberately.** Requiring a
valid session would bias the training data toward whoever happened to have a
live token in the tab, dropping exactly the reactions from people whose
session quietly expired mid-show. The table grants nothing and reveals nothing
(RLS on, zero policies); the worst a forged batch achieves is polluting a
training set, which is what the per-request cap is for.

## Phase 4c — comment replies and quotes: ALREADY BUILT

Checked before building anything. `components/CommentsPanel.jsx` already has
long-press → reply/quote, and `LiveDemo`'s `sendComment` already carries
`replyMode` / `replyAuthor` / `quoteText` over the data channel to every
client. PRD rows 24/25/56/57 are satisfied by code that predates tonight.

Left alone, on purpose. The honest note for the reconciliation is what it does
NOT do: comments are ephemeral — data-channel only, never persisted — so a
thread exists for everyone present and for nobody who arrives later. Making
replies durable is a comments TABLE, which is a real feature with real
moderation questions attached, not an extension of this one.

## Phase 4d — share cards, and a clip range that survives

- **Share cards now carry the artist.** `/watch/[id]` gained a byline, a
  recorded-on date and the artist's photo; `/artist/[id]` gained a card at all.
  Both read with the ANON key under RLS, which is what makes them safe — a
  private recording and a viewer-role profile are invisible to the same query
  that builds the card, so neither can leak a name through an unfurl.
- **A closed account has no share card**, for the same reason it has no
  storefront.
- **`og:image` only when there genuinely is one.** No branded fallback: every
  unfurler handles a missing image gracefully and none handles a broken URL
  gracefully. `twitter:card` is downgraded to `summary` in that case, because
  declaring `summary_large_image` with no image produces a visibly broken card
  where plain `summary` would have produced a fine one.
- **The clip range is SAVED now.** Cutting the video still needs a job runner
  this stack does not have — that is stated on the page rather than hidden
  behind a button that appears to work — but the artist's choice used to die
  with the page, which meant that when the export job eventually exists, every
  artist would be asked to pick their moment again. A saved range also
  reloads: the handles come back where they were left, clamped to the real
  duration.
- **Milliseconds are rounded before the write.** The CHECK constraint would
  reject `42000.5`, and an artist should not get a database error for moving a
  slider.

## Phase 4e — B-roll live into the broadcast: SKIPPED, with reasons

Not attempted. The instruction was to skip rather than half-ship the live
path, and this is a case where half-shipping means a black frame in somebody's
broadcast.

**The blocking problem is not the video plumbing — it is role resolution.**
Publishing a clip is achievable (`captureStream()` off a hidden `<video>` →
`publishTrack`). What is not achievable in one night is making the director
console SEE it as a separate cuttable source. Camera roles are encoded in the
LiveKit **participant identity** (`camfeed-{slot}-{role}-…`) and parsed by
string position in at least four places. A b-roll track published by the
artist's OWN participant has the artist's identity, so it would resolve as the
artist's camera — the director would cut to "b-roll" and get the artist's face.

Making it work properly means moving role resolution from identity parsing to
per-publication metadata, which touches `availableRoles`, `tracksForSlot`,
`renderSlot`, the auto-director, the cue director and the egress template — all
of them on the live path, all of them currently correct.

Three further risks, each independently sufficient to stop tonight:

1. **Audio.** The broadcast publishes ONE processed audio track from the Web
   Audio graph. B-roll audio has to be mixed into that graph, not published
   alongside it — a second audio track would double the room's audio and
   invite feedback. That is an audio-engineering change to a chain that was
   only just stabilised.
2. **Safari.** `captureStream()` on a video element is a Chrome-first API with
   a prefixed, historically unreliable Safari implementation. Artists perform
   on phones.
3. **Egress.** The recording composes the same directed view, so a role
   resolution that is wrong for viewers is baked into the file permanently.

The right sequence is: per-publication source metadata first (a refactor worth
doing on its own merits), then b-roll as a source, then audio mixing. Named in
the morning brief as the next real piece of live work.

## Phase 4f — the resume ladder (Round D)

**One rule: a performer who drops mid-show is never asked to log in again.**

- **Almost all of it already existed and is worth naming so nobody builds a
  second mechanism on top.** The Supabase session persists in the browser, and
  `join-show` rebinds the slot BY ACCOUNT — it is not told which slot, it looks
  up who is asking and returns what was already theirs. A silent re-claim is
  therefore one API call with a credential the tab already holds.
- **No credential is stored by this feature, and there must not be.** A
  performer's publish rights in localStorage would be a far worse trade than
  one extra API call. What IS stored is a marker in sessionStorage — which show
  this device was performing in — which grants nothing and answers one
  question the app otherwise cannot: is this person ARRIVING or COMING BACK?
  Those deserve different sentences.
- **sessionStorage, not localStorage.** A performer who closes the tab has left
  the show; a resume offer surfacing next week is noise.
- **Reconnecting offers nothing for the first six seconds.** LiveKit is already
  retrying; a manual reconnect on top of an automatic one turns a two-second
  blip into a twenty-second one. The manual offer appears when the automatic
  path has been going long enough to suggest it will not finish, and instantly
  on a hard disconnect.
- **Resume unmounts and remounts the room** rather than trying to repair a
  connection that has already been given up on.
- **Suppressed once the show has ended.** A RESUME button over the ended card
  is a promise the room cannot keep.
- **Leaving forgets the marker.** Otherwise a performer who deliberately walked
  off stage and reopened the tab is greeted with "you're back on", which is the
  app arguing with something they meant to do.

## Phase 4g — Discover on real data

- **"Coming up" is the addition that matters.** "Who is on right now" only
  helps someone who happens to open the app at the right moment; a diary is
  what makes this a page you come back to. The links work before the show
  starts — `/live` shows a holding screen with a countdown and connects
  nothing until the broadcast window opens — so these are real destinations,
  not dated dead links.
- **Cancelled shows and closed accounts are excluded** from both sections.
- **Followed artists float to the top of what is CURRENTLY LOADED, and the
  limitation is stated in the code rather than discovered.** Paging happens
  server-side, so a followed artist on page four is not dragged forward until
  page four is fetched. Ordering in the query means getting the follow list to
  the database — an `.in()` filter that grows with how many people you follow,
  or a join RLS on `follows` will not permit from an anon client. Both are the
  right fix later; a partial sort that admits to being partial beats a follow
  step whose result is invisible.
- **Every shows query uses `select('*')`.** `title`, `performance_mode` and
  `cancelled_at` each arrive with a different hand-run migration, and naming a
  column before it exists 400s the whole query rather than returning null for
  it — which would empty Discover on an unmigrated database.
