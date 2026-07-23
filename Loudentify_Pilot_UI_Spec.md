# Loudentify pilot — consolidated UI spec

Status: pilot build, week one. This spec covers everything decided in planning so far. Items marked **post-pilot** are roadmap, not required for this build.

---

## 1. Stream layout

### Solo mode
- Single performer, full-width video.
- Reactions live in a narrow rail on the outer edge only — never overlaying the performer.

### Versus mode
- Two contestants, A (left/top) and B (right/bottom).
- Each contestant has their own reaction rail on their outer edge. Reactions are tied to the specific contestant they were sent to — this rail acts as a live read on who's landing better, not a pooled count.
- **Slidable divider**, user-controlled by drag. Range: 25%–75% per side. Neither side can shrink below 25%, so the non-active performer is always still visible.
- No automatic resizing — this is a manual viewer preference, not driven by reaction volume.

### Orientation
- Phone/tablet: detect orientation. Portrait → split top/bottom. Landscape → split left/right.
- Laptop/monitor/TV: always landscape split (no orientation detection needed, device can't rotate).

---

## 2. Reactions

### Generic reaction bar (always visible, no learning curve)
Heart, fire, clap, laugh, +1. Standard, instantly recognizable, minimal animation (a quick pop/scale on tap is enough).

### Go loud (signature, threshold-based)
- Collective action: fires only once enough taps accumulate (working number: 50).
- On trigger: full-screen burst visual + haptic vibration on mobile (Vibration API).
- This is a single collective event, not part of the individual reaction stream — build as its own overlay, not another icon in the rising stack.
- No payment attached for the pilot. (Paid request/tipping model — e.g. "pay for a 30–60s duet or question" — is real but scoped **post-pilot**: needs Stripe integration, a refund/dispute policy, and legal framing as a tip rather than a guaranteed service.)

### Super reactions (riff / run / rap)
- One star toggle button opens a second row ("super" mode) alongside the default bar ("normal" mode).
- Three icons: riff (soundwave), run (ascending chevrons), rap (mic drop).
- Shared adaptive label underneath ("nice one") rather than three separate floating captions.
- Motion direction per icon:
  - Riff: soundwave ripples outward, settles (~0.6s total)
  - Run: chevrons streak up fast with slight overshoot, snaps back (~0.5s total)
  - Rap: mic drops with small bounce + impact ring (~0.55s total)
- Keep timing consistent across all three (0.5–0.6s) so none reads as more "important" than another.

### Reaction stream behavior (generic + super reactions, not go-loud)
- Icons enter at the bottom at full opacity, each with its own random horizontal offset (avoid a straight vertical column).
- Drift upward with slight horizontal wander.
- Fade to zero opacity by the time they reach the top 20% of the frame — no hard cutoff.
- Cap concurrent on-screen icons (suggested 8–12); queue or drop overflow beyond that.

---

## 2b. Audio capture — pilot scope

**Locked for pilot: Case 2 only — vocal + one instrument, phone mic, no external rig.**

- Browser's default `echoCancellation`, `noiseSuppression`, and `autoGainControl` are disabled on capture — these are tuned for voice calls and degrade music.
- In their place: a lightweight Web Audio API chain applied to the raw mic signal before publish — a gentle compressor (balances vocal vs. instrument volume) and a high-pass filter around 80Hz (cuts handling rumble, leaves the music untouched).
- Higher audio bitrate on publish (~96–128kbps) and DTX disabled, so quiet passages aren't clipped.
- This one processing chain applies consistently to every performer in this mode — no per-artist configuration needed.

**Deferred, not built for this pilot:**
- **Case 1 — multi-instrument external rig**: artist mixes their own signal externally and feeds it in as a selected input device. Mostly a device-picker UI addition on top of the same capture settings above; genuinely quick to add later, just not needed if no pilot performer is using a rig.
- **Case 3 — backing track**: requires file upload/storage (Supabase), a Web Audio mixing graph combining the uploaded track with the live vocal on-device, and headphones for the performer so the track doesn't leak into the mic. Real scope, not a small add — revisit after seeing whether this format comes up in pilot audience/performer interest.

---

## 3. Domain & infra (already decided)
- Domain: `.com` preferred if available; `.app` as solid backup (no functional restriction for a web app, HTTPS enforced by the registry — a non-issue with Vercel/Netlify's automatic SSL).
- Email: shared inbox on the chosen domain, works identically to any domain for MX/SPF/DKIM/DMARC setup.
- Hosting: Vercel (best fit for Next.js + LiveKit's official templates).
- Backend: LiveKit Cloud for streaming + data messages (reactions, go-loud count) — no separate database needed for the pilot.

---

## 4. Post-pilot roadmap (not required for this build)

- **Artist profile (public)**: bio, profile + artist photos, performance clips (shorts/full), stats, messaging entry point, notifications, external link icons (website, Spotify, Instagram, Snapchat, etc.)
- **Fan profile (public, simpler)**: preferred genre, top 5 artists, engagement stats, basic info, messaging/notifications
- **Artist dashboard (private)**: everything in the artist profile plus edit controls, fan messaging, public/private post toggling, stats monitoring, content sharing tools
- **Universal content sharing**: every clip gets its own shareable URL with dynamic Open Graph preview (image, title, description — like a YouTube share card), plus in-platform comment, like, and send-to-username functionality.
- **Paid engagement requests** (duet/question for a fee): needs payment processing, refund/dispute policy, and legal structuring as a tip rather than a contracted service.

---

## 5. Build ownership notes
- Frontend UI components (reaction bar, go-loud, super reactions, versus/solo split) can be built independent of LiveKit's real-time connection logic, using placeholder video boxes. This lets non-blocking parallel work happen on a separate branch.
- LiveKit token API route and the real-time data-message wiring (reaction counts, go-loud threshold, contestant-tagging) stay with whoever owns the LiveKit integration — these touch the API secret and are higher-risk to get wrong.
