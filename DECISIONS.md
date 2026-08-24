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
