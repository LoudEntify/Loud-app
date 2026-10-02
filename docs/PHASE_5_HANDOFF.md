# Phase 5 handoff: the website

2 October 2026. Branch `claude/overnight-build-2026-10-02`. Plain English first.

## What exists

The public website, built to `design/Web*.dc.html`, inside the same app as everything else:

- **Home (`/`)**: the hero ("A production crew in your pocket") with drawn shapes that drift only when the device allows motion; the live strip of real shows (live first, then starting soon, each a link); "How a show works"; the two audience cards; the footer with product, company and legal links. The pilot's old front door is at `/pilot`.
- **What's on (`/whats-on`)**: every public show for the next seven days, live now on top, then Today / Tomorrow / the weekday, times in the visitor's own time zone, Solo / Versus filters that work without JavaScript, Remind me (guests go to sign-up with the trigger recorded; signed-in people get the reminder row), and honest empty states.
- **The page artists share (`/s/:id`)**: cover, title, date, length, genre, the artist card, a countdown that flips to "LIVE NOW" by itself, "Watch free in your browser" to the show screen, "Add to calendar" (a real `.ics` file), a share box with copy and X/WhatsApp links, "More from" the artist, and Open Graph tags so a pasted link unfurls. Not-found and database-error states are written out. Unlisted shows are `noindex`.
- **For artists, For fans, Pricing, About, Get the app**: the boards' copy, one to one. Pricing prints "to be set" under a DRAFT badge for the artist figures, because they are an open v2 decision; tokens "from £1.99" comes from the real pack list.
- **Contact**: topic chips, the form, and a working `/api/site/contact` that validates, rate-limits, filters bots with a honeypot and writes the message to a new `site_messages` table nobody can read through the Data API. Email addresses and social handles are yours to supply (NEEDS_KOREY).
- **Help**: four categories, "Asked most often", search with a no-results state, and eleven articles written from how the product actually behaves (where something is not built, the article says so).
- **Legal**: Terms and Conditions, Community Guidelines, Cookies (with the live consent buttons) and the Artist agreement (training-data clause as a separate, off-by-default choice), every one with a DRAFT notice and `noindex`; the existing `/privacy` page is untouched and linked from the side nav and footer.
- **Cookie banner** on every website page, the same banner and the same stored choice as the app; it never appears over a player because the website has none.
- **App-link files** (`/.well-known/apple-app-site-association`, `assetlinks.json`) served as JSON with placeholders for the Apple team id and the Android key fingerprint.

The header shows Log in and a page-specific call to action for guests, and an avatar menu with Log out when signed in. Everything is fluid down to a phone, with a 16px gutter and a Menu button under 900px.

## What I ran

- `npm test`: 42 node tests pass (adds `tests/site.test.mjs`: contact validation, honeypot, help search).
- SQL: 4 suites pass (adds `phase5_access.sql`: anon and authenticated refused on `site_messages`, service role writes). The migration applies from scratch with the other 59 and its rollback was rehearsed down and up.
- `npm run check:lint` and `next build` pass.
- Browser e2e `tests/e2e/site.e2e.mjs` (11 steps at 1440 and 390 wide), run against a fresh build on the local stack: 11/11. The first run caught three real things the suite exists for: the header's call to action overlapping the phone menu, an unnamed link on the schedule, and a logo tap target under 44px; all fixed.

## What is stubbed or deferred

- The pricing numbers, contact addresses, social handles, store links, hero photographs, Apple/Android ids in the app-link files: NEEDS_KOREY, each a one-line change.
- Email on a contact message (no mail provider); messages are in the table.
- The production cut-over: the website is the front door on this branch; loudentify.app is unchanged until you promote.

## Test results

- Unit 42/42, SQL 4/4, lint and build clean.
- Browser e2e: viewer 20/20, artist 8/8 (same build, same run), site 11/11 (`E2E_SUITES=site scripts/dev/e2e.sh` after the fixes; CI runs all three on every push).
