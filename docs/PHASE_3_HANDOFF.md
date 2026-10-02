# Phase 3 handoff: the artist experience and the live pipeline

2 October 2026. Branch `claude/overnight-build-2026-10-02`, same pull request into `staging` as Phase 2 (stacked). Plain English first.

## What works (and I ran it)

**No YouTube or LiveKit credentials exist, so everything below runs against two test doubles that behave like the real things:** a mock YouTube API (channels, broadcasts, streams, stream keys, ingest health, with the failure modes the architecture names) and a fake egress that takes the composed picture and writes one recording, one training copy and one "RTMP" file per broadcast from a single input. The switch to the real Google API and the real LiveKit egress is configuration (NEEDS_KOREY has the exact variables).

An artist signs up as a performer and gets six onboarding steps: photo/bio/genres; the plain-English artist agreement with the separate, on-by-default training-data line (recorded as a consent record and audited); **connect YouTube** (mock channel today; readiness checked at onboarding, never at show time); pick a mic and save the first place; pair a camera; book the first show.

**Schedule** enforces the 30-minute rule on the server, offers 15 to 90 minute lengths, and creates the YouTube broadcast at booking (chat disabled; stream key stored encrypted per artist in the identity schema, never on a client, never in a log). Reminders still in the future are written. Versus invites go through the pilot's slot mechanics with a new accept page; accepting creates the second channel's broadcast.

**Kit Check** shows the artist's own camera cropped to the three broadcast windows (conversation half, full performing frame, corner) with framing guides, and runs the checklist: raw mic signal, camera holding frames (two minutes, two stalls fail it), connection, charging, Do Not Disturb, headphones. Results are saved per item. Staying in Kit Check at slot time goes live automatically.

**The console** shows the countdown, then exactly the composed picture that goes out (same compositor module as the egress), the delivery state (DELIVERING / RECONNECTING / NOT DELIVERING with "recording continues"), the measured delay, comments, Prompt and Vote push, the Fix sheet (switch mic in place, recheck cameras, reconnect) and press-and-hold End show. For Versus: Conversation and Perform buttons; Perform while the other artist is on stage sends a stage request; the performing artist gets "Hand over the stage / Not yet"; the view is a show-level fact and every change is audited; viewers' pictures follow.

**Delivery failure handling** (tested with the doubles): when ingest drops, the same broadcast is retried three ticks, then a new broadcast is created on the same channel, the egress is retargeted, the old key rotated, and the viewer's embed moves to the new video. The recording never stops and the show is never ended by delivery trouble. A rejected stream key or a missing channel connection leaves the show running and recording with the delivery state honest.

**End show** stops the egress (recording and training copy finalised), ends every broadcast, rotates the keys, writes the recordings row (training copy only when the choice is on), computes insights (peak viewers, watch time, average stay, votes, tokens, followers gained, viewers per minute). **Post-show** sets Public / Unlisted / Private and offers Make a clip. **Clips** trim up to 90 seconds. **Insights** and **Earnings** (72.5% in pounds, pending vs ready, fans table, payout history, identity check stub) have their screens. The owner profile has the status strip, Schedule / Kit check / New clip, and the Shows / Clips / Upcoming / Insights tabs.

## How to try it

Locally (see PHASE_2_HANDOFF for the stack): sign in as a seeded artist (`synth-ama@synthetic.loudentify.invalid`, password `synthetic-pass`, local stack only), then `/artist/onboarding`, `/artist/schedule`, `/artist/kit-check?show=<id>`, `/artist/console/<id>`. The console's "Start a little early" works inside the 30-minute window; the booked slot can be moved with SQL for a quick test (the e2e does this). The seeded Versus show (`synth-live-versus`) is live: open its console as Kofi and Nia in two browsers.

Automatically: `npm run e2e` runs the viewer suite and then the artist suite (`tests/e2e/artist.e2e.mjs`, 8 steps) with a fake camera.

## What is stubbed, deferred or untested

- **Real YouTube API** (`GoogleYouTubeApi`) is written against the documented endpoints but has never been called: no credentials and no outbound network here. First real check is on staging after the OAuth client exists.
- **Real egress** (`LiveKitEgress`) refuses to start without credentials; the pilot's `/api/egress/start` (LiveKit room composite to S3) still exists and is untouched. Joining the two (RTMP output + file output from one composite) is the first task once a real broadcast exists.
- **Compositor in production** renders in the browser console today (artist's own camera + placeholder for the other artist); the server-side render of the other artist's feed needs the LiveKit room. The layout module is shared and tested; the pixels are not yet composed server-side.
- **Director integration**: the console shows "Director: Auto" but the AI director (lib/autoDirector.js, unchanged) still runs in the pilot console; wiring its shot decisions into the compositor's `sources` is next.
- **Identity check and payouts** are stubs; cash-out is gated on a status nothing sets yet.
- **Studio library attachments** on the schedule form link to the pilot console.
- **Operator role**: not built (Could; UI later).
- **Realtime push** of view changes to viewers is still polling (5 s on the show page, 3 s on the console).

## Test results

- `npm test`: 35 node tests pass (adds YouTube crypto/API/mock, compositor geometry, lifecycle incl. two failure drills, stage requests, booking rules).
- SQL: 3 suites pass (adds `phase3_access.sql`: identity schema unreachable, secret doors service-role only, status never returns tokens, broadcasts/stage requests/places/kit checks/clips/insights per role).
- Browser e2e: viewer 20/20 and artist 8/8 pass against a fresh build (fake GoTrue + real PostgREST + fake camera). The artist suite covers onboarding, scheduling, Kit Check (including a real 400 KB upload probe for the connection check), go-live with files on disk, prompt push seen by a viewer, end show with key rotation and insights, a clip, a Versus handover between two consoles, earnings and insights screens.
- Rollbacks for both migrations rehearsed down and up.

## Technical notes

PRD rows: 1, 2, 3, 4 (owner profile), 9, 10 (superseded by 115), 23 (console comments read), 111, 112, 114, 115, 116, 117, 118, 119, 120, 121, 122, 123, 124, 125 (beforeunload warning), 131 (not built), 132, 133, 134, 135, 136 (partly: copy only), 137, 138 (stub), 139, 140, 141, 142, 144 (measured delay), 146 (not built), 155 (legal-hold columns only). Scaling areas: Real-time media, Background jobs (lifecycle tick), Auth (OAuth grant), Observability (audit of every pipeline step).

Migrations: `20261002020000_phase3_identity_youtube_broadcasts.sql` (identity schema + doors, broadcasts, shows.delivery_state/measured_delay_seconds), `20261002020100_phase3_show_control.sql` (stage_requests, places, kit_check_results, clips, show_insights, recordings visibility/training/legal-hold columns). Code: `lib/youtube/*`, `lib/pipeline/*`, `lib/schedule.js`, `lib/insights.js`, `app/api/artist/**`, `components/artist/*`, pages under `/artist/*` and `/profile`.
