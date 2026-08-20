# Manual test script — Accounts & Identity Day 2 (profiles, recordings library, visibility)

Single-sitting script covering everything in this round: profile edit
(artist + viewer — now identical in what's editable, see Change 1 below),
the genre tag picker, the recordings library, the public/private toggle,
the public artist profile, and the enforcement gauntlet for private
recordings. No part of this was verified in a browser on my end — the
Chrome extension was unavailable for this whole round, so every device
step below is unverified rendering, not a re-confirmation of something I
already saw work. Where I'm specifically uncertain something renders
correctly, I've said so inline rather than assumed it. Treat every
"Expected result" as a prediction from reading the code, not an
observation.

**Mid-sitting product changes, folded in after batch 1's findings were
fixed:** (1) bio and photo are no longer artist-only — both roles get the
full profile. (2) genre is now a fixed-list, tag-style multi-select
(`lib/genres.js`/`components/GenreSelect.jsx`), not free text. Step 3/4
below reflect this; if you're comparing against batch 1's original run,
the pass conditions for viewer profile specifically have inverted (see
Step 4's note).

Preview: redeployed after this round's changes — check with me for the
current URL before starting, since a fresh `vercel deploy` mints a new
one each time (branch `feature/profiles-library`, still not merged to
main).

Existing test account from Day 1, reusable here: **artist**,
`accounts-day1-test@mailinator.com` / `TestPass123!`.

---

## Before you start — migrations + verification

You've already run `docs/recordings_migration.sql` and
`docs/ownership_migration.sql`, plus the batch-1 findings' manual patches
(profiles.bio/avatar_url columns, the avatars bucket via dashboard,
avatars_public_read by hand). `docs/recordings_migration.sql` has since
been amended to fold all of that in for real, so a **fresh** environment
doesn't repeat batch 1's three findings — your live database already
matches what the updated file describes, so you don't need to re-run it,
just confirm with the queries below (updated to match the amended file,
retroactively per Finding 2).

**Per the standing ritual, confirm every table/column/policy this round
touches actually landed before doing anything else** — this is now the
third schema-cache/silent-migration incident (Day 1's profiles table
cache, Day 1's missing policies, batch 1's missing profiles columns).
Run all of these and check the counts match:

```sql
-- Expect exactly 1 row.
select table_name from information_schema.tables where table_name = 'recordings';
```

```sql
-- Expect: profiles -> bio, avatar_url, genres (3 rows). recordings ->
-- all 7 declared columns. Don't worry about the exact count on
-- recordings, just confirm all three profiles columns appear -- this is
-- the column check batch 1's Finding 2 asked for, and the reason genres
-- specifically (batch 2, Finding 1) would have been caught immediately
-- if it had been run against the consolidated file from the start.
select table_name, column_name
from information_schema.columns
where (table_name = 'profiles' and column_name in ('bio', 'avatar_url', 'genres'))
   or table_name = 'recordings'
order by table_name, column_name;
```

```sql
-- Expect 4 rows for recordings (select_own, insert_own, update_own,
-- select_public) and 3 for objects (avatars_public_read, avatars_owner_insert,
-- avatars_owner_update) -- 7 total. Fewer means some policy failed to
-- create -- see docs/recordings_migration.sql's own header comment.
select schemaname, tablename, policyname, cmd, roles
from pg_policies
where tablename in ('recordings', 'objects')
order by tablename, policyname;
```

```sql
-- Expect: shows 3 rows (read_shows, update_shows, insert_shows),
-- cue_sheets 3 rows (cue_sheets_select_own/insert_own/update_own),
-- show_slots 0 rows (still zero-policy by design -- not a bug if empty).
select schemaname, tablename, policyname, cmd, roles
from pg_policies
where tablename in ('shows', 'show_slots', 'cue_sheets')
order by tablename, policyname;
```

```sql
-- Expect 1 row, public = true.
select id, name, public from storage.buckets where id = 'avatars';
```

```sql
-- cue_sheets backfill sanity -- not a pass/fail, just worth knowing
-- the ratio before you rely on artist_id anywhere.
select count(*) as total_rows, count(artist_id) as matched_to_account from cue_sheets;
```

**Batch 2, Finding 1:** `profiles.genres` was originally a separate file
(`docs/genres_migration.sql`) — it existed and was committed before the
genre-picker code shipped, but having two migration files for one
round's profiles changes meant it went un-run before testing reached it.
Folded into `docs/recordings_migration.sql`'s section 0 now (the
standalone file is deleted) — there is exactly one migration doc for
this round's `profiles` columns from here on. The column check above
already covers `genres` alongside `bio`/`avatar_url`; also run the
"didn't map cleanly" query near the bottom of that file's section 0 so
nothing from the old free-text genre field got silently dropped.

```sql
-- Standard closing statement from here on (Finding 2) -- run this after
-- any migration/verification pass, not only when something's visibly
-- broken.
notify pgrst, 'reload schema';
```

If any of these don't match, stop and re-run the relevant migration
(check for an error you may have missed) before continuing — every step
below depends on this data model actually being in place.

---

## Step 1 — Set the recordings bucket to private

**Action:** Supabase dashboard → Storage → `recordings` → Settings →
toggle to private.

**Verify via SQL:**
```sql
select id, name, public from storage.buckets where id = 'recordings';
```
Expect `public = false`.

**Why first:** everything downstream (the egress check, the enforcement
gauntlet) is only a meaningful test under the real target condition —
testing egress writes or private-URL refusal against a still-public
bucket would pass for the wrong reason.

---

## Step 2 — Egress sanity check: LiveKit still writes to the bucket

This directly answers the question you asked for: do the storage
changes this round (bucket now private; no `storage.objects` RLS
policies added for `recordings` at all, since reads go through a
service-role signed-URL route instead) break LiveKit's own S3-protocol
write? My reasoning says no — egress authenticates with a static
access-key/secret over the raw S3-compatible protocol, a separate path
from the Storage REST API that the public/private flag and any RLS
policies actually gate — but reasoning isn't proof.

**Action:** As the artist (`accounts-day1-test@mailinator.com`), go
through a normal short live show: gate → **I'm an artist** → log in →
Solo → performer code `NEW-CODE-A` → **Claim & Go Live**. Wait ~15-30s
(enough for at least one egress-eligible segment), then **End Show**.
Wait an additional ~30-60s after ending — egress needs time to finish
encoding/uploading before the object appears in the bucket; don't treat
an empty result immediately after End Show as a failure yet.

**Expected result:** the show runs normally (this part is unchanged
from every prior round — if it doesn't, that's a regression unrelated
to this round's actual scope, worth noting separately). After the wait,
a new object should exist in the bucket.

**Verify:** rather than checking the bucket directly, use the app's own
sync route (keeps this test inside the app, not a direct Storage call) —
covered by Step 5 below, which will pick this recording up. If Step 5
shows 0 recordings after a sync, come back here: that's the signal this
check actually failed, not a sync-route bug — check the Vercel function
logs for `[egress]`-prefixed errors from `app/api/egress/start` /
`stop` around the time of this test.

**What a failure would indicate:** if the show runs fine but no
recording ever appears even after a generous wait and a retry, the
private bucket setting is the prime suspect (my reasoning above would be
wrong) — the fix would be re-checking whether LiveKit Cloud's own S3
credentials need anything else granted for a private bucket, not
anything in this app's code, since nothing here touches the write path.

---

## Step 3 — Artist profile edit round-trip

**Action:** Still signed in as the artist, go to `/settings`. Edit
**display name** and **bio**. In the genre field, type a few letters of
a real genre (e.g. "afro") and confirm a filtered dropdown appears;
click a suggestion (or press Enter) to add it as a tag; add 2-3 genres
this way. Then try typing something that matches **nothing** in
`lib/genres.js` (e.g. "xyz123") and confirm no suggestions appear and
nothing gets added if you press Enter — this is the "no free-typing"
rule, worth confirming it actually holds, not just that the happy path
works. Click the **×** on one tag to remove it. Click **CHANGE PHOTO**,
pick a small image file (well under 5MB). Click **SAVE CHANGES**. Once
it says "Saved.", **reload the page** (not just re-open the tab — a
full reload, to force a fresh fetch rather than trusting in-memory
state).

**Expected result:** page loads with your session already recognized
(no "sign in" prompt). Photo picker, genre tag picker, and bio field
should all be visible. After reload, all fields — name, genre tags,
bio, photo — show the values you just saved, not the old ones, and the
genre field shows them as tags (not a plain text string).

**I'm specifically uncertain about:** the dropdown's positioning/z-index
in this exact layout (`components/GenreSelect.jsx` is brand new,
unrendered by me) — if it appears cut off or behind other elements
rather than simply not appearing, that's a CSS issue to note separately
from whether the underlying filter/select logic works (test the logic
via keyboard — type, Enter — even if the visual dropdown looks off).

**Retest note (batch 1, Finding 4):** text fields and the photo picker
itself were already confirmed working. What was broken, now fixed: the
photo persisted to storage but `handlePhotoChange` never checked the
follow-up `profiles` write for an error, so a column-name mismatch
(code wrote `photo_url`, the table has `avatar_url`) failed silently —
the picker showed the new image locally while the database kept the old
(null) value, with "Saved." never even referring to the photo (that
message comes from the separate SAVE CHANGES flow, which never touched
the photo field at all). Fixed: the write now uses `avatar_url`
throughout, and a failure surfaces as a real error message instead of
silently reverting nothing. Specifically re-verify: upload a photo,
reload, confirm it persists (not just previews). Then upload a
**different-format** image (e.g. a `.png` after a `.jpg`) and confirm
the old file is replaced, not left behind — the upload path was also
changed from `{uid}/photo.{ext}` to a fixed `{uid}/avatar` (no
extension) specifically so re-uploads always overwrite regardless of
format; any stray files from before this fix (batch 1's "orphaned
strays") are still sitting in the bucket under the old naming and can be
deleted by hand from the Storage dashboard whenever convenient — not
cleaned up automatically.

**What a failure would indicate:** stuck on "Loading…" forever → the
session-fetch effect is hanging or throwing silently (check browser
console). Shows the "Sign in to view your profile" state despite being
logged in → the session isn't being picked up (check that `/auth`
login and `/settings` are genuinely sharing the same browser session,
not a cookie/storage partition issue). Save errors outright → likely an
RLS or missing-column issue (re-check the `pg_policies`/
`information_schema` output above). Fields **revert after reload**
despite a "Saved." message → the update silently didn't persist even
though the client thought it succeeded — a real bug worth flagging
precisely, since it would mean `profiles_update_own`'s RLS check isn't
behaving the way the migration intends.

---

## Step 4 — Viewer profile (now full — pass condition inverted from batch 1)

**Product decision, mid-sitting:** viewers now get the SAME profile
fields as artists (bio, photo, genre tags) — engagement rationale, both
sides should be able to know who they're dealing with. What stays
role-gated is capability, not profile fields — covered in 4b below.

**4a — Action:** Sign up a **new** account via `/auth` — toggle **I'M A
FAN** (maps to the `viewer` role in the database; the UI label wasn't
changed to avoid drifting from existing product copy). Use a fresh
mailinator alias, e.g. `day2-viewer-test@mailinator.com`. Confirm via
the email (same mailinator-inbox pattern as Day 1). Log in, go to
`/settings`. Edit display name, add 2-3 genre tags (same picker as Step
3), write a bio, upload a photo. Save, reload.

**Expected result — inverted from batch 1's original script:** bio and
the photo picker **should now appear and work** for this account,
identically to Step 3. This is the opposite of what batch 1 checked
for (which correctly asserted bio/photo were artist-only, under the
scope at the time) — if bio/photo are STILL missing here, the
`isArtist` conditionals that used to gate them in
`AccountSettings.jsx` weren't fully removed; check the component
directly against what's described in Change 1's commit.

**4b — Action (the thing that actually matters now — capability, not
fields):** Still on this viewer account, confirm the restrictions
**below** actually hold. These were true before this round's product
change and aren't supposed to have moved — this is a verification
that removing the UI field-gating didn't accidentally loosen anything
real, not a test of new behavior.

- **Cannot claim a performer slot.** Go to the live-show gate (`/`),
  choose **I'm an artist**, and try logging in with this viewer
  account's credentials on that form. Real enforcement:
  `app/api/performer/claim-slot/route.js` calls `verifyArtistAuth`
  (`lib/verifyArtistAuth.js`), which 403s with "This action requires
  an artist account" for any non-artist role — **at the API route**,
  not just by hiding a button. Confirm you get that rejection (or, if
  the artist-login branch's own UI stops you earlier since the gate
  flow assumes artist credentials, confirm you simply cannot reach a
  live performer view with this account by any path).
- **Cannot author cue sheets.** Same mechanism —
  `app/api/cue-sheets/route.js`'s GET/POST both call
  `verifyArtistAuth` — but there's no direct UI path to even attempt
  this as a viewer (cue authoring only renders behind
  `isMainPerformer`, itself only reachable after a successful,
  artist-gated slot claim), so this is really the same check as the
  bullet above, not a separately reachable one.
- **Cannot see technical director/audio panels.** Same reasoning —
  `components/LiveDemo.jsx`'s `isMainPerformer` can only become true
  via a successful claim-slot response, so there's no scenario where a
  viewer reaches `DirectorShotPanel`/`AudioDeckPanel` at all, gated or
  otherwise.
- **"Access earnings"** — nothing to test here. I confirmed there's no
  real earnings/payments feature anywhere in this codebase to gate —
  `ArtistDashboard.jsx`'s "TOKENS EARNED"/"TOP SUPPORTERS" numbers are
  static mock content, not connected to any account or capability.
  Worth knowing this is currently ungated only because there's nothing
  real behind it yet, not because it was deliberately left open.

**One honest gap, not introduced this round:** `/dashboard` itself
(the page, not any of the capabilities above) renders for **any**
authenticated user who navigates there directly, viewer included —
it's not blocked at the page/route level. This isn't a data leak (its
recordings query is scoped to `artist_id = auth.uid()`, so a viewer
just sees an empty library, same RLS as everyone else) and it predates
this round, but it's real: nothing stops a viewer from landing on the
"STUDIO" page and seeing artist-oriented chrome. Confirm this is what
actually happens (an oddly-empty but harmless page, not an error and
not someone else's data) rather than assuming it away.

---

## Step 5 — Library render + playback

**Action:** Back on the **artist** account (`accounts-day1-test@...`),
go to `/dashboard`. Look at the **RECORDINGS** section. If it's empty,
click **SYNC RECORDINGS**.

**Expected result:** the sync button shows a result like "Synced -- 1
new, 0 already up to date." (exact count depends on how many egress
recordings exist for this artist's shows total, including anything from
before this round). The recording from Step 2 should now appear as a
card: a placeholder thumbnail, a title, a date. Clicking the thumbnail
should start inline playback (a `<video>` element appears below the
card and plays).

**I'm specifically uncertain about:** whether this recording lands
attributed to the right show on the first try — the sync route matches
a bucket object to a show by room name + nearest recording time among
*your own* shows (stated as a heuristic in the route's own comment,
given egress's object keys don't embed a show id). If Step 2's
recording doesn't show up after sync even though Step 2's wait was long
enough, check whether the show you claimed in Step 2 actually has
`shows.artist_id` set to your account yet — first successful slot claim
sets it, so a claim from a much earlier, different-account test could
theoretically already own that room's `shows` row if you're reusing an
old show rather than a fresh one.

**What a failure would indicate:** Sync button does nothing / shows an
error → check the response body (likely an auth or bucket-list issue).
Recording appears but clicking does nothing → check the browser network
tab for the `GET /api/recordings/[id]/url` call; a 403 here for your
*own* recording would be a real bug (ownership check comparing the
wrong id). Video element appears but doesn't play → check for a CORS
error in the console first, that's the more likely culprit than the
signed URL itself being wrong.

---

## Step 6 — Toggle flip + public profile reflects it

**Action:** On the same recording card, click the visibility toggle to
flip it to **PUBLIC**. Note the recording's `id` isn't shown in the UI
anywhere — if you need it for Step 7's URL or Step 8, get it via:
```sql
select id, title, visibility from recordings where artist_id = (
  select id from auth.users where email = 'accounts-day1-test@mailinator.com'
);
```

Then open (or ask me for) the artist's public profile URL:
`/artist/<artist-profile-id>` — the id is the same `auth.users.id` /
`profiles.id` from the query above. Open it in a **fresh, logged-out**
browser tab (private/incognito window, to make sure you're seeing what
an anonymous visitor sees, not something cached from your own session).

**Expected result:** the public profile shows the artist's display
name, genre tags, and bio (whatever you saved in Step 3) — or the
stated empty states ("No bio yet.", no tag row at all if no genres
picked) if any field is blank. The now-public recording should appear
in the RECORDINGS list and be playable by clicking it, with **no login
required**.

Now flip the same recording back to **PRIVATE** on the dashboard, and
refresh the logged-out public-profile tab.

**Expected result:** the recording disappears from the public list
immediately (this is a live RLS-backed query, not a cache).

**I'm specifically uncertain about:** the overall visual layout of
`/artist/[id]` — it's a brand-new page this round, adapted in structure
(not code) from the existing `components/ArtistProfile.jsx` mock, but
never rendered. If anything looks broken or misaligned, that's more
likely than the underlying data being wrong — check the data itself
(display name/bio/recording list) separately from how it looks before
concluding something's actually broken versus just visually rough.

**What a failure would indicate:** artist not found / blank page →
check the `id` in the URL matches `profiles.id` exactly. Public
recording missing from the list → check `visibility` actually saved as
`'public'` in the table (Step 6's toggle should have written this).
Private recording still showing after flipping back → the public-read
policy or the toggle's own update isn't working — a real finding, not a
caching artifact (there's no caching layer here).

---

## Step 7 — Enforcement gauntlet (the hard part)

**Errata (batch 2, Finding 3):** Vercel preview deployments sit behind
Vercel's own SSO wall for **every** request, not just browser page
loads — plain `curl` from a terminal gets redirected to a Vercel login
page instead of ever reaching the app, for 7a/7b both. That wall isn't
present on production. Two ways to actually run 7a/7b against a
**preview**: `vercel curl <url>` (handles the SSO bypass automatically,
same tool used to diagnose the egress `EGRESS_TEMPLATE_BASE_URL` gap
earlier this round) instead of plain `curl`, or — the standing method,
no CLI needed — run the `fetch(...)` calls below **from the browser's
own DevTools console** on an already-loaded page of that deployment,
where the SSO cookie is already satisfied. Against **production**,
plain `curl` works fine, no wall, no substitution needed — this is what
made 7c's result "cleanest evidence" (7c is a direct Supabase Storage
URL, never touches Vercel's SSO at all, on either preview or
production).

Make sure the recording you're testing with is currently **private**
(end of Step 6 left it that way). Get its `id` from the query in Step 6
if you don't already have it.

### 7a — Second logged-in account, via the app's own route

Two sub-cases, not one — see the ordering note below for why both
matter.

**7a-i — Different role (fan/viewer account).** Using the viewer
account from Step 4, log in via `/auth` in a browser tab, open DevTools
console on that same tab, and run:
```js
const { data } = await window.supabase?.auth.getSession() ?? {};
// If window.supabase isn't exposed, pull the token from Application ->
// Local Storage -> the sb-<project-ref>-auth-token entry instead.
fetch('/api/recordings/<recording-id>/url', {
  headers: { Authorization: `Bearer ${data.session.access_token}` },
}).then(r => r.status).then(console.log);
```

**Expected result:** `403`, `{"error":"This action requires an artist
account"}` — this is the **role** gate
(`lib/verifyArtistAuth.js`), not the ownership check.

**7a-ii — Same role, different artist (ownership check).** This is the
one 7a-i can't exercise — a non-artist gets rejected before the code
ever reaches the ownership comparison (see the ordering note). Sign up
a **second artist account** (cheapest form: just sign up + confirm —
it never needs to claim a slot, run a show, or own any recording of its
own; it only needs `role = 'artist'` to get past the first gate). Log
in as that second artist, repeat the same `fetch` call against the
**first** artist's private recording id.

**Expected result:** `403`, `{"error":"Not authorized to view this
recording"}` — this is the different message, confirming you actually
reached the ownership check this time, not the role gate again.

**Ordering, confirmed directly in the code**
(`app/api/recordings/[id]/url/route.js`): the role check
(`verifyArtistAuth`) runs first; the ownership comparison
(`auth.user.id !== recording.artist_id`) only runs if that passes. A
fan account is correctly rejected before ever reaching the ownership
check — 7a-i alone doesn't exercise it, which is exactly what the
gauntlet's first pass found. 7a-ii is what actually proves the
ownership check works.

**What a failure would indicate:** a `200` with a real signed URL in
either sub-case would be a serious bug. In 7a-i, the role gate itself
is broken. In 7a-ii specifically, it would mean the ownership check is
either not running or comparing the wrong ids.

### 7b — Logged-out tab, the app's own route

**Action:** From a logged-out/incognito tab, DevTools console (or
`vercel curl` on preview, plain `curl` on production):
```js
fetch('/api/recordings/<recording-id>/url').then(r => r.status).then(console.log);
```

**Expected result:** `401`, `{"error":"Missing Authorization header"}`.

### 7c — Raw storage URL, no app involved at all

This is the actual test of storage-level enforcement, not app logic —
it deliberately goes around the app, because that's the real-world
scenario (a leaked or guessed URL), and it's the one sub-step immune to
the SSO wall either way (a direct Supabase Storage request, not a
request to this app at all). Get the raw path:
```sql
select storage_path from recordings where id = '<recording-id>';
```
Then, from any browser tab or `curl` (logged in or out, doesn't
matter — the bucket itself must refuse this regardless of who's asking):
```
https://<your-supabase-project-url>/storage/v1/object/public/recordings/<storage_path>
```

**Confirmed result (batch 2):** `404`, `NoSuchBucket` — the bucket is
no longer resolvable at the public-object endpoint at all once private,
which is a cleaner refusal than a 400/403 would have been. It must
**not** return the video file.

**What a failure would indicate:** if this URL actually serves the
video, Step 1's bucket-privacy change either didn't take effect or
isn't sufficient by itself — this would be the single most important
finding to report back, since it means private recordings are
currently NOT enforced at the file level regardless of what the app or
RLS say. Re-check `select public from storage.buckets where id =
'recordings'` returns `false`, and if it does and this URL still
works, that's worth escalating rather than assuming user error.

---

## Notes on what's out of scope for this script

- No thumbnail generation exists (placeholder icon only) — not a bug,
  stated scope for this round (real thumbnails need a background job,
  Day 3+).
- `shows`/`show_slots` RLS tightening and the `cue_sheets` artist_id
  backfill are data-model changes with no dedicated UI step above — the
  `pg_policies` queries in "Before you start" are their verification.
  If you want to exercise the `shows` ownership grandfather clause
  specifically (an unclaimed show's state can still transition), that
  would need a show that's never had a slot claimed since this
  migration ran — not staged for you in this script since every show in
  active use this round has already been claimed at least once.
- Discover-page wiring (making existing "view artist" links point at
  the new `/artist/[id]` route instead of the old hardcoded
  `/artist` page) is explicitly Day 3, not tested here.
