# Loudentify User Journey and App Map

29 Sep 2026. Owner: Oluwakorede Alashe (Korey).

Note for the build: this is v1 as written on 29 September. For viewer delivery and the Versus views, docs/YOUTUBE_ADDENDUM.md and docs/ARCHITECTURE.md (v2) override it.

## How to read this

This is v1 of the Loudentify user journey for the native app (iOS and Android) and the web app. It is the brief for UI design, and then Ugo's brief for architecture and backend. Every screen and setting carries one status tag. Built and Mock come from our build history, so Ugo should confirm them against the repo.

| Tag | Meaning |
| --- | --- |
| Built | Exists in the current web build in some form |
| Mock | Screen exists with mock data and no backend (for example /competitions) |
| New | Not built yet, proposed here |
| Deferred | Agreed idea, parked for a later phase |
| Needs decision | Clashes with a standing decision, or needs Korey's call first |
| Removed | In the draft list, taken out here with a reason |

The full list of screens sits in the Screen inventory (docs/SCREEN_INVENTORY.md). Open questions are gathered near the end.

## Design principles

Eight rules shape every screen below. If a design choice breaks one, it needs a reason written next to it.

1. **Three doors.** Discover, Live and Profile are always one tap away. Nothing else is more than two taps behind them.
2. **Performing is the product, setup is not.** Technical controls live in Settings as saved presets. Show screens show outcomes (ready, not ready, fix this), not dials.
3. **Recovery stays in reach.** Moving controls into Settings must not strand an artist mid-show. On 20 September a mic died and the only fix was logging out. The live screen keeps one Fix sheet: switch mic, recheck cameras, reconnect.
4. **Watch first, sign up to stay.** A new person can watch for up to 60 seconds. Then, or the moment they react, comment, vote, follow, message or buy, a one-page sign-up rises over the video. The action they tapped completes once they are in.
5. **One profile, two modes.** The owner sees their console. Everyone else sees the public page. Off their own profile, artists are ordinary viewers.
6. **No payments in the native app.** Tokens and prepaid packs are bought on loudentify.app only. The app shows balances.
7. **18+ at launch.** Date of birth on the sign-up page is the gate.
8. **Live wins.** Where a live show and a recording compete for the same space, the live show gets it.

## What changed from the draft list

Most of the draft stands. Eleven items change, mainly to keep sign-up short, keep Profile one tap away, and keep the camera list honest about what phones can do.

| Draft item | What this doc does | Why |
| --- | --- | --- |
| Load page with logo animation | Keep. The system launch screen is static, then a short whale animation plays. Returning users go straight to Discover. | Launch speed is the first retention number. The animation must never block. |
| Discovery before sign-up | Keep. Guests watch for up to 60 seconds, then sign-up opens over the video. Any action opens it sooner. | People see the product working before they meet a form. |
| Profile inside the Menu | Profile becomes a bottom tab. The Menu moves to the top of the Profile screen. | Inside a menu, Profile is two taps away, which breaks the three-doors brief. |
| Sign-up asks legal name, age, location, genre, subscription | One page over the playing video, finished in under 60 seconds: login, role, name, username or stage name, date of birth, location. Genre and photo move to onboarding. | Short enough to finish before interest drops. |
| Legal name at sign-up | The name given at sign-up is verified as the legal name by the identity check at an artist's first cash-out. | Only payouts need it verified. |
| Age | Date of birth. | An age goes stale. An 18+ gate needs a date. |
| Subscription type at sign-up | Never at sign-up. Offered when viewer-hours run low. | Charging supply during cold start is the error we already ruled out. |
| Premium artists allow "random Jins" | Dropped. It meant random joins by uninvited viewers. Every show is open to anyone, and viewer-hours are the only limit. | More viewers is the goal. Running low on hours is the natural point to buy a prepaid pack. |
| Audio, Camera, Direction settings hold everything technical | Keep the split. Backing tracks, cue sheets and B-roll move to a Studio library inside Settings and get attached when you schedule. Kit Check stays as a guided pre-show check that uses your saved settings. | Settings are defaults. The library is files. The check is part of the show. |
| Camera: aperture | Removed. | Phone cameras have a fixed aperture. The "aperture" in camera apps is simulated blur, the per-frame processing we flagged on 24 September. |
| Camera: LUTs, pan, moving zoom | LUTs need a decision. Pan and moving zoom stay Deferred and sit under the 1.2x ceiling. | LUTs are per-frame work on a phone that is already the bottleneck. Pan inside a 1.2x crop has very little room. |
| Schedule show as a menu item | A Create button in the tab bar opens Schedule a show, Kit check and New clip. Shows are booked at least 30 minutes ahead. | It is the artist's main job, so it gets a permanent place. |
| Website nav list | Keep, and add a public Live and upcoming page, For artists, Help, Community guidelines, Cookies. | Show pages are what artists share, so they need public URLs. |

"Discovery terms" in the Menu is the general Terms and Conditions for using the app.

## Roles and surfaces

Six roles use Loudentify. One account can be a viewer and an artist; a camera device is a phone, not a person.

| Role | Who | What they can do | Status |
| --- | --- | --- | --- |
| Guest | Not signed in | Watch for up to 60 seconds in total, read comments, view profiles. Any action, or reaching 60 seconds, opens sign-up. | New (pilots used a name and email entry form) |
| Viewer | A fan with an account | React, comment, vote in prompts, follow, set reminders, message, support with tokens | Built (web) |
| Artist | A performer with an account | Everything a viewer can do, plus the owner console, scheduling, Kit Check, going live, clips, earnings | Built (web) |
| Camera device | A phone paired to an artist as one camera | Viewfinder, role, connection and ON AIR state only | Built (web QR pairing); native New |
| Operator | A second person running a show's controls without performing | Camera overrides, prompts, votes, End show when granted | Deferred (table migrated, build cut on 14 Sept) |
| Admin | Loudentify staff | Moderation, identity checks, payout review | Out of scope for this doc |

### Which surface does which job

The native app is for watching on a phone, performing from a phone, and running camera phones. The web app is for watching on a laptop, buying tokens, managing money, and longer editing work. The website is the public front door.

| Job | Native app | Web app |
| --- | --- | --- |
| Watch, react, comment, vote | Yes | Yes |
| Perform (main device) | Yes | Yes (laptop) |
| Act as a camera | Yes, primary | Yes, fallback |
| Operator console | No | Yes (laptop) |
| Buy tokens or a plan | Shows balance only | Yes, the only place to pay |
| Cash out, identity check | View status | Yes |
| Write cue sheets, trim clips | Quick edits | Full editor |
| Settings | All | All |

## App map

Three tabs and a Create button sit at the bottom of every main screen. Search and Inbox sit in the top bar. Everything technical lives in Settings, reached from the Menu on your Profile. The only technical thing left in the show flow is the Fix sheet, because an artist can't go to Settings mid-song.

- **Launch.** Returning users land on Discover. A shared link lands on its target: a show, a profile or a clip.
- **Tab bar.** Hidden on the show screen and in camera mode, back on leaving.
- **Create.** Artists get Schedule a show, Kit check and New clip. Viewers get Become an artist, pending a decision (later decided: hidden for viewers).
- **Web app.** The same doors as a left sidebar on desktop, and bottom tabs on mobile web.

## Journey 1: first open and sign-up

A new person is watching music within seconds. After 60 seconds of watching, or the first time they try to do something, a one-page sign-up rises over the video.

1. **Open the app.** Static system launch screen, then the whale animation. Returning users skip straight to Discover.
2. **Guest watching.** Discover plays straight away. Guests watch shows and recordings, read comments and open profiles.
3. **60-second preview.** The timer counts total watching on that device, across every video, so swiping does not reset it. At about 50 seconds a small "Sign up free to keep watching" chip appears.
4. **Sign-up page.** At 60 seconds, or on the first react, comment, vote, follow, remind me, message or support tap, one page rises over the video. The video keeps playing, dimmed, behind it. (YouTube variant: the video shrinks to 200 x 356 beside the sheet instead.)
5. **One page, under 60 seconds.** Apple, Google or email. Watch or perform. Name. Username or stage name. Date of birth. Location, pre-filled from the device. Accept the Terms and Conditions. Anyone under 18 gets a kind stop screen, and their date of birth is not kept.
6. **Finish the intent.** Whatever they tapped completes, and the video returns to full screen.
7. **Onboarding runs after, not before.** It is skippable, resumable and never blocks watching.

### Viewer onboarding

1. Pick genres you like (three or more).
2. Follow a few suggested artists, including new ones.
3. Ask for notification permission in context: after the first follow or first "remind me", not on first launch.

### Artist onboarding

1. Photo, bio, genres.
2. Accept the artist agreement. It must carry the training-data clause, which is still an open item. (Architecture v2: a separate, on-by-default line for performers, legitimate interests basis, switchable any time.)
3. "Set up your stage": pick a mic, pair a first camera, save it as your first place (for example "Living room").
4. "Book your first show" nudge.
5. A progress card sits on their Profile until these are done.

### What we ask, and when

| Field | When | Viewer | Artist | Why |
| --- | --- | --- | --- | --- |
| Login: Apple, Google or email and password | Sign-up page | Yes | Yes | Apple requires a privacy-focused login option where Google login is offered; Sign in with Apple meets it |
| Role: watch or perform | Sign-up page | Yes | Yes | Sets the onboarding path. Viewers can switch later with Become an artist |
| Name | Sign-up page | Yes | Yes | For artists, verified as the legal name at first cash-out |
| Username or stage name | Sign-up page | Username | Stage name | Unique handle; stage name is public |
| Date of birth | Sign-up page | Yes | Yes | 18+ gate. Never shown publicly |
| Location | Sign-up page, pre-filled | Country | Country and city | Local discovery and show times in local time |
| Terms and Conditions, Community Guidelines, privacy notice | Sign-up page | Yes | Yes | Consent record |
| Genres | Onboarding | Three or more to follow | One main, up to two more | Seeds Discover and search |
| Photo and bio | Onboarding | Optional | Prompted, skippable | Profile quality |
| Artist agreement | Artist onboarding | No | Yes | Rights, conduct, training-data use |
| Address and ID, legal name check | First cash-out | No | Yes, through the identity-check provider | Only payouts need it verified |
| Prepaid pack | When viewer-hours run low | No | Offered, never required at sign-up | Cold-start rule |

Log in, forgot password and "log out everywhere" follow the same sheet style. Returning users land on Discover.

## Journey 2: Discover

Discover is a full-screen vertical feed that snaps one card per swipe, with live shows first. It is the default home for everyone.

### What the feed shows, in order

1. Live now, from artists you follow.
2. Live now, matching your genres.
3. Starting soon (a countdown card with Remind me).
4. Clips and recordings, matched to your genres and follows.

A fixed share of cards goes to new artists. Every interviewee named being heard by strangers as their hardest problem, so the feed has to deliver that, not just recycle the popular.

### What a card carries

| Card | Shows | Main action |
| --- | --- | --- |
| Live solo | LIVE badge, viewer count, stage name, genre, show title | Tap to join the show |
| Live Versus | Both stage names, VERSUS tag, viewer count | Tap to join |
| Starting soon | Artist, start time countdown, cover | Remind me |
| Clip or recording | Artist, clip title, "from the show on [date]" | Watch the full show, follow, share |

### Gestures

| Gesture | Result |
| --- | --- |
| Swipe up or down | Next or previous card, snapping to the frame |
| Tap a live card | Opens the full show screen |
| Tap a clip | Pause or play |
| Double tap a clip | Like |
| Long press | Not interested, report, share |
| Tap stage name | Opens their profile |

Sound plays on by default in the native app, respecting the phone's silent switch. Web browsers block sound until the first tap, so the web feed shows a "Tap for sound" chip. When nothing is live, the feed opens on Starting soon, then clips. It is never empty. A view in the feed counts toward the artist's viewer-hours only after 30 seconds. Scrolling past costs the artist nothing.

## Journey 3: Live events and the show screen

The Live tab answers one question: what can I watch now, and what is coming. The show screen is the product itself.

### Live tab

| Section | Content | Status |
| --- | --- | --- |
| Live now | Grid of live shows, followed artists first | Built as a list; grid New |
| Starting soon | Next few hours, with countdown | New |
| Upcoming | By day, filter by genre and Solo or Versus | Built (scheduled shows exist) |
| Competitions | Monthly genre competitions and Versus rounds | Mock (no backend) |

Every upcoming show offers Remind me, Add to calendar and Share.

### Watching a show

1. **Waiting room.** Before start: 15-minute countdown, pre-show loop, artist card, Remind me for late arrivals. Built.
2. **Show starts.** Solo shows fill the screen with the directed feed. Versus shows the active performer large and the other as a thumbnail, swipeable. Built. (YouTube variant: three Versus views, see docs/YOUTUBE_ADDENDUM.md.)
3. **Controls fade** after a few seconds. Tap anywhere to bring them back.
4. **During the show:** reactions, comments, a prompt or vote card when pushed, Support, Follow, Share, Leave.
5. **End card.** Versus result (today it is announced by voice only), follow, watch the recording later, next show from this artist, next live show on Loudentify.
6. **Leave.** Returns to wherever they came from, Discover or Live. On native, leaving the app mid-show drops into picture-in-picture (New).

### Show screen controls

| Control | Status | Note |
| --- | --- | --- |
| Chat box with an emoji tab and a reactions tab | New layout | Reactions tab placement agreed beside emoji; the reaction design is on hold until after the UI pass |
| Comments | Built, not saved | Comment persistence is still to build |
| Prompt and vote card | Built | One vote per viewer, changeable until voting closes |
| Viewer count | Built | |
| Support (tokens) | New | Spends tokens already in the wallet. No slot-machine or jackpot visuals |
| Picture-in-picture | New | Native only |
| Recording replay with reactions in sync | Built for solo; Versus layout agreed | |

Versus reactions carry no artist today, so a reaction can't count for A or B. Blended scoring needs that schema change before the Versus screen can show anything per performer.

## Journey 4: Search

Search sits in the top bar of Discover and Live, remembers what you searched, and lets you wipe that history.

1. **Tap search.** Before typing: recent searches (remove one or clear all), then genre chips, then "Live now" suggestions.
2. **Type.** Suggestions appear as you type: artists first, then shows, then genres.
3. **Results tabs:** Top, Artists, Live and upcoming, Recordings, Genres.
4. **No results.** Suggest close spellings and the nearest genre. Never a blank screen.

Search history can be paused or cleared in Settings, Privacy. Guests get search without saved history.

## Journey 5: Profile

There is one profile page per person. What it shows depends on who is looking, and the server decides that, not the screen.

### Public mode (anyone looking at an artist)

| Area | Content |
| --- | --- |
| Header | Photo, stage name, genres, city, bio, LIVE badge when live |
| Actions | Follow, Remind me for the next show, Message, Share |
| Tabs | Upcoming, Shows (public recordings), Clips, About |

### Owner mode (an artist on their own profile)

The August build merged dashboard and profile, and warned it would get dense. Moving the technical tools into Settings is what fixes that. Owner mode now holds identity, shows and the next action only.

| Area | Content | Status |
| --- | --- | --- |
| Header | Same as public, edited in place | Built |
| Status strip | "Next show Sat 19:30 · Stage ready" or "1 thing to fix", tap goes to Kit Check | New |
| Actions | Schedule a show, Kit check, New clip | Built |
| Shows tab | Recordings with Public, Unlisted, Private | Built (visibility toggles) |
| Clips tab | Clips made from recordings | Built? (Ugo to confirm) |
| Insights tab | Peak viewers, watch time, votes, followers gained, per show | New |
| Menu (top right) | Wallet, Settings, Help and legal, Log out | New placement |

A viewer's own profile: photo, username, Following, Reminders, Watch history, and a Become an artist card. The Menu sits top right, as for artists.

### Making a clip

1. Profile, Shows, pick a recording, or the post-show "Make a clip" prompt.
2. Trim up to 90 seconds.
3. Frame for 9:16 (portrait), with a safe area for captions.
4. Add a title. A small Loudentify mark and the artist's handle go on the export.
5. Share through the system share sheet: Instagram, TikTok, X, Facebook, WhatsApp, or save to the phone.

The mark and handle close the loop the four Cs rely on: full shows stay on Loudentify, and snippets on social bring people back.

## Journey 6: an artist's show, start to finish

The artist sets up once in Settings, then each show is schedule, check, perform, share. The technical depth never appears on this path unless something needs fixing.

1. **Set up once (Settings).** A mic and a vocal preset for each place you perform. Cameras paired and saved with their exposure, focus and zoom. Auto director on. Saved as a place, for example "Living room" or "Church hall".
2. **Schedule (Create, Schedule a show).**
    1. Solo or Versus.
    2. Date, start time, length. Lengths vary, because interviewees wanted anything from 10 minutes to over an hour.
    3. Title, genre, cover image.
    4. Pick the place (loads its saved audio and cameras).
    5. Optional: attach backing tracks, a cue sheet and B-roll from the Studio library.
    6. Versus: send the invite link. The show confirms when the other artist accepts.
    7. Confirm. Shows are booked at least 30 minutes ahead, with no unscheduled go-live. Any number of viewers can join, and the show draws on the artist's viewer-hours. If they run out mid-show, the show carries on and borrows, and the pack offer comes after.
3. **Before the show.** Reminders at 24 hours, 4 hours, 1 hour and 30 minutes (built). Only reminders still in the future fire, so a show booked 30 minutes out gets just the last one. A "Share your show" card with the public show link.
4. **Pre-show check (Kit Check).** Opens from the reminder or the status strip. It shows a checklist of outcomes, each green, amber or red with one fix:
    - Mic is sending real signal (raw mic level, not the mixed output: the lesson from 20 Sept).
    - Each camera holds frames for two minutes, not just connects (the side camera on 20 Sept passed a connect check and then stalled 283 times).
    - Connection strong enough.
    - Every device charging, Do Not Disturb on.
    - Headphones wired, or Bluetooth latency checked.
    - Nothing streams during the check (built).
5. **Countdown.** At slot time, a 60-second countdown. If the artist is in Kit Check, they go live automatically (built). Viewers see the waiting room.
6. **Live.** A minimal console:
    - What viewers see now, small self-view, viewer count.
    - Comments, collapsible.
    - Prompt and vote buttons.
    - Director shows "Auto". Tap to open manual cuts; closed by default.
    - Fix sheet, one tap: switch mic, recheck cameras, reconnect.
    - End show, press and hold to confirm.
7. **End.** The room closes (built). A thank-you screen for the artist.
8. **After the show.**
    - Summary: peak viewers, watch time, votes, tokens received.
    - Recording ready notification, set its visibility.
    - "Make a clip" prompt. Later, suggested moments from reaction peaks (needs reactions saved per artist first).

On iOS, camera capture stops when an app leaves the foreground. The performer and camera devices must stay in front for the whole show, and the app should warn before the artist switches away. That matches the 20 Sept audio and camera losses.

## Journey 7: adding a camera or an operator

A second phone becomes a camera by scanning one QR code. It needs no account of its own and shows nothing but its camera.

### Adding a camera

1. Settings, Devices, Add camera (or from Kit Check). The main device shows a QR code.
2. On the second phone: open the Loudentify app and tap "Use this phone as a camera" on the welcome screen. Scan the code. The phone pairs to the artist with a device credential (built on web).
3. The camera phone shows its viewfinder, role (main, side, close, wide), connection and ON AIR state, and a rotate control (built). The screen dims but stays awake.
4. Pick the role, set exposure, focus and zoom if wanted, and save it to the place.
5. Next time, opening the app on that phone reconnects it to the same slot. No re-pairing.

One rule from 20 Sept: one feed per physical device, using that device's own camera. The Sony external camera sharing a laptop was the one that stalled.

### Adding an operator (UI now, backend later)

1. Artist sends an operator invite link from the show, or from Settings, Devices.
2. The operator opens it on a laptop and gets the web console: all feeds, manual cuts, prompts, votes.
3. Go live and End show only if the artist grants them.

This is the laptop-plus-one-person setup behind the proposed training-data cohort. It is also what the 27 Sept show needed.

## Journey 8: wallet, tokens and cash out

Fans buy tokens on the web and spend them in shows. Artists see earnings in the app and cash out after an identity check. Money only flows one way.

### Fan

1. **Wallet (Profile, Menu).** Token balance and history. Built (ledger and UI scaffolding).
2. **Get tokens, on the web only.** At loudentify.app/wallet the fan pays through the payment provider. The balance then updates in the app.
3. **Spend in a show.** Support, pick an amount, confirm. A thank-you moment on screen, with no jackpot or slot-machine visuals.
4. **Limits.** Spending caps apply (AML). The fan can also set their own lower limit in Settings.

The native app has no buy button and no payment link. It shows balances only.

### Artist

1. **Earnings.** Tokens received, shown in pounds at the artist share (72.5%). Pending and available, then payout history.
2. **First cash out.** Identity check through the provider: legal name, date of birth, address, ID. Built as a stub gated on identity status.
3. **Payout account.** Held by the provider, never on our servers.
4. **Request payout.** Confirmation, then status in history.

### Competition prizes

Prize money arrives in the same earnings screen, labelled as a prize. Outcomes come from verified-fan votes, never token volume, because of the wash-gifting rule.

## Settings map

Settings holds every technical control as a saved default, in eleven groups. Audio, Camera, Direction, Studio library and Devices are the ones moved out of the show flow. Change a Status as things ship.

| Group | Setting | What it does | Status | Note |
| --- | --- | --- | --- | --- |
| Account | Edit profile | Opens your profile in edit mode | Built | |
| Account | Allowance and packs | Viewer-hours used and borrowed, show slots left, prepaid packs; buying happens on web | New | Prepaid packs per Chapter 6; subscription is a later strategic plan |
| Account | Become an artist | Viewers only. Adds a stage name and unlocks the console | Built | |
| Account | Password and passkeys | Change password, add a passkey | New | Change password may exist; confirm |
| Account | Log out everywhere | Ends every session | New | Optional in the August build; confirm |
| Account | Request my data | Download of profile, shows, wallet ledger, notifications | Built | |
| Account | Close my account | Soft delete: hidden profile, private recordings, ledger kept | Built | |
| Audio | Microphone | Pick the mic. Switching rewires the live mix, no logout needed | New | Agreed fix from 20 Sept |
| Audio | Mic health | Watches the raw mic level and repairs in place. Status only, no toggle | New | Agreed fix from 20 Sept |
| Audio | Vocal preset | Clean-up, compression and space, saved per place | Built | Pipeline built; this screen is New |
| Audio | Backing track balance | Track level against voice | Built | |
| Audio | Headphone latency check | Measures Bluetooth delay and shifts the backing track to match | New | Wired headphones still recommended for singing |
| Audio | Echo and noise processing | Kept off so music is not damaged. Not shown to users | Built | Stops designers adding a toggle |
| Camera | Exposure and focus lock | Set once per camera, reapplied at show start | New | Native only |
| Camera | White balance | Per camera | New | Native only |
| Camera | Zoom | Lens zoom per camera. Default 1.2x, editable (decided 30 Sept; never a digital crop) | New | Native only |
| Camera | Moving zoom and pan | Both are real settings, each with a duration (2s, 4s, 8s, or custom). Pan is off by default | New | Decided 30 Sept |
| Camera | Aperture | None | Removed | Fixed on phone cameras |
| Camera | Looks (LUTs) | Colour looks | Not at launch | Decided 30 Sept |
| Camera | Background blur | Simulated depth | Not at launch | Decided 30 Sept |
| Camera | Room and light check | Low-light warning and framing tips per place | New | Sells outcomes, not controls |
| Camera | Orientation | Portrait by default, rotate per camera | Built | |
| Direction | Auto director | On by default | Built | A cut-pace choice (calm, balanced, lively) would be New |
| Direction | Director moves | The artist switches each move on or off: cuts, close-ups, wide shots, moving zoom, pan, B-roll inserts | New | Decided 30 Sept |
| Direction | Manual cuts panel | Open or closed by default on the live console | Built | |
| Direction | Default cue sheet | Which cue sheet loads with a backing track | Built | |
| Direction | Versus active performer | Slot A switches who is featured | Built | Automatic switching Deferred. YouTube variant: artists switch views with Conversation and Perform buttons |
| Direction | Operator permissions | Who can cut, push prompts, end the show | Deferred | UI now, backend later |
| Studio library | Backing tracks | Upload, name, delete | Built | |
| Studio library | Cue sheets | Named and reusable across shows | Built | |
| Studio library | B-roll | 500 MB total, 100 MB per file, muted on upload | Built | |
| Studio library | Places | Saved bundles of mic, preset and cameras | New | |
| Devices | Paired cameras | Rename, set role, remove | Built | Built on web |
| Wallet and payouts | Payment methods | Held by the provider, managed on web | New | |
| Wallet and payouts | My spending limit | A personal cap under the platform cap | New | |
| Wallet and payouts | Payout account and identity check | Artists only | Built | Stub, provider not chosen |
| Notifications | Show reminders | 24h, 4h, 1h, 30m for artists; Remind me for viewers | Built | Viewer reminders New |
| Notifications | Followed artist goes live | Push | New | |
| Notifications | Messages and comments | Push | New | |
| Notifications | Email updates | Opt-in marketing | New | |
| Privacy and safety | Who can message me | Everyone, people I follow, nobody | New | |
| Privacy and safety | Blocked accounts and comment filter | Block people, hide chosen words on your shows | New | |
| Privacy and safety | Search history | Pause or clear | New | |
| Region | Country, city, time zone, language | Show times in local time; English at launch | New | |
| Help and legal | Help centre, report a problem | | New | |
| Help and legal | Terms and Conditions, Community Guidelines, Privacy, Artist agreement | | New | Artist agreement needs the training-data clause |

## Website

The website sells the idea in one screen, then gets people watching. Its most important page is the public show page, because that is the link artists share.

### Home page hero

Porcelain background with 2D animated objects in the accent colours: chat bubbles, a microphone, a scrolling feed, instruments, and artist images with musical themes. Brand system as set in July: Ink Black #011627, Porcelain #fdfffc, Teal #2ec4b6, Red #e71d36, Orange #ff9f1c, PT Sans Narrow.

- Artist images must be real artists who have agreed, not stock photos or AI images of real people.
- Animation respects the device's reduced-motion setting and never delays the page loading.
- A live strip under the hero shows real shows that are live now or starting soon, with "Watch in browser".

### Pages

| Page | Purpose | Main content | Your draft |
| --- | --- | --- | --- |
| Home | First impression and first watch | Hero, live strip, how it works for fans and artists, app badges | New |
| Live and upcoming | Public schedule, search engines, sharing | Every public show with its own page at loudentify.app/show/... | Added |
| For artists | Artist sign-ups | A production crew in your pocket, get heard, get paid, how a show works | Maps to "Product" |
| For fans | Fan sign-ups | Watch free, vote, support artists you love | Maps to "Product" |
| Pricing | Clear costs | Artists: free viewer-hours, then prepaid packs. Fans: watching is free, tokens explained plainly | In draft |
| Get the app | Installs | Store badges, QR code, "or watch in your browser" | "Loudentify App" |
| About | Trust | Story, the whale and what it stands for, team | In draft |
| Contact | Support and press | Form, email, press contact | In draft |
| Help | Self-service | FAQ, artist setup guides, report a problem | Added |
| Log in and sign up | Into the web app | Same fields and order as the app | In draft |
| Legal | Compliance | Terms and Conditions, Community Guidelines, Privacy, Cookies, Artist agreement | In draft, Cookies added |

The header shows Log in when signed out, and an avatar menu with Log out when signed in. The footer carries social links, legal pages and contact. A cookie banner is needed before any analytics or marketing cookies run.

## Open decisions

Everything raised so far is settled.

### Decided

| Question | Decision |
| --- | --- |
| Guest viewing and 18+ | Guests watch for up to 60 seconds in total, then a one-page sign-up rises over the video. Any interaction opens it sooner. Date of birth on that page is the 18+ gate. |
| "Random Jins" | It meant random joins by uninvited viewers. Dropped as a premium feature. Anyone can join any show, and the artist's viewer-hours are the only limit. |
| Feed previews and the allowance | A view counts toward the artist's viewer-hours after 30 seconds. |
| Go live now | No unscheduled shows. A show can only be booked for a start time at least 30 minutes away. |
| Hours running out mid-show | The show never cuts off. It borrows, and the upgrade offer comes after the show. |
| Subscription or packs | Prepaid packs. A subscription plan is a later strategic option, not a product feature now. |
| Paying from the native app | No payments in the native app. |
| Operator role | UI designed now. Ugo builds the backend afterwards. |
| "Discovery terms" | The general Terms and Conditions for using the app. |
| Reactions | On hold. Placement is agreed (a tab beside the emoji tab in the chat box); the reaction design waits until after the UI pass, as core product design. When reactions come back: behind a tab, every reaction costs an extra tap, and reactions are the free-vote half of blended scoring. |

### Decided on 30 September

| Question | Decision |
| --- | --- |
| Zoom | The lens does the zooming, never a digital crop, so picture quality is never traded away. 1.2x is the default, and the artist can set it anywhere the lens allows, per camera. |
| Moving zoom and pan | Both are real settings now, each with a duration (2s, 4s, 8s, or custom). Pan is off by default. |
| Director moves | The artist switches each move on or off: cuts, close-ups, wide shots, moving zoom, pan, B-roll inserts. The director only uses what is switched on. |
| Create button for viewers | Hidden. Viewers have nothing to create yet, so they see three tabs. Become an artist stays on their profile. |
| Messages at launch | Viewers and artists can both message, subject to the "who can message me" setting. |
| LUTs and background blur | Not at launch. Revisit after launch, when phone hardware has moved on. |

## Mobbin reference plan

References pulled from Mobbin on 29 September, and what each one shaped in the designs:

- **Sign-up:** monday.com, Fabric, Zocdoc, Strava. Full-width Apple and Google buttons with the logo left of the label, and a "by continuing" consent line.
- **Silk finish:** Givingli soft tonal cards, corner blurred colour background.
- **Kit Check:** Noom clear pass mark over the camera view.
- **Live console:** Yubo round controls above one main action, Substack LIVE badge and viewer count, Posh scheduled shows with Go Live.
- **Settings:** Box Box Club, Meetup, Lifesum, Ro. Grouped rounded cards, icon on the left, value and chevron on the right.

Design note: teal and orange text on the porcelain background fails contrast guidelines (roughly 2:1 against the 4.5:1 target). Use them as fills and accents with ink text, or as text on ink black, where they pass comfortably.

## Handover notes for Ugo

These are the build rules the journeys assume. The choice of native framework is Ugo's (or Claude Code's) and sits outside this doc.

- **Five states per screen.** Loading, empty, error, offline and success are designed for every screen in the Screen inventory, not just the happy path.
- **Owner and public mode are decided by the API.** Non-owners must never receive owner data that the screen then hides.
- **Links open the right place.** loudentify.app/show/..., /@username, /clip/... and /invite/... open the app when installed and the web otherwise.
- **Foreground rule.** Performer and camera devices stay in the foreground for the whole show. Warn before the artist leaves the app.
- **No payments in the native app.** No buy button, no payment link, balances only. Before release, check whether store rules allow the app to mention the website for top-ups at all.
- **Guest timer.** The 60-second preview counts total watching per device and is stored on the device. It is a nudge, not a security control.
- **Viewer-hours.** A view counts toward the artist's hours once it passes 30 seconds. When hours run out mid-show, the show carries on and borrows; the prepaid pack offer comes after the show.
- **Booking rule.** The earliest start time offered is 30 minutes from now.
- **Reactions.** Design on hold. Leave room in the chat box for a reactions tab beside emoji.
- **Instrument each journey step.** At minimum: sign-up started and completed (with what triggered it: the timer or an action), feed card seen, show joined and left, reminder set, Kit Check result per item, go live, end show, clip shared. Tie them to the viewer id we already use.
- **PRD check.** Each screen in the inventory has a PRD column to fill against Loudentify_PRD_User_Stories.xlsx, including the Scaling and Infrastructure tab.
