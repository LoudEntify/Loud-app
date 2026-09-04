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

---

# B-ROLL LIVE PLAYBACK — 2026-08-25

The deliberately-skipped Phase 4e, built. Branch `feature/overnight-round-2`.
The earlier reasoning stands and this round did what those notes said was the
correct sequence: fix source discrimination at the root first, then build the
playback path on top of it.

## 1 · Source discrimination — the actual blocker

**The problem restated precisely.** "What kind of shot is this track" was
answered by parsing the LiveKit PARTICIPANT IDENTITY — `camfeed-a-wide-3f9c`,
split on hyphens, take the third piece — in **six** places across three files.
That is correct exactly as long as one participant publishes one track. A
b-roll clip is published by the artist's own participant, so every one of those
parsers would look at a clip, read `contestant-a-…`, and answer "the
performer's camera". The director taps B-ROLL and gets a face; the recorder
bakes it in.

**The fix: the discriminator moved down a level, from the participant to the
publication.** A track published with the name `broll` is a clip. Identity
still answers *whose is it and which slot* — which is genuinely what identity
is for. It no longer answers *what is it*.

`lib/trackSources.js` is now the only module that answers that question, and
it states its rule at the top so any parser can be checked against it:

> No function may ever resolve a b-roll track to a camera role, and no camera
> role may ever resolve to a b-roll track.

**Both directions matter.** The first stops a cut to b-roll landing on a face.
The second stops a cut to WIDE landing on a clip — the same bug arrived at
backwards, and the one that would have been found later and blamed on
something else.

### All six parse sites, converted

| # | Site | Was | Now |
|---|---|---|---|
| 1 | `LiveDemo.tracksForSlot` | identity prefix | `belongsToSlot` — b-roll stays IN the pool, on purpose: ShotVideo needs a layer to cut to |
| 2 | `LiveDemo.presentSlots` | `startsWith('contestant-')` | `isPerformerCameraTrack` — a clip must never make an empty stage read as occupied |
| 3 | `LiveDemo.availableRoles` | `id.split('-')[2]` | `roleOfTrack` — this is what surfaces `broll` to the console |
| 4 | `LiveDemo.setActiveForSlot` | identity prefix | resolves the picked track, then `roleOfTrack` |
| 5 | `LiveDemo.renderSlot` + `EgressPage.renderSlot` | `identity === targetIdentity` | `matchesTarget` — **the line where the bug would actually have happened** |
| 6 | `LiveDemo` blur-fill | identity match | `matchesTarget` — otherwise the desktop background sits on the camera while the stage shows a clip |

Plus `resolveTargetIdentity` in `lib/shotCommands.js`, and
`components/RehearsalRoom.jsx`'s local `roleOf` — a fifth copy that was correct
in isolation and is exactly the kind of thing that made one change break four
places at once. It now uses the shared resolver even though a rehearsal room
has no b-roll to discriminate.

**Judgment call — `targetIdentity` was not enough, so commands carry
`targetSourceKey`.** Identity plus what the track is (`…#broll` / `…#camera`).
Backward compatible by construction: a command without one matches on identity
alone, exactly as before, so a mid-deploy mix of old and new clients keeps
working rather than mis-resolving.

**Judgment call — ScreenShare, not a second Camera source.**
`<LiveKitRoom video>` drives `setCameraEnabled()`, which owns the Camera source
and **re-asserts itself on every SignalConnected** — there are already two
fixes in this file (1b, 1d) that exist because of that re-assertion. A second
Camera-source track invites the SDK's camera management to mute, replace or
stop the clip on any reconnect. ScreenShare is a source that path never
touches. The cost is one line per surface, and that cost is a feature: a
surface sees b-roll only if someone decided it should. `CamPage` (a phone
looking at itself) and `RehearsalRoom` are correctly left on Camera alone.

**Judgment call — `bRollClip` is a NEW shot, not `bRoll` taught to prefer a
clip.** The instruction said "the B-Roll shot cuts to it", and overloading the
existing one was the obvious reading. It is wrong for two concrete, checkable
reasons: `bRoll` is in **staccato's pool**, so the sequencer would hard-cut
into a playing clip every 500ms; and it is `NEAREST_SHOT_FOR_ROLE.side`, so
picking the side camera from the feed strip would resolve to the clip. Both are
silent, both only appear mid-show, and both would be diagnosed as "b-roll is
broken". Two shots, one family, sitting next to each other in the Static group.

**`strictSource`.** `resolveSourceRole` falls back to `availableRoles[0]` when
a shot's declared source isn't live — which for `bRollClip` is the artist's own
camera. Tapping B-ROLL CLIP with nothing cued would have cut to the performer's
face under a command that said "clip": the original bug, reintroduced from the
other end. `strictSource` makes the shot refuse to resolve instead. Every
caller already treats a null `sourceRole` as "skip the cut", so refusing is a
supported answer rather than an edge case.

## 2 · Playback path, and what happens when the clip ends

Artist taps a clip → signed URL (owner-checked server-side, unchanged route) →
hidden muted `<video>` → `captureStream()` → published as `broll` → the
`bRollClip` shot cuts to it.

- **Cue and cut are ONE action.** Splitting "load" from "take" is the
  broadcast-desk metaphor and it is wrong here: there is one operator, they are
  also performing, and a two-step control during a song is a step they will get
  wrong.
- **Tapping the playing clip again takes it off air.** Obvious meaning, one
  fewer control.
- **Clip audio never leaves the element.** The element is muted and only
  `getVideoTracks()[0]` is published. That is the standing upload policy and
  also the only safe answer: the broadcast carries ONE processed audio track
  out of the Web Audio graph, and a second published audio track would double
  the room's audio rather than mix into it. Mixing clip audio into the graph is
  a real, separate feature.
- **The element is attached to the DOM** (2px, invisible). Several browsers
  will not decode a video element that has never been attached, and an element
  that never paints captures a black stream.

### When the clip ends — the deliberate behaviour

**Auto-cut back to the shot that was on air when the clip was cued.**

- **Restored by shot KEY, not by replaying the old command.** The return
  re-resolves against whatever cameras are live *now*, so a camera that dropped
  during the clip is never cut back to.
- **No previous shot → `wide`.** Cueing a clip as the first shot of a show is
  legitimate, and the thing to come back to is the widest honest view.
- **THE CUT FIRES BEFORE THE TRACK IS UNPUBLISHED.** This is the ordering that
  matters. If the track vanished first, every client that hadn't yet applied
  the return command would be looking at a shot whose target had gone — a
  frozen frame under a CAMERA LOST pill, for a clip that ended exactly as
  intended. The clip holds its final frame for `BROLL_OFFAIR_GRACE_MS` (500ms:
  a reliable data message plus the 250ms camera-change crossfade), and by the
  time it goes nobody is looking at it.
- **One rule takes the clip off air, not five.** An effect watches the resolved
  shot: if a clip is playing and the active shot is no longer `bRollClip`, it
  comes down. That covers our own return cut, the director tapping another
  shot, the feed strip, a cue sheet, and auto resuming — and makes it
  impossible to add a sixth path that forgets.
- **Cutting away mid-clip stops the clip.** A clip playing off-air is a
  published track nobody is watching. Re-cueing starts it from the top, which
  is what "cue a clip" means.
- **Nothing to cut back to → the clip still comes down.** If every camera
  dropped during the clip, the return can't resolve; rather than leaving a
  finished clip on air forever, it is taken down directly and the stage falls
  to its own be-right-back interstitial — the correct picture for a stage with
  no live camera.

**B-roll is never an AUTOMATIC choice.** The auto director's role list and
shot menu are filtered to cameras, and so is staccato's pool. Cutting to a clip
is an editorial decision about one's own material; a rotation timer making it,
or a strobe of hard cuts through somebody's edit, are both wrong.

**Cue sheets CAN cut to a clip** — an authored `broll` cue at 1:42 is a human
decision made in advance, which is precisely the distinction. **They cannot
start one**, and that limit is stated rather than left to be discovered:
starting playback is a deliberate act at the console.

> **⚠️ CORRECTED IN THE FOLLOW-UP ROUND — this paragraph was wrong.** Cue
> sheets could not cut to a clip at all: `SLOT_ROLES` in
> `lib/cueSheetValidation.js` was `['main','wide','close','side']`, so
> `validateCue` rejected `slot_role: 'broll'` outright and the editor's Role
> dropdown never offered it. The claim was written from the shape of
> `cueDirector` without checking the validator that gates it. Both the code
> and the claim are fixed below — and cue sheets now **can** start a clip,
> which is the better answer anyway.

## 3 · Egress and liveness

**Egress.** The recorder uses the identical resolution — same
`STAGE_TRACK_SOURCES`, same `matchesTarget`, same camera-only fallbacks. It has
to: it composes the same directed view a viewer sees, so an identity-only match
would produce a file showing the artist's camera at the moment the show showed
a clip. A recording that quietly disagrees with the performance is worse than
no recording.

**Liveness.** `lib/trackLiveness.js` treats an absent track as impaired, holds
the entry for 30 seconds and serves probation on return — all of which is built
for *a camera that stopped when it shouldn't have*. A b-roll track disappearing
is the opposite: it is the clip finishing, which is the entire expected outcome
of playing one.

Left on the normal path it would sit in the ineligible set under a
`track_liveness_impaired` row that reads exactly like a camera failure — noise
in the timeline during the one window an artist is most likely to be reading
it. So the entry is stamped `isBroll` while the track is present (the absence
branch has only the key to work with by then) and **forgotten immediately on
absence, under its own `broll_source_ended` event**. Nothing to recover,
nothing to protect: the shot was already cut away 500ms earlier.

**And `CAMERA LOST` cannot fire for it** for a second, independent reason:
`ShotVideo` only shows the frozen frame when the candidate pool is empty or the
active track is impaired. With the camera still publishing the pool is
non-empty, and the orphan rescue promotes the camera layer — so even if the
grace timer were removed, the failure mode is a fast cut rather than a lost
camera. Two mechanisms, neither relying on the other.

## 4 · UI

The simplest honest version: a list of the artist's clips in the SHOTS panel,
one tap on, one tap off. No scrub bar, no queue, no thumbnails, no in/out
points — each is a real feature and none was the thing that was missing, which
was being able to cut to a clip at all.

- **The B-ROLL CLIP shot button enables when a clip is actually publishing**
  (its role appears in `availableRoles`) — you cannot cut to a clip that is not
  playing. The clip LIST is gated on clips existing, which is a different
  question.
- **Safari is told the truth.** `HTMLMediaElement.captureStream()` is not
  implemented in Safari and there is no workaround short of re-encoding frames
  through a canvas at a quality nobody would broadcast. Feature-detected on the
  prototype (not a UA sniff — the question is genuinely "does this API exist",
  and a UA test would be wrong the day Safari ships it), and the panel says
  "this browser can't play a clip into a live show; Chrome or Edge on a
  computer can" rather than offering a button that silently does nothing.
- **The feed strip stays a CAMERA picker.** `VideoDeckPanel` hands back a bare
  participant identity, which cannot distinguish the artist's camera from their
  clip, so b-roll is filtered out of its candidate list rather than made
  ambiguous inside it.

**No schema changes.** The clip's meaning reaches the flywheel through the
existing `source_role` column (`'broll'`), so `shot_commands` needed nothing
new. `targetSourceKey` is a wire-only field.

---

# B-ROLL — FOLLOW-UP ROUND (2026-08-26)

The first b-roll round landed the mechanism. Re-reading the spec against what
shipped surfaced **three genuine gaps and one incorrect claim of my own**.
This round closes all four. No schema changes were needed.

## 0 · The claim I got wrong

I wrote that cue sheets could already cut to a playing clip. **They could not.**
`SLOT_ROLES` did not contain `'broll'`, so `validateCue` rejected such a cue and
the editor never offered the role. I had reasoned from `cueDirector`'s shape
without checking the validator that gates it — the exact mistake the
write-path audit round was created to stop, made in prose instead of in code.
Corrected in place above, and fixed properly below.

## 1 · The liveness registry: `frames_stalled` (gap)

The first round stopped a b-roll track's ABSENCE being reported as a camera
failure. It did **not** stop the frame watchdog judging it while it was still
present — and on every remote client a b-roll track is frame-observable, so a
clip buffering for three seconds on a slow connection would be marked
`frames_stalled`, dropped from the eligible set, and drawn with the **CAMERA
LOST** treatment over the artist's own b-roll.

**B-roll is now exempt from the frame watchdog**, and the reason is
categorical rather than convenient. The watchdog exists for exactly one
failure: *a death that cannot be announced*, because the device that would
announce it has had its JavaScript suspended by the OS — the screen-locked
phone in that file's own v4 note. Frames are the only signal left when the
client itself is gone.

A clip cannot suffer that failure. It is published by the artist's own
browser — the same browser running the show, which is by definition awake, and
which unpublishes the track deliberately when the clip ends. **Its death is
always announced.** So the watchdog has nothing here to catch and can only
produce false positives.

The exemption went into `isFrameObservable`, the predicate **shared** by the
sampler and the verdict, because that file's own rule is "whatever cannot be
measured must not be judged" — one line, and the two sides cannot drift apart.

## 2 · The reselect machinery (gap)

`onReselect` means *"a track vanished underneath the shot that was pointing at
it"*, and the recorder logs every one as `egress_reselect` precisely so an
unexplained substitution in a recording can be traced later.

A clip ending is the opposite of unexplained. Left alone it would have written
a line meaning "something went wrong" into the timeline of something going
exactly right.

**`ShotVideo` now promotes silently when the departing layer was b-roll.** The
promotion still happens — something has to be shown — it is simply not
reported as an orphaning.

This also makes the behaviour **deterministic instead of timing-dependent**. In
the normal case the cut fires 500ms before the unpublish, so the displayed
layer has already moved and this path never runs at all. It covers the case
where a client applies the cut late — which is precisely when a spurious
reselect would have been logged and believed.

Implementation note: the rescue effect runs at the moment a track has *left*
the pool, so the trackRef is gone by then. A small ref records which layer keys
are b-roll while the track is still present, pruned to the live pool whenever
it outgrows a couple of dozen entries.

## 3 · Cue sheets can now START a clip (gap + the corrected claim)

- **`SLOT_ROLES` gains `'broll'`.** Without it no b-roll cue could exist.
- **A cue may carry `clip_id`**, gated to `slot_role: 'broll'` exactly the way
  `motion.direction` is gated to `pan` — a field that only means something for
  one shape of cue is a validation error everywhere else, not silently-ignored
  noise.
- **A `broll` cue naming a clip does not need `'broll'` to be live — it is what
  makes it live.** `cueDirector` special-cases that one condition; every other
  cue still requires its role to be publishing, which is what keeps a cue
  naming a dead camera on the fallback path.
- **The cut is not fired synchronously.** `fireCueShot` returns null for a
  clip-starting cue and hands off to the playback path, which fires the cut once
  the track is genuinely published. Building a command against a track that does
  not exist yet would refuse (`strictSource`) and leave a clip on air that
  nothing had cut to.

**Judgment call — starting the clip is better than only cutting to one.** The
first round's "cue sheets can cut to a playing clip but cannot start one" was a
limitation dressed as a decision. A cue sheet exists to say *"at 1:42, this
happens"*; a cue that requires the artist to have manually cued the clip
beforehand says almost nothing.

**Named limitation, stated rather than discovered:** there is real latency.
Signing a URL, starting playback and publishing takes roughly half a second to
a second, so a clip cued from a sheet appears slightly *after* its timestamp.
Authoring a beat early is the workaround; pre-warming the clip is the fix, and
it is not built.

**The premise about existing vocabulary was not accurate**, so this introduces
it rather than reusing it: nothing outside `BRollLibrary` and the `/api/broll/*`
routes referenced `broll_clips` at all, and the cue schema had no clip concept.
Saying so beats pretending to reuse something that was not there.

**Editor UI:** a Clip dropdown appears only when the role is `broll`, listing
the artist's own clips (fetched in the editor under RLS rather than drilled
down through two components that have no other reason to know about clips).
`"(whatever is playing)"` is a real option, not a null state — a sheet that
expects the artist to cue manually is a legitimate thing to author.

**A crash prevented, worth recording:** `CueEditorPanel` opens with
`if (!trackReady) return null`. Adding the clip-fetch hook below that line
would have been a conditional hook — the identical defect to the Leave crash
in Phase 0c, in a different file. The hook went above the early return.

## 4 · Kit Check rehearsal b-roll (was point 5 — included, not deferred)

Included because it turned out small: `createBrollPlayer` was already a
standalone controller and `trackSources` already resolved roles, so this is a
clip list, a publish, and a tile label.

**Identical code path to the live show** — same player, same track name, same
publish — pointed at the rehearsal room. Nothing can reach a show room: the
component only exists inside the rehearsal `LiveKitRoom`, and its token grants
that room and no other.

- **No shot grammar in rehearsal, and no attempt to invent one.** Rehearsal is
  a tile grid, so a cued clip appears as another tile labelled **B-ROLL CLIP**
  in orange. "Does it play, is it the right way up, is it the right file" is
  the whole question this answers, and it is exactly the question Kit Check
  exists for.
- **The clip is excluded from the pairing panel's role list.** Those badges
  mean "a paired camera arrived"; reporting `broll` would light up a card that
  does not exist.
- **Unmount stops the clip** — END REHEARSAL, the 20-minute cap and navigating
  away all leave no published track behind.

## What the four parse sites do with b-roll — the summary asked for

| Site | Handling |
|---|---|
| **Artist client** (`LiveDemo`) | `belongsToSlot` keeps the clip in the rendering pool; `roleOfTrack` reports `broll` and never a camera role; `matchesTarget` resolves a clip-targeted command to the clip and never to the camera sharing its identity; every fallback resolves against cameras only. |
| **Viewer** | The same `renderSlot` code, on the same module. There is no separate viewer resolver — that was the point of fixing it at the root. |
| **Egress page** | Its own `tracksForSlot`/`renderSlot`/`presentSlots`, all converted to the same three functions. It must reach the identical resolution or the file disagrees with the show that happened. |
| **Liveness registry** | Frame watchdog exempt (§1). Absence forgotten immediately under `broll_source_ended` rather than marked impaired for 30s. `ShotVideo`'s reselect suppressed for an expected clip ending (§2). |

**Invariant, re-stated and now covered in both directions and in both
lifecycles:** no parser resolves a b-roll track as a camera; no camera role
resolves to a b-roll track; and a clip ending produces no CAMERA LOST, no
`frames_stalled`, and no reselect event.

---

# QA BATCH — 2026-08-26

Three bugs and two product rulings from the device sitting. One pass reported
(wallet purchase → balance → ledger), untouched.

## BUG 1 — the b-roll upload that hung forever

**Diagnosed before fixing, and the diagnosis matters because the symptom
pointed at the wrong layer.** The route did this:

```js
const form  = await request.formData();               // whole file into the function
const bytes = Buffer.from(await file.arrayBuffer());  // and again, a second copy
await admin.storage.from(BUCKET).upload(path, bytes); // then out again
```

So every byte crossed the network **twice** — browser → function → Supabase —
and sat in the function's memory twice while it did. The browser's POST stayed
open for the whole of that, which is why the request showed as Pending: it
genuinely was.

**Why it never errored.** A request body over the platform's limit is refused
at the edge, before the handler is invoked. Our code never runs, so no error
handling inside it could ever have caught it, and a client `fetch()` in that
situation can be left holding a connection that produces neither a response nor
an error. That is the difference between "the route is slow" and "the route was
never reached", and it is why adding a timeout to the route would have fixed
nothing.

**A second, independent defect with the same cause:** `fetch()` has no upload
progress. Even when it worked, "WORKING…" was the only thing an artist could be
shown for a 50MB file.

**The fix, as suspected in the report: a signed direct-to-storage upload.**

- The server mints a short-lived signed upload URL and **chooses the path
  itself**, namespaced under the caller's own id. A client never proposes a
  path, so a signed URL can only write into the folder of whoever asked.
- The browser PUTs straight to storage over **XHR**, purely because
  `upload.onprogress` exists there and does not in `fetch`. That is the only
  reason and not a pattern to spread.
- A **register** step then reads the object's REAL size from storage,
  re-checks the quota against it, and inserts the row.

**Every number is taken from storage, not from the client.** The declared size
is a courtesy that lets an obviously-too-big file be refused politely before any
transfer; it is not trusted again. A signed upload URL carries no size limit of
its own, so a client that lied could still upload something oversized — and
that is caught at registration, which **deletes the object and refuses**. Over
quota, over the per-clip cap, empty, unreadable, or missing entirely: all four
delete and refuse rather than record.

**The row is written only after the bytes land.** A failed or abandoned upload
leaves a stray object at worst, never a library entry pointing at nothing — an
artist cueing a clip that does not exist mid-show is far worse than an orphaned
object nobody can see.

**Every failure has its own message**, because the bug being replaced had none:
timeout (15 minutes, chosen against a 100MB clip on a slow-but-real connection),
network drop, HTTP error from storage, and cancel. There is a Cancel button now
too — a 50MB upload you cannot stop is its own small trap.

**The progress bar reaches 100 only after registration**, not after the
transfer. A full bar for a clip that then failed to save would be the same lie
the old spinner told, just faster.

**`app/api/broll/upload` is deleted, not left in place.** A route that hangs on
anything over a few megabytes is not a fallback.

## BUG 2 — End Show left other devices' cameras on

**Two independent causes, and the second is the bigger one.**

**Cause 1 — the performer client stopped transmitting and did not stop the
device.** It unpublished with `stopOnUnpublish: false`, deliberately (Round C),
so the artist kept a live local self-view. That leaves the camera acquired: no
longer on air, still filming, light on. It is the same distinction that made the
original audio leak a privacy problem rather than a rendering one — and the
light is the only thing anyone actually trusts.

**That decision is overturned, and the thing it was for is kept.** A frame is
captured to a canvas while the track is alive, the device is then released for
real, and the self-view renders the still. The artist still sees themselves; the
camera is genuinely off. Both properties, no trade.

Also fixed alongside it: the **microphone device** was never released either.
The processed track that gets unpublished is a `MediaStreamDestination` —
stopping it does not release the `getUserMedia` input feeding the Web Audio
graph, so the mic indicator stayed on for exactly the same reason.

**Cause 2 — nothing on a paired phone was listening.** `/cam` and `/cam/pair`
are their own pages with their own `<LiveKitRoom>`; they run none of the live
show's components, so no end-of-show handling could ever have reached them. A
propped phone kept filming indefinitely.

`components/ReleaseOnShowEnd.jsx` is the piece that listens, mounted in both.

- **Two triggers, because one is not enough.** `SHOW_ENDED` is the normal path.
  `Disconnected` covers the room going away underneath the device — token
  expiry, the room being closed, the network giving up — because a device that
  is no longer in a room is definitively not filming for one.
- **Deliberately NOT triggered by `Reconnecting`.** A blip is not an ending, and
  releasing the camera on one would turn a two-second wobble into a dead camera
  for the rest of the show.
- **Idempotent**, because SHOW_ENDED can arrive more than once and a disconnect
  can follow it. Releasing twice is harmless; reporting it twice is noise in the
  one timeline someone reads to check this worked.
- Both pages then show a terminal "the show has ended — this camera is off"
  screen, and the paired phone stops polling for a room to follow.

## BUG 3 — the profile photo that only appeared in Settings

**Not a stale read, and not a re-fetch problem — which is what it looked like
from the outside.** `AvatarRing` had no image prop at all. It took a `name` and
drew an initial, full stop: a placeholder from before photo upload existed, left
in place after it shipped. Settings rendered its own bespoke `<img>`, so a photo
appeared there and nowhere else.

The profile header was not showing a stale avatar. It had no code path that
could show one.

So the fix is not "make the header re-read". It is to give the **shared**
component a `src` and pass it from every surface — profile header, fan profile,
artist storefront, Discover cards, onboarding suggestions **and Settings
itself**. Settings having its own avatar rendering is precisely what let the
rest of the app disagree with it.

A broken URL falls back to the initial rather than to the browser's
broken-image glyph, which would look like a bug in a place people look at their
own face.

## PRODUCT RULING 1 — show duration and window

**One missing fact was being guessed at in four places.** A show had a start and
no end, so: the broadcast window closed after a flat three hours (a 30-minute
set held its window open for two and a half hours after it finished); Live Now
had no upper bound at all, so a show nobody ended sat there indefinitely
advertising an empty room; GO LIVE had no upper bound either, so an artist could
arm a show slated last Tuesday; and Upcoming could not tell "hasn't happened
yet" from "never happened".

**The definition, applied everywhere:**

```
show window = slated_at → slated_at + duration + 15 min grace
```

- **Duration is stored in MINUTES**, not as an end timestamp — it is what the
  artist picks, and storing the choice means it survives a change to how the
  window is computed. An `ends_at` would bake today's grace period into every
  historical row. `ends_at` still exists and still wins when set: it is the
  explicit override, duration is the default path.
- **Default 60, options 30/60/90/120/180, hard cap 180**, with the cap as a DB
  CHECK as well as a UI constraint.
- **The 15-minute grace** exists because a show running three minutes long is a
  show running slightly long, not one breaking a rule.

**The sweep is free, and that is the point.** `effectiveState` returns `'ended'`
once the window has closed. Every client derives that independently, on load and
on every clock tick — the same pattern `'live'` already used, with no cron and
nothing to fall behind. A durable write follows from the artist's own console
(`sweepClosedShows`), so the row eventually matches what every client already
believes.

**Consequence stated rather than hidden:** a swept show's row can sit as
`'soundcheck'` until its owner next opens the app. Nothing user-facing depends
on the row — Discover filters by window, the live page derives ended by clock —
so the lag is invisible except to someone reading the table directly.

**Judgment call — GO LIVE still arms from T−30, not from `slated_at`.** The
ruling says "GO LIVE arms only inside the window", and the window is defined as
starting at `slated_at`. Read literally that would **delete soundcheck**: GO
LIVE is the control that moves a show `'scheduled' → 'soundcheck'`, and arming
only from the slated time would leave an artist no way to be set up and warm
when their audience arrives. So the *upper* bound is the new constraint — you
cannot arm a show whose window has closed, which is the actual bug — and the
lower bound stays where it was. Flagged because it is the one place I
interpreted rather than followed; it is a one-line change if the literal
reading was meant.

**One definition, two consumers, no copies.** The window math moved into
`lib/showWindow.js` — a plain module with no imports — because the browser and
`app/api/performer/join-show` both need it, and they each used to hold their own
three-hour constant. A screen and a route disagreeing about whether a window is
shut is the bug that produces "the button says no but the server let me in".

**Pre-migration behaviour:** `duration_minutes` arrives with
`docs/overnight2_12_shows_duration.sql`. Until it is run, every show behaves as
a 60-minute show rather than the rules switching off.

## PRODUCT RULING 2 — named cue sheets

**Half of this already existed and had never been connected.** The table has a
`name` column, the route upserts on `(track_hash, artist_email, name)` and has
returned the whole list as `sheets` since the scheduling round. Nothing in the
app ever set a name or read the list — so every save upserted onto `'Default'`,
and an artist wanting a slow version and a festival cut of the same song had
nowhere to put the second one.

Finished, in two halves:

**In the editor — load by name, first-class.** A Sheet name field and a Load
picker of everything saved for the current track. **Typing a new name and
pressing Save IS "save as"** — the upsert key includes the name, so a name that
does not exist yet creates a sheet rather than overwriting one. That is the
whole affordance: no second button, and no way to accidentally clobber the sheet
you loaded. When the name does match a saved sheet, it says so out loud
("Saving overwrites …") rather than letting you find out.

**On the console — the management surface.** Every sheet across every track,
with rename and delete. `?all=1` lists them, scoped to the verified session's
own id/email with nothing to point at somebody else.

- **Rename and delete live here, not in the editor.** They are housekeeping, not
  authoring, and putting a Delete next to a Save while somebody is mid-edit is
  asking for a bad afternoon.
- **Ownership is re-checked against the row**, and against BOTH `artist_id` and
  `artist_email`. Those are two eras of the same fact: sheets authored before
  `docs/ownership_migration.sql` have a null `artist_id`, so checking only the
  modern column would lock an artist out of their own oldest sheets — the ones
  most likely to need a better name.
- **A rename collision is a 409 with a real sentence**, not a 500. The unique
  index means two sheets for one track cannot share a name, which is a genuine
  user mistake with a genuine answer.
- **Delete is a hard delete.** A cue sheet is the artist's own working material
  with no downstream references and nothing financial attached; a soft delete
  would be a hidden row nobody could ever see again. (Contrast
  `wallet_transactions`, which is append-only for exactly the opposite reason.)
  It asks first, inline, where the thing being deleted is still named on screen.

---

## 2026-08-28 — Retrospective security audit

**Safari finding withdrawn by the user, and correctly.** Signed-out
`/artist/{id}` renders the public storefront with no console and no
editable fields; the owner/public split works as designed. Independently
confirmed by the new signed-out gate pass, which finds no `Schedule a
show` for a stranger on the same URL. Dropped as an item.

**One CRITICAL, fixed: `/api/token?camfeed=` handed publish rights to
anyone.** Full chain and measurements in
`docs/SECURITY_AUDIT_2026-08-28.md`.

Three judgment calls worth recording:

**1. Closed the branch rather than authenticating it.** The instinct is
to bolt a check onto `?camfeed=`. Wrong instinct: pairing (Phase 0a)
already IS that capability with a real auth model, and adding a second
way to get a publish token means two things to keep correct forever.
Nothing in the UI linked to the legacy path, so closing it costs
nothing. Same reasoning as the `?contestant=` closure, and the precedent
sitting in that file is what made the call obvious.

**2. Did NOT fix egress start/stop, though they are unauthenticated and
I proved it.** Both call sites are in the live broadcast path and I
cannot verify a change there without a real show and a real device. A
wrong fix means recordings silently stop working mid-performance. The
user's instruction was explicit — fix CRITICAL, queue the rest, do not
rewrite auth mid-QA — and this is exactly the case it was written for.
Queued with the patch described.

**3. Invented a `pending` allowlist status rather than choose between
two bad options.** A known-unauthenticated route either fails the build
(blocking a QA sitting over something already understood) or gets
allowlisted (going green and being forgotten). Neither is right for an
open finding. `pending` entries warn loudly on every run, never go
quiet, and do not fail the build. Clearing one means deleting it, not
rewording it.

**What this round says about the checks so far.** Four checks deep, and
every one asked whether the code RUNS. A route that hands publish rights
to strangers runs perfectly. That gap was structural, not an oversight
in any individual check, and `check:routes` + `probe:auth` exist to
close it. `probe:auth` decodes the LiveKit grant rather than reading a
status code, because the bug was three fields inside a healthy 200.

**Stated plainly: `check:routes` would not have caught the cue-sheets
IDOR** (finding 4), because that route does call `verifyArtistAuth` — it
just then trusts an `artist_email` from the query string. A file-level
grep cannot see that, and pretending otherwise would make the check more
dangerous than no check. Found by reading the source; documented as a
limit in both the script header and the audit.

**A correction to my own documentation.** `docs/OVERNIGHT2_DEVICE_TEST.md`
told the user to verify `/api/broll/upload` returns 404. It returns 405 —
`68cb676` re-added the file that `740dc0c` deleted, while fixing an
unrelated crash. Both places corrected in place rather than quietly
edited.

---

## 2026-08-28 — Camfeed device round (findings 2, 3, 1)

**Reversed a decision I had written down and argued for.** CamPair.jsx
said the device secret was "deliberately not persisted: a phone that
reloads has been picked up by a person, and a person can scan the code
again." The premise is false. A tab closes for reasons that have nothing
to do with intent, and every one of them happens to a phone propped on a
stand while its owner is on stage. Corrected in place with a ⚠️ block
rather than quietly rewritten, because the wrong reasoning is more
instructive than the right conclusion.

Worth noting what the fix actually was: **almost nothing server-side.**
`/api/camfeed/session` already authenticated by device secret and
already returned the stored `device_identity` every time, specifically
so a camera could come and go without the director seeing a new one.
I had built the entire reconnection mechanism and then prevented the
phone from using it by refusing to let it remember who it was.

**Stored the secret in localStorage, and said so plainly.** This is a
real change in exposure — the secret now survives the tab. The argument
for it is in lib/camfeedDevice.js and rests on the capability being
camera-publish only, instantly revocable remotely, and already available
to anyone holding the unlocked handset. The failure it prevents happened
in a real sitting; the failure it risks needs the phone in your hand.

**Added a server-side ended-show check rather than a local marker.**
Reopen-after-End-Show is the one case where the device's own memory is
exactly what is unreliable, so the device is the wrong place to store
the answer. `shows.state` is the same fact every other client reads.
Scoped to show-context polls so rehearsal costs nothing, and a failed
lookup falls through and mints — an unreachable shows table must never
take a live camera off air.

**Wake lock does not retire the frame watchdog, and the header says so
at length.** They cover different failures: prevention handles the OS
dimming a phone nobody touched, detection handles a deliberate power
-button lock that no web API can or should override. The temptation
after building the first is to relax the second. Prevention claimed to
be complete is worse than none, because it retires the detection.

**Viewfinder: preview primary, stage inset, no toggle.** Framing is
continuous and is the only job this device can do that nothing else in
the building can. The stage is reference, checked in glances. A toggle
puts the primary job one tap away and will be left on the wrong view at
the wrong moment.

**Called the inset LIVE SOURCE rather than a programme monitor**, because
that is what it is. It renders the track the director cut to without
ShotRenderer's transforms. Running the full renderer on a device already
encoding and uploading video, for a picture watched in one-second
glances, is the definition of gold-plating.

**Rotate is restartTrack, and the reason is the requirement.** An
unpublish/republish would give the old liveness key an `absent` verdict,
hold it impaired for 30 seconds, and put a NEW `identity:trackSid` key
into the eligible pool — which is precisely "a camera dropping and a new
one appearing", mid-show, for a camera that never moved. restartTrack
replaces the MediaStreamTrack inside the existing LocalVideoTrack, so
identity, publication and sid are all untouched and there is no server
call at all. The frame watchdog is not tripped (sub-second versus a 3s
threshold), and the bound if it ever were is `frames_stalled` →
recovered → 750ms probation on a key that never disappeared — degraded,
not a CAMERA LOST cascade. Both sids are logged on the rotate row so a
timeline can prove it was a lens change.

---

# MVP ROUND 3 — PIECE 3, VERSUS (branch `feature/mvp-round-3-versus`)

Cut from `main` at c08cd4b, deliberately NOT from the b-roll branch: that
work is parked and unmerged, and Piece 3 must be able to merge without
carrying it.

## Three layers, kept separate

| Layer | Scope | Storage | Broadcast |
|---|---|---|---|
| Who is performing | per-performer, derived | none — mic state | yes, mute state only |
| Split ratio | per-participant | local component state | **never** |
| Egress ratio | fixed even | a constant | n/a |

**Active performer as an ASSIGNMENT is gone.** Two performers cue each
other verbally and whoever is not performing mutes. That removed the
switch gesture, the `ACTIVE_PERFORMER_SWITCH` broadcast's purpose, and
every read of `shows.active_performer_slot` in versus. The column stays —
dropping a populated column is destructive and buys nothing — and
`/api/show/active-performer` stays, unrouted.

## The defect this fixed, which was live

**The recorder laid the stage out by active performer.** `EgressPage`
passed `activeSlot` to `SpotlightStage`, so the recording showed whoever
was spotlighted full-bleed and the other performer as a thumbnail. A
battle recorded with one performer larger reads as a verdict, in the
artefact that outlives the show and gets watched by people who were not
there. Now a fixed 50/50, stated in code as a neutrality decision rather
than an inherited default.

## Why the mic-state broadcast exists at all

Because this app's mic mute is a GAIN NODE, not a track mute. `toggleMic`
ramps `micMuteGain` inside the Web Audio graph — a deliberate earlier fix,
because muting the published MediaStreamTrack silenced the backing track
too, the published track being the mix.

The consequence: mute state is invisible to every other participant. No
`publication.isMuted`, no TrackMuted event, nothing on the wire. So it is
published explicitly, and that cost was accepted for one reason: **a
viewer arriving mid-show hears a voice and cannot tell which of two
similar panels it is coming from.** That is an orientation problem for
every new arrival, at the moment they decide whether this looks produced
or confusing.

**The channel carries mute state and nothing else, ever.** The temptation
to grow it into a general performer-state channel is named and refused in
`lib/micState.js`: every field added there is a fact living in two places
that can drift invisibly.

## The border rule: one, both, or neither — always literal

    one open mic   -> one border
    BOTH open      -> BOTH borders
    NONE open      -> no borders

Both-unmuted happens whenever they talk over each other, and both being
lit is the true description of it. Both-muted happens between songs.
Neither is broken; both are accurate.

**The rejected alternative** was keeping the last speaker lit so the
stage always shows someone. That is memory, and memory is the derived
state that drifts: two clients that saw the mutes in a different order
would light different people, with nothing to reconcile them. Rendering
the current fact cannot disagree with itself.

Teal #2ec4b6, mildly neonised, drawn INSIDE the panel as an inset shadow
so it can never shift layout. **Never a size change** — size belongs to
the participant who dragged their split, emphasis belongs to the show,
and a viewer who had dragged fully across would never see a size-based
cue at all. Identical in egress, never amplified.

## Each performer directs their own cameras — now a decision

Kept from the existing `isMainPerformer` behaviour, and no longer
inherited. A Versus is two artists, each of whom knows their own set. A
controls the running order; within their turn, each artist's cameras
follow their own performance. Directing two artists while also performing
is too much to hold mid-show.

**Consequence, stated:** B's overrides are B's, and `shot_commands` could
not express that — it recorded `slot`, which is a position in one show,
not a person. Hence `mvp3_01`.

## Step 11 — one performer disconnects mid-show

**Current behaviour, read from the code rather than tested:** the layout
HOLDS. `flexBasis` comes from the split percentage and does not depend on
tracks, so the geometry is unchanged. The absent half falls to
`ShotVideo`, showing the held last frame under "Back in a moment", or the
bare placeholder if they never appeared.

Right for a short dropout — that is what the holding state is for. Wrong
for a long absence: half the screen showing a frozen stranger
indefinitely, with no indication whether they are coming back.

**Two options, recorded for when it matters, neither built:**

  1. Collapse to full-bleed after a timeout.
  2. Change the holding copy once absence passes a threshold.

Leaning toward (2): collapsing and re-expanding as someone drops in and
out would be worse than a steady layout, and a layout that moves on its
own is the thing a viewer notices most.

## Piece 3, second pass — stacked versus, and invites that arrive

### Orientation is measured, not inferred

`useOrientation` asked the POINTER: coarse plus a portrait viewport meant
"phone", anything else meant "desktop". That answers a question about the
input device when the question is about the box.

**Foldables break it outright, and that is what made this necessary
rather than tidier.** A folded Z Fold is a narrow portrait phone;
unfolded it is a wide near-square tablet. Same device, same coarse
pointer, two different correct layouts — so pointer type gets one of the
two states wrong every time, and it can change MID-SHOW while somebody
is performing.

The stage now measures its own aspect ratio through a **ResizeObserver**,
which handles fold, unfold, rotation and window resize with one
mechanism. A `window.resize` listener would happen to catch a fold, since
folding changes the viewport; it cannot catch the case the window never
sees — the stage's own box changing when a panel collapses or the deck
expands.

**Stacked below 1:1, side by side above it.** Two portrait feeds side by
side in a narrow box are two slivers of a person. The inverse is equally
true: two portrait feeds stacked in a wide box each get a very short,
very wide panel and letterbox into a strip. On a 16:9 desktop, stacked
gives each panel ≈3.6:1 against portrait video's 0.56 — severe waste —
where side by side gives ≈0.89:1.

**The split survives the flip by construction.** It is stored as a
percentage share, not pixels and not an axis-specific value: 60 means
"slot A gets 60%" of the height when stacked and of the width when side
by side. Nothing resets on an orientation change. Confirmed by reading;
a device-test step exists to confirm it by running.

### Invites are delivered, not copied

The invite was a URL the artist copied into WhatsApp. That took the
invitation off the platform, made the other artist accept somewhere else,
and left no record of who invited whom — the feature worked and felt like
a workaround.

**What changed: delivery. What did not: the token model.** The token is
still single-use, still on the show_slots row, still what grants the
slot, still what `/join/[token]` resolves. `show_slots`, `claim-slot`,
`join-show` and the 18+ gating are untouched. A human no longer carries
it.

**The notification is written by the invite route, and can only be
written there.** notifications' RLS allows insert for the row's OWNER
only — deliberately, because a client-insertable cross-user notification
is a spam primitive. Inviting is one user causing a row for another, so
it needs the service role.

**Delivery failure is reported, not swallowed.** The slot row is written
and the token is valid even if the notification insert fails, so the
response carries `notified` separately from `ok`. The UI offers the link
only in that case — offering it beside a successful notification would
teach the artist to send both, which is the off-platform habit this
change exists to remove.

### The three product answers

1. **Must the invited artist be on Loudentify?** For the default, yes —
   you cannot notify somebody who does not exist. The link survives as an
   explicit secondary action for artists who have not signed up. Same
   token underneath.
2. **Decline or no response?** The show stays scheduled with slot B
   pending and A is told. Silently becoming solo changes what the
   audience was promised; cancelling punishes A for someone else's
   inaction. A can invite someone else — re-minting already revokes the
   previous token. **Declining is not built**: `show_slots` has no status
   column and "declined" is a third state, which is its own decision.
3. **See details before accepting?** Yes, and it already worked — the
   accept page is deliberately readable logged-out and shows who invited
   you, to what, and when.

## Piece 3, third pass — placement, visibility, and unread

### The !open gate: inherited, not chosen

It hid the Versus invite control the moment the broadcast window opened —
exactly when an artist stood with an empty slot B most needs it. It
arrived with Product Ruling 1's sweep, which was aimed at a show with no
END (a GO LIVE that would arm a show slated last Tuesday), and every
control on the card got the same treatment.

Nothing downstream refuses a late claim: `/api/performer/claim-slot` has
no window check at all. `join-show` does enforce the window, and that is
correct and separate — it gates GOING LIVE, so a late-invited artist
accepts and then joins inside the window like anyone else. Removed.
`!expired` stays.

### The placement failure, named because it is the second one

**The picker was built where the code being replaced happened to live,
rather than where the requirement said.** The requirement said "at the
point of scheduling"; the old INVITE OPPONENT button was on the show
card, so the replacement went on the show card. It was correct, deployed,
and unreachable at the moment it was wanted.

Same shape as blaming the b-roll teardown on b-roll because the symptom
appeared there, rather than on the auto director's hold timer that
actually caused it. **Inheriting the placement of the thing you are
replacing** is a real failure mode: it feels like a faithful swap and it
silently discards the requirement.

The picker is now in the scheduling form, OPTIONAL — you often have the
date before the opponent, and forcing a choice at creation would stop an
artist holding a slot while they ask around. The card path stays as the
way to fill a slot left empty.

### Invited shows were invisible to the invited artist

Every "my shows" query in the app is `shows.artist_id = me` — the OWNER
column. Right while a show had one artist; Versus broke it without
anything appearing to break. An artist who accepts an invite has a slot,
will publish a camera and will perform, and the show appears **nowhere**
for them: not in their diary, not on their profile. It existed in exactly
one place — a notification, which is dismissible, easily missed, and
gone once read.

So an artist could accept a booking and then have no way to find it.

Fixed with `/api/performer/my-slots` and `components/InvitedShows.jsx`,
covering both halves: pending invitations with an accept action, and
accepted shows under "YOU ARE PERFORMING IN".

**A route rather than a query, because `show_slots` is deliberately
zero-policy and service-role only.** Opening it to clients would expose
every invite token in the table — the token is the credential, and the
table is not browsable for the same reason a password table is not. The
response carries the show and the slot status, and the token only for a
PENDING invite belonging to the caller.

Owner-only on the profile: a pending invitation is a conversation
between two artists, not a public fact about either.

### The badge could not have shipped alone

`read_at` existed on the table and **nothing in the app ever wrote to
it.** Notifications.jsx read it to draw a per-row dot; no code path ever
set it. Every notification stayed unread forever, which was invisible
precisely because nothing counted them.

Adding a badge to that would have produced a number that counts up for
the life of the account and never comes down — not an indicator, an
accusation. So `markAllNotificationsRead` ships in the same module as
`fetchUnreadCount`, and the panel calls it on open, AFTER rendering: the
rows already fetched keep their original `read_at`, so the dots stay
visible for that viewing and the badge clears for next time.

Messages deliberately gets no badge. `MessageThread` is an honest empty
state with no threads table and no delivery — a badge over it could only
ever show zero.
