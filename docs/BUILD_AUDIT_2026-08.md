# Build Audit — August 2026

**As of**: `main` @ `3b80017` (2026-08-19). Read-only ground-truth inventory — no code changes made while writing this. Feeds PRD reconciliation and investor/visa material. Overstating completion is worse than a gap, so status labels below are conservative and every claim carries a file:line citation.

Status legend: **BUILT+VERIFIED** (built, confirmed on a real device this month) · **BUILT-UNVERIFIED** (built, only build/sandbox-checked) · **PARTIAL** (some real gap or missing piece, cited) · **NOT STARTED**.

---

## A. Feature Inventory

### Show lifecycle — PARTIAL
State model: `shows.state` only ever stores `'scheduled' | 'soundcheck' | 'ended'` — `'live'` is *derived*, never stored (`lib/showState.js:5-6,12-18`). 30-minute soundcheck window (`lib/showState.js:20`).

All transitions are written **client-side**, directly against the anon-key Supabase client: `handleGoLive` (`components/LiveDemo.jsx:494-512`), `handleClaimAndGoLive` (`:520-558`), End Show (`:1745-1757`). No server-side admin route ever writes `shows.state`.

**Gap, explicitly acknowledged in the spec** (`SHOW_LIFECYCLE_SPEC.md:78-80`): *"open update policy = anyone with the anon key could flip state. Acceptable for a 40-person pilot with no money attached; goes on the open-items list with the RLS tightening + auth work post-pilot."* `shows` RLS is enabled but every policy is `using(true)` (read/update/insert) — functionally open.

### Performer join + slot claim — BUILT, with a real (different) bypass
`app/api/performer/claim-slot/route.js:17-127` — case-insensitive code lookup, email normalized `.trim().toLowerCase()`, identity minted as `contestant-{slot}-{randomUUID}` (never derived from name/email, `:60-67`), `session_token` rotated on every claim, re-claim by a different email allowed with a non-blocking warning.

**Solo vs. versus use the identical claim-slot flow** — there is no separate/hardcoded solo scheme in the claim path itself. `performanceMode` only changes UI: solo hides the `camfeed-b` join option and hardcodes `blurFillSlot = 'a'` for the background-blur layer (`components/LiveDemo.jsx:2471,2479` — comment explains this is deliberate, not "each performer sees their own"). This is cosmetic, not a security bypass.

**The real hardcoded/legacy bypass is elsewhere**: `app/api/token/route.js`'s `?contestant=a|b` query param grants publish rights directly with no code at all, gated only by a same-name collision check against the live LiveKit participant list (`:34,56-74`). Explicitly flagged in-code: *"this direct path still works unmodified (accepted-not-solved bypass, not fixed here)"* (`token/route.js:58-62`), and `MULTI_PERFORMER_SPEC.md:23-30`: *"a client could still call it directly and claim a slot with no code. Accepted, not solved, for this pilot."* The current UI never routes performers through this path — only viewer/camfeed joins use it — but the endpoint remains reachable by anyone who knows the URL shape.

### Multi-camera camfeeds — BUILT+VERIFIED (this session)
Camfeed join via role+camRole select or QR (`components/CameraQRPanel.jsx`, `components/CamPage.jsx:155`), identity `camfeed-{slot}-{role}-{ts}-{name}`. Candidate enumeration via `tracksForSlot`/`availableRoles` (`components/LiveDemo.jsx:1786-1831`, muted tracks excluded). Feed picking for a slot: `VideoDeckPanel.jsx` — explicitly labeled a placeholder ("simple timed rotation, not an AI-directed cut", `VideoDeckPanel.jsx:8-14,67-68`), 8s auto-rotate. Viewer-side resolution in `renderSlot` (`LiveDemo.jsx:1931-1940`) with fallback to contestant track → first candidate.

### Auto director — BUILT-UNVERIFIED
`lib/autoDirector.js` — fixed choreography (`CYCLE_PATTERN`, not weighted-random), scans forward for the next live step that changes the actual feed vs. `getCurrentFeed()` (`:145-197`), technique (zoom/pan) substitution gated by a cooldown, single-camera mode uses a themed zoom/pan instead of faking a cut (comment `:182-188`, "never fake multi-shot with a flat crop-cut"). Public API `start/suspend/resume/enable/disable/stop`, `state` → `off|suspended|running`. CD-4 removed the old fixed-cooldown override — a human tap no longer touches auto's schedule at all; auto's next cut fires on its own clock and silently overwrites the tap (comment `:5-19`). One forward-looking deferral noted in-code: *"Layer 2 upgrade path: replace the randomised hold timing with beat-aware timing from audio analysis"* (`:29-30`).

### Manual direction — BUILT+VERIFIED (this session)
Button tap → `resolveSourceRole` → `resolveTargetIdentity` → `buildShotCommand` → `broadcastShotCommand`, carried over a LiveKit **reliable data channel** (`publishData(..., {reliable:true})`, `lib/shotCommands.js:104-141`), received via `useDataChannel` and matched against live tracks in `renderSlot`. Every command also fire-and-forget logs to the `shot_commands` table.

### Cue-Sheet Director — BUILT+VERIFIED (this session), one phase-1 deferral by design
- **Data model**: cue = `{timestamp_ms, shot_type ∈ SHOT_KEYS, slot_role ∈ [main,wide,close,side], motion?}`, `motion.scale` clamped (not rejected) to `1.2`. Keyed on `(track_hash, artist_email)` — `track_hash` a client-side SHA-256 of the raw audio bytes, `artist_email` the unauthenticated entry-gate email. **This replaces the earlier `(show_id, slot)` phase-1 keying** — the migration (`docs/cue_sheets_migration_v2.sql`) drops those columns outright.
- **Playback clock**: never wall-clock — polls `getPlayerState()` every 200ms, seek-detected via a 750ms tolerance against expected elapsed time (`lib/cueDirector.js:12-17,174-183`).
- **Editor**: shot/role/pan-direction/dolly-vertigo/scale fields, ±100/1000ms nudge buttons, delete, save. No drag-to-reposition, no multi-select, no undo — nothing beyond nudge buttons and direct field edits exists.
- **Mode control**: three-state Manual/Auto/Cue in `DirectorShotPanel.jsx`, Cue segment disabled (not hidden) until a saved sheet with ≥1 cue exists for the loaded track+artist. `applyMode` in `LiveDemo.jsx:2309-2317` — confirmed rendering and switching correctly on the merged main (verified live, see §E).
- **Fallback behaviour**: `hold_last` (no shot fired) / `default_wide` / `auto_director` — the latter two both currently resolve to `'wide'`. **`'auto_director'` is deliberately deferred**, quoted verbatim (`lib/cueDirector.js:31-42`): *"handing playback control back to the real autoDirector instance for just this gap is a real design ... that belongs with CD-4, where cue/auto/human precedence gets designed as one system, not improvised piecemeal here."* Logged under its own reason string, `'auto_handback_deferred_phase1'`, specifically so this reads as a deferral in the health-event timeline rather than a silent alias.

### Audio pipeline — BUILT-UNVERIFIED, with two documented open conflicts
- **Signal chain** (`lib/audioProcessing.js:28-173`): raw mic (all browser audio processing disabled) → input gain → 80Hz highpass → compressor (-24dB/3:1) → +4dB makeup → parallel dry/wet into a synthetic 1.4s reverb (mix 0.12) → output. A locked "Preset sound" is the default; "Manual mix" unlocks live tuning of every stage.
- **Effects bypass, default OFF**: a parallel raw tap crossfades against the processed path. Verbatim (`audioProcessing.js:88-91`): *"Pilot default is effects OFF ... a safety valve because the preset can't be tuned before pilot, not a conclusion that processing is wrong in concept."* No comment anywhere states the preset actually sounds bad — this is an untested-preset marker, not a quality complaint. [[post_pilot_audio_preset_tuning]] tracks the open question of whether the preset itself needs retuning once real feedback exists.
- **Open conflict #1**: `audio={false}` on `<LiveKitRoom>` (needed so LiveKit doesn't grab its own raw mic track over the processed one) causes LiveKit's own `SignalConnected` handler to mute the manually-published track on every reconnect. `ensureAudioPublished` re-asserts republish+unmute after the fact — a workaround, not a structural fix (`LiveDemo.jsx:1523-1553`).
- **Open conflict #2, explicitly deferred by design**: a manual reconnect-recovery cycle (built to fix video-shot delivery) unpublishes the processed audio track and nothing republishes it. Verbatim (`LiveDemo.jsx:1249-1258`): *"Known, accepted side effect this round ... A recovery here can therefore interrupt audio as a side effect of fixing video-shot delivery. Not fixed in this round by design."* Confirmed via a real capture showing `track_local_unpublished` with nothing following it.
- **Backing track playback**: confirmed no `<audio>`/HTMLMediaElement — custom `AudioBufferSourceNode` + `requestAnimationFrame` polling clock (`components/BackingTrackPanel.jsx`).
- **Audio sync calibration** (`lib/audioSyncCalibration.js`): 12-click train, RMS+spectral-gated "Bah" onset detection, median-offset compensation applied only to the published backing-track branch. Self-documented limit, verbatim (`:9-12`): *"this removes ~70-90% of the delay, leaving a ~20-40ms residual floor ... it physically cannot beat. Success is 'most listeners won't consciously notice', not perfect sync."*

### Session recovery — PARTIAL, gap explicitly stated in code
There is **no app-level session recovery**. `sessionStorage` is used only to *label* health-log events `mount` vs `recovery` — verbatim (`LiveDemo.jsx:210-212`): *"used ONLY to label the reason; it does not restore any session state -- Phase 1 confirmed nothing does."* A full page refresh loses all React state and sends the user back to the join gate; claim-slot's non-blocking rejoin tolerance is what makes that survivable for a performer specifically. Real reconnect handling *does* exist, but only at the LiveKit engine level (`RoomEvent.Reconnecting/Reconnected`, `attemptPublishRecovery`, a manual Reconnect button) — that recovers the media connection, not interrupted join/app state.

### Desktop portrait layout (artist + viewer) — BUILT+VERIFIED (this session, including today's fix)
Gated at `min-width: 1025px` both in CSS and via `useIsDesktopViewport` in JS. Artist (`BroadcastStage.jsx`): two fixed docked columns replace the mobile tabbed deck — left holds Shots+Audio stacked, right holds the camfeed picker; mic/cam/flip/leave and Comments stay in their mobile positions by design. Viewer (`ViewerStage.jsx`): shares the same stage shape, no technical-control columns; the artist's right-column slot is instead `LiveShowRail` (viewer-only).

**Fixed this session**: `.desktop-side-column--left` (left:24px) had no offset for the app's persistent nav sidebar, which the live-mode CSS takes out of flex flow (`position:fixed`) without compensating `.page-shell-main`'s width — confirmed via `getBoundingClientRect` showing both at x:0–232, garbled overlapping text and (for anything under that x-range) an unclickable sidebar-nav layer sitting on top of the Shots panel's static-shot buttons. Fixed via a `--sidebar-width` CSS var (232px/0px) set from the existing `sidebarCollapsed` state, offsetting the column to sit beside the sidebar instead of under it. Committed `3b80017`, re-verified clean on a fresh preview before pushing to main/production.

**Known incomplete piece**: the viewer's "Live Show Discovery Rail" (`components/LiveShowRail.jsx`) is a real skeleton, not a UI polish gap — its data source `getAdjacentLiveShows()` unconditionally `return []` (`lib/liveShowDiscovery.js:14-16`), so it renders nothing in real use; it only shows content behind a `?demoRail=1` fixture flag. `switchToLiveShow()` is a stub that only `console.log`s, tagged `TODO(live-show-discovery)`. The planned mobile "channel surf" surface is explicitly not started (`LiveShowRail.jsx:27-34`).

### Reactions — NOT STARTED
Despite the filename, `components/reactions.css` (2288 lines) is general live-stage/comments/deck CSS, not a reactions feature — repo-wide search for `reaction`/`emoji-tap`/`floatingReaction` returns no component or logic. `MULTI_PERFORMER_SPEC.md:56` lists "reaction replay" explicitly out of scope. What exists instead is an emoji *picker* used only to insert characters into comment text (`components/CommentsPanel.jsx:3-4,97-124`), not a tap-to-react overlay.

### Comments — PARTIAL (functional, no persistence)
Transport is a LiveKit data-channel broadcast (`{type:'comment', comment}`), not Supabase and not an API route — appended to local React state on receipt (`LiveDemo.jsx:1659-1666,1763-1774`). **No `comments` table exists anywhere** in the migrations or codebase; comments live only in memory and vanish on refresh or reconnect, with no historical fetch. Shared `CommentsDock.jsx` between artist and viewer; only real difference is a bottom-offset prop so it clears the artist's deck. Recent commit history (`4c62ca2`, `2bcb7f8`, `11ce0de`, `86126d4`) shows a "comments minimize" bug sequence that reads as resolved — no outstanding TODOs found in these files.

### Questionnaire — NOT STARTED
Repo-wide case-insensitive search for `questionnaire`/`survey`/`feedback form`/`poll` (excluding unrelated "polling"-for-status-refresh usages) returns zero hits. `MULTI_PERFORMER_SPEC.md:55` lists "fan voting, scoring" explicitly out of scope for the current build round. No component, route, or table exists for this anywhere.

### Egress / recording — BUILT-UNVERIFIED, explicitly self-flagged as unproven
LiveKit Room Composite Egress (`app/api/egress/start|stop/route.js`), not a custom recorder — outputs MP4 to an S3-compatible bucket (Supabase Storage), pointed at the app's own `/egress` route so the recording reuses the real directed view rather than LiveKit's stock grid template. Triggered fire-and-forget from the show lifecycle (`LiveDemo.jsx:148-171`), never awaited. **There is no UI anywhere to list, view, or download a recording** — it exists only in the S3 bucket / LiveKit's own dashboard.

Explicitly self-flagged as not yet proven, verbatim (`components/EgressPage.jsx:64-75`): fires *both* a `console.log` and a `CustomEvent` because *"the EXACT contract ... isn't independently verifiable from the local SDK alone ... Confirm against a real recording once tested; drop whichever one turns out unnecessary."* Stop route notes there's no webhook wired up to learn the real outcome (`stop/route.js:42-49`). [[egress_recording_plan]] — the staged verification plan (prove basic grid egress before the custom shot-directed template) has not yet been executed against this code.

### Health-event instrumentation — BUILT+VERIFIED (fail-silent design confirmed)
See §D for the full 51-event enumeration. Client queues in-memory, flushes ≤1/sec, drops after 200 queued, every call wrapped in try/catch, drains via `sendBeacon` on `pagehide`. Drops silently before `initHealthLog` sets a show context.

### Token/auth model — NOT BUILT (no real auth exists; explicitly out of scope by design)
`app/api/token/route.js` issues LiveKit tokens keyed on a client-supplied, unverified `identity`. No password/session/account system exists anywhere — `components/Auth.jsx` is explicitly labeled *"Mock sign in / sign up"*; `lib/mockAccount.js:3-8` states *"this pilot has no auth or persistence backend, so 'who am I' (fan vs artist) lives in localStorage only."* No `middleware.js`, no `supabase.auth` usage anywhere. Explicitly out of scope per both specs: `SHOW_LIFECYCLE_SPEC.md:15-18` ("real authentication on the Go Live button, token signing/expiry hardening" — post-pilot) and `MULTI_PERFORMER_SPEC.md:55-58` ("any auth beyond the codes" — out of scope for the build round).

---

## B. Data Model

All tables below were found either in `docs/*.sql` migrations or via direct `.from('...')` usage in code — this list is a complete enumeration, not a sample.

| Table | Purpose | Key convention | RLS |
|---|---|---|---|
| `shows` | Show lifecycle state | `state ∈ {scheduled, soundcheck, ended}`; `'live'` is derived, never stored | Enabled, but every policy is `using(true)` — functionally open (`SHOW_LIFECYCLE_SPEC.md:78-80`) |
| `participants` | Join records (email, role, consent) — first table holding real PII | `(show_id, email)` | Enabled, **zero policies** — anon key has no access, server-role only |
| `show_slots` | Performer-code claim state | `(show_id, slot)` composite key; `session_token` rotates per claim | Enabled, **zero policies** — this is the entire security boundary the code-claim system rests on |
| `shot_commands` | Flywheel log of every fired shot command | `show_id` here is the **room_name text string**, not `shows.id` UUID — a divergent convention from every other table, flagged explicitly in `app/api/show/active-performer/route.js:9-11` | Has a genuine **insert policy** (not zero-policy) since the anon client writes here directly — the one table that actually needs and has a real RLS rule |
| `health_events` | Instrumentation log | `event_type` free-form string, `detail` jsonb | Migration SQL has no `enable row level security` line at all (unlike `cue_sheets`, which does) — worth reconciling as an inconsistency, though access is service-role only in practice |
| `cue_sheets` | Cue-sheet authoring/playback data | **v2**: unique on `(track_hash, artist_email)`, replacing v1's `(show_id, slot)` — `show_id`/`slot` columns dropped outright, not left nullable | Enabled, zero policies, service-role only |

**Client split**: `lib/supabaseAdmin.js` (service-role, server-only, bypasses RLS) is used exclusively inside `app/api/*` routes. `lib/supabaseClient.js` (anon key) is used client-side for `shows` reads/writes and the one `shot_commands` insert path — the only two tables the browser ever touches directly.

---

## C. Known Debt & Deferred

1. **Show-state writes are unauthenticated** — anyone holding the anon key can flip `shows.state`. Accepted explicitly for pilot scale (`SHOW_LIFECYCLE_SPEC.md:78-80`).
2. **`?contestant=a|b` token bypass** — grants performer publish rights with no code via `app/api/token/route.js`, gated only by a name-collision check. Accepted-not-solved (`token/route.js:58-62`, `MULTI_PERFORMER_SPEC.md:23-30`). Not the same thing as a "Solo legacy scheme" — solo and versus share the identical claim-slot flow; this bypass is mode-independent.
3. **Audio publish/reconnect conflict** — `audio={false}` + LiveKit's own `SignalConnected` mute handler fights the app's manual-publish pattern; `ensureAudioPublished` is a repeated workaround, not a structural fix (`LiveDemo.jsx:1523-1553`).
4. **Manual reconnect-recovery can silently drop audio** — deferred by design this round in favor of fixing video-shot delivery (`LiveDemo.jsx:1249-1258`).
5. **Cue-sheet keying is now `(track_hash, artist_email)`**, not the old `(show_id, slot)` — noted here because the old assumption is stale as of the CD-3 merge; flagging so PRD reconciliation doesn't cite the outdated scheme.
6. **`'auto_director'` cue fallback deferred** — currently behaves identically to `'default_wide'`; real cue/auto/human precedence design is intentionally deferred, logged under its own `'auto_handback_deferred_phase1'` reason string so it never reads as a silent alias (`lib/cueDirector.js:31-42`).
7. **No app-level session recovery** — a page refresh loses all join state; only the LiveKit media connection recovers automatically, not the app session (`LiveDemo.jsx:210-212`).
8. **Egress unproven** — no webhook confirms real upload success/failure; the recording-contract event name itself is dual-fired pending confirmation against a real test (`EgressPage.jsx:64-75`).
9. **No comments persistence** — comments live only in in-memory React state over a LiveKit data channel; a refresh loses them, and there's no historical record.
10. **Live Show Discovery Rail is a skeleton** — data source hardwired to return empty; only demo-flag fixtures render anything; `switchToLiveShow()` is an unimplemented stub.
11. **`health_events` migration has no RLS-enable line**, inconsistent with `cue_sheets`'s migration which does — worth reconciling even though practical access is already service-role-only.
12. **Audio preset quality is untested, not confirmed bad** — the effects-bypass default-off is framed in-code as a safety valve for an untuned preset, not a verdict that the processing itself is wrong. [[post_pilot_audio_preset_tuning]] — this remains an open question pending real listener feedback, not resolved by this audit.

---

## D. Instrumentation Map

All 51 `logHealthEvent()` call sites (`lib/healthLog.js` batches, flushes ≤1/sec, `sendBeacon` drain on `pagehide`, fail-silent throughout):

| event_type | Emitted by | Key detail fields |
|---|---|---|
| `cue_sheet_saved` | AudioDeckPanel.jsx:232 | trackHash, cueCount |
| `mst_ended` / `mst_muted` / `mst_unmuted` | LiveDemo.jsx:192-194 | which, trackId |
| `ensure_audio_published` | LiveDemo.jsx:914,923,930,965,967 | trigger, action, error? |
| `audiocontext_statechange` | LiveDemo.jsx:951,1582 | state |
| `room_connected` | LiveDemo.jsx:1009 | state |
| `room_reconnecting` | LiveDemo.jsx:1010 | state |
| `room_reconnected` | LiveDemo.jsx:1013 | state |
| `room_disconnected` | LiveDemo.jsx:1022 | state, reason |
| `room_connection_state_changed` | LiveDemo.jsx:1023 | state |
| `track_local_published` / `track_local_unpublished` / `track_published` / `track_unpublished` / `track_subscribed` / `track_unsubscribed` / `track_muted` / `track_unmuted` | LiveDemo.jsx:1033-1040 | trackDetail(pub, participant) |
| `room_state_at_mount` | LiveDemo.jsx:1059 | state |
| `visibility_hidden` / `visibility_visible` | LiveDemo.jsx:1094 | — |
| `page_hide` / `window_focus` / `window_blur` | LiveDemo.jsx:1098-1100 | — |
| `publish_recovery_attempt` | LiveDemo.jsx:1266 | trigger, connectionState |
| `publish_recovery_outcome` | LiveDemo.jsx:1270,1283 | trigger, outcome, connectionState, error? |
| `health_probe_episode_started` | LiveDemo.jsx:1312 | — |
| `audio_devicechange` | LiveDemo.jsx:1368,1370 | audioInputs |
| `mic_level_sample` | LiveDemo.jsx:1407 | outputRms, inputRms, audioContextState, deviceId, deviceLabel |
| `mic_silent` | LiveDemo.jsx:1420 | outputRms, inputRms, audioContextState, silentSinceMs |
| `mic_recovered` | LiveDemo.jsx:1429 | outputRms, inputRms, audioContextState, silentDurationMs |
| `signal_connected` | LiveDemo.jsx:1544 | occurrence |
| `audio_publish_attempt` | LiveDemo.jsx:1595 | — |
| `audio_publish_success` | LiveDemo.jsx:1600 | durationMs |
| `audio_publish_failure` | LiveDemo.jsx:1602 | error |
| `director_shot_emitted` | LiveDemo.jsx:2156 | shot detail |
| `director_loop_stopped` | LiveDemo.jsx:2287,2395 | reason (unmount \| show_ended) |
| `mode_changed` | LiveDemo.jsx:2316 | mode |
| `director_heartbeat` | LiveDemo.jsx:2328 | state |
| `director_loop_started` | LiveDemo.jsx:2390 | reason |
| `director_suspend` / `director_resume` | LiveDemo.jsx:2604 | — |
| `shot_publish_success` | lib/shotCommands.js:116 | commandId, shot, slot, decisionSource, connectionState |
| `shot_publish_failure` | lib/shotCommands.js:125 | + error |
| `health_probe_publish_success` | lib/shotCommands.js:163 | connectionState |
| `health_probe_publish_failure` | lib/shotCommands.js:166 | connectionState, error |
| `cue_fired` | lib/cueDirector.js:112 | sheetId, timestampMs, shot, slotRole, resolvedTarget |
| `cue_fallback` | lib/cueDirector.js:131,140 | sheetId, cueTimestampMs, slotRole, fallbackBehaviour, reason, resolvedTarget? |
| `cue_seek_detected` | lib/cueDirector.js:175 | sheetId, fromMs, toMs |
| `cue_playback_started` | lib/cueDirector.js:200 | sheetId, cueCount |
| `cue_playback_stopped` | lib/cueDirector.js:208 | sheetId |

---

## E. Verification Status

Real-device/browser test evidence this month vs. build/sandbox-only:

**Verified live this session (browser automation, real join/publish/render flow, not just `npm run build`)**:
- Desktop portrait layout docked panels — rendered, then the sidebar-overlap regression was found, root-caused via `getBoundingClientRect`, fixed, and re-verified clean on a fresh preview (§A, desktop portrait layout).
- Cue-sheet editor — track upload → hash → cue drop → marker render → shot/role assignment, confirmed end-to-end.
- Three-state Manual/Auto/Cue mode control — confirmed rendering and default state.
- Manual direction / shot commands — confirmed via multi-camera device proof earlier this round (per the bug-report round's health-events capture showing correct `resolvedTarget`s for non-main roles).
- Cue playback resolution bug (framingHint/sourceRole vocabulary mismatch) — root-caused and fixed, verified via a standalone reproduction script against the real resolution functions.

**Build-verified only (compiles, sandbox-rendered, not confirmed against real hardware/network conditions this month)**:
- Auto director's actual choreography timing/technique selection in a live multi-performer show.
- Audio pipeline's processed signal quality (compressor/reverb/highpass parameters) — never listened to by a real audience; the effects-bypass-default-off posture exists precisely because of this gap.
- Audio sync calibration's real-world Bluetooth-delay compensation accuracy.
- Egress recording — the record/stop API calls execute, but no completed recording has been confirmed to actually contain correct audio/video end-to-end (no webhook, no playback UI to check).
- Session-recovery behavior under a real dropped connection in front of a live audience (LiveKit-engine-level reconnect only; no app-level session state recovery exists to test).

**Not tested in any form**:
- Show-state security exposure (open `shows` RLS) — a known, accepted gap, not something to "test" so much as harden later.
- `?contestant=a|b` token bypass — known reachable, not attempted as an actual exploit in this audit.

---

## F. Incident account — the audio-only recordings / poisoned publisher saga (2026-08-18 → 08-21)

Added 2026-08-21, after the fix was verified in production. Kept because the *shape* of this investigation is the reusable lesson, not just its conclusion: four separate hypotheses were disproven before the real cause was found, and two of them were disproven only by reading the SDK's own compiled source rather than trusting its documentation or release notes.

### F.1 Symptom as first reported

Production recordings came back **audio-only — no usable video** for both solo and versus layouts, starting ~2026-08-20. The same pipeline had produced correct recordings on 08-18. Three merges landed on `main` in that window: desktop portrait layout, cue director, and the Accounts & Identity arc.

### F.2 Hypotheses raised and killed, in order

1. **Desktop CSS leaking into the egress template.** Killed: the egress render path renders at 1080x1920 (above the `min-width: 1025px` desktop breakpoint), but none of the new desktop rules touch classes the egress DOM uses, and `EgressPage.jsx` had not changed since 08-14.
2. **LiveKit-side configuration drift.** Killed: the dashboard records for a working 08-18 egress and a failing 08-21 egress are configuration-identical — same `customBaseUrl`, same 1080x1920, same request shape, both `COMPLETE`.
3. **Token/auth regression from the Accounts arc** (the `?contestant` bypass closure, role gating). Killed **structurally**: `components/EgressPage.jsx:258-276` reads `url`/`token` from `useSearchParams()` — LiveKit's Egress service mints its own recorder token and appends it. The egress template *never calls* `/api/token`, sends no cookie and no `Authorization` header. Our token changes cannot reach it. Corroborated positively: room-composite egress captures the headless browser's own audio output, so audio in the file proves the page loaded, connected, and subscribed. A token failure yields a **silent** file, not an audio-only one.
4. **Identity-format change breaking egress track matching.** Killed: `app/api/performer/claim-slot/route.js:80` still mints `contestant-${slot}-${uuid8}`, prefix deliberately preserved; `tracksForSlot` (`components/EgressPage.jsx:90-97`) still matches. Confirmed in the *deployed* bundle, not just source.

### F.3 Actual root cause

**An ungated `publishData` at the go-live moment, racing the room connection.**

The SHOW_LIVE broadcast effect (`components/LiveDemo.jsx`, the `showLiveBroadcastSentRef` effect) gated only on `isMainPerformer && showState === 'live'` — the *clock-derived* state — with **no connection gate**. It therefore fired the moment the device's own clock said "live", which in practice was up to ten seconds before `room_connected`.

`SHOW_LIVE` is itself a `publishData`. Publishing before the publisher transport exists hits an absent `pcManager`, and that is where the LiveKit SDK turns a transient race into a permanent outage:

- `RTCEngine.ensureDataTransportConnected()` throws `UnexpectedConnectionState('PC manager is closed')` when `engine.pcManager` is falsy (`livekit-client` 2.21.0, `dist/livekit-client.esm.mjs`).
- `RTCEngine.ensurePublisherConnected()` **memoizes** that attempt in `publisherConnectionPromise` and **never clears it on rejection**. The only reset is inside `pcManager.onStateChange` — which can never fire for an attempt made when `pcManager` never existed.
- `cleanupPeerConnections()` nulls `pcManager` but does **not** clear the memo.
- `Room.maybeCreateEngine()` reuses the existing engine whenever it is `!isClosed`, and a **mid-connect engine is not closed** — so a recovery (`disconnect()`/`connect()`) fired while a connect is still in flight hands the *same poisoned engine* to the connection that eventually succeeds.

Net effect: one early publish poisons every subsequent `publishData` on that connection **for the life of the connection**. Every directed cut fails. The recording therefore captures audio (subscribed, unaffected) with a video layer that never receives a shot command — the reported symptom.

This also explains why the failure looked deterministic rather than racy: it was the same line of code, at the same moment, every show.

### F.4 Why it presented as "new" on 08-20

It was not new. The ungated SHOW_LIVE publish predates all three merges. What changed is that the Accounts arc moved the performer onto the `claim-slot` path, altering start-sequence timing enough to make the race land consistently on the losing side. The earlier investigation's instinct — "the variable is what production served the headless browser" — was correct in method but pointed at the wrong layer: the variable was *when* the artist's device published, not what the recorder was served.

### F.5 Fixes shipped

- **`1361fb1` (b3)** — `lib/transportDiagnostics.js`: a fully defensive snapshot of publisher-transport readiness (`hasPcManager`, `publisherPromiseSet`, `verifyTransport`, `pcState`, ICE states, signal WS). Reads SDK-internal fields deliberately, isolated in one file, degrading to `{available:false}` rather than ever throwing on the show path. Wired into `room_connected`, `room_state_at_mount`, `room_disconnected`, `signal_connected`, `director_loop_started`, `shot_publish_failure`, and `ensure_audio_published`. **This instrumentation is what found the real cause** — `connectionState` alone reads `"connected"` throughout the poisoned case and could never distinguish it from a network fault.
- **`fe85802` (b1, b2)** — a pre-flight probe that exercises the exact `publishData` path before the director starts and before egress is told to record, so a poisoned engine is detected and repaired pre-recording; plus `recoveryAttempted` reset per *episode* rather than per *mount* (it had been set once and reset nowhere, so the first bad moment of a show consumed its entire automatic-recovery budget).
- **`943b83e` (b6)** — the actual root fix. The connection wait moved *inside* `runStartPreflight` (a caller that forgets to gate is exactly what went wrong); the SHOW_LIVE/egress effect gated on `roomConnectionState === Connected`; and `attemptPublishRecovery` made to refuse to run unless Connected, so a recovery can never race a connect and inherit the poisoned engine.

**Interim regression worth recording honestly**: the b1 pre-flight, before b6 sequenced it, ran ~10s early and *became* the poisoning publish itself — it made the pre-existing race worse before it made it better. It also made it legible, which is how the root cause was found.

### F.6 Verification

Production show 2026-08-21 16:37, against deployment `dpl_69VoQ9KQfEX83wQ3N4MR33g3GdxC` (commit `943b83e`): `room_connected` 16:37:14.885 → `start_preflight_begin` +1ms → `outcome:"clean"` (52ms probe) → `director_loop_started {preflight:"clean"}` → video published → **zero publish failures, zero recoveries across the whole show**.

**Recording CONFIRMED** on playback: video present from second zero through to the end. This closes the original symptom that opened the investigation on 08-18 — the audio-only recordings — and the saga with it.

Subsequently re-verified on `livekit-client` 2.22.0 (commit `2a0f4dd`): pre-flight clean, zero recoveries. The upgrade does not fix the memo bug (see F.7.3), so b1/b6 remain load-bearing; it was landed for its adjacent publish-path recovery work.

### F.7 Process lessons

1. **A local commit with a green build is not shipped.** One verification show was wasted running against a 16h-old deployment because the fix was committed but never pushed or deployed. Deploys here are manual `vercel --prod`. The standing rule now is: push → deploy → confirm alias → **grep the served bundle for the change, and inspect the minified region around the changed call site to confirm wiring**, before asking anyone to run a verification show.
2. **Don't ship a dependency upgrade alongside the fix under test.** The `livekit-client` 2.22.0 trial was deliberately parked on branch `b5-livekit-2.22` so the verification show measured b6 alone.
3. **Read the SDK, don't trust its release notes.** 2.22.0's notes advertise "recover broken publish paths", which sounds like this bug. Reading the source showed `ensurePublisherConnected` is byte-identical to 2.21.0 — the memo bug is unfixed, and the pre-flight remains load-bearing.

---

## G. Planned architecture & backlog

Added 2026-08-21. Design decisions taken but not yet built, in intended build order.

### G.1 Broadcast window — local-only mode outside the show window

**Planned for: the show-scheduling round.** Foreshadowed by fix 1d (End Show now unpublishes the camera track, not just the audio one) and by the observation that stopping *transmission* and stopping the *device* are two different things.

**The rule**: publishing to LiveKit happens **only** between Go Live and End Show. Outside that window the artist's device is fully functional locally — camera preview, mic, the whole Web Audio graph, meters, effects, soundcheck monitoring — with **zero** tracks published and, ideally, no room connection at all.

**Rationale**:
- **Cost.** LiveKit is billed on connected participants and published minutes. Today a performer who joins early to check levels burns credits for the whole pre-show period. Under a broadcast window, credits are spent only on the actual show.
- **Product.** Artists get unlimited tech-check — mic check, framing, effects tuning, backing-track levels — at no marginal cost, which makes "arrive early and get comfortable" the encouraged behaviour rather than an expensive one.
- **Privacy.** It makes the End Show audio/camera leaks (fixes 1a-1d) structurally impossible rather than individually patched: if publishing only ever happens inside the window, there is no "still transmitting after the show" state to leak from.

**Boundary note**: the b6 pre-flight gates the **transmission boundary**, not tech-check start. Tech-check needs no publisher transport at all, so it must not wait on — or be blocked by — the pre-flight. The pre-flight belongs exactly where it is now: at Go Live, immediately before the first publish.

**Open design questions**: whether the device connects to the room at all during tech-check (no-connect is cheapest but loses the pre-show presence signal); how a versus show's second performer is represented before either goes live; and what the artist sees at the moment the window opens.

### G.2 B-Roll (PRD row 14) — sequenced AFTER fix (a) and fix (c)

Currently disabled in the shot panel. Scope: artists upload up to **10 clips**, **auto-muted at upload**, playable as a **director-cuttable source** during a live show, and **cueable in cue sheets like any other shot**.

**Why it lands after fix (a)**: B-roll introduces a video source that appears and disappears mid-show — exactly the dynamic-track case fix (a) is being built to handle. Egress re-selection must treat a B-roll source as just another candidate, which is only true once (a)'s re-selection is generalised rather than performer/camfeed-specific.

**Design questions for its own plan round**:
- **Playback/publish mechanism** — client-side clip playback into a published canvas or video track (`captureStream`) vs. alternatives (a second participant identity publishing the clip; server-side injection). Each has different implications for sync, egress, and whether the clip survives a publisher reconnect.
- **Storage** — reuse the existing recordings bucket, with whatever access model that implies for playback during a live show.
- **9:16 handling** — clips will not all be portrait; needs the same portrait-crop-aware treatment `ShotTransformFrame` already applies to camera sources, or an explicit letterbox policy.
- **Auto-mute contract** — muted at upload; whether an artist can ever un-mute a clip mid-show, and what that means for the published audio mix (it would have to join the graph at `outputBus`, like the backing track).
