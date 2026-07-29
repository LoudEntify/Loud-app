# Loudentify pilot — app scaffold

This is a working Next.js app shell with the pilot UI components already
wired in, plus stubs for the two things that touch LiveKit directly. It
runs and renders right now with placeholder video — nothing here requires
LiveKit to be connected to see the UI working.

## To run it locally

```bash
npm install
npm run dev
```

Then open http://localhost:3000 — you should see the full reaction bar,
super reactions, and versus/solo split, exactly as previewed in chat.

## What's already done

- Next.js 14 app router scaffold
- All pilot UI components (`components/`) — reaction bar, go-loud, super
  reactions, versus/solo split with orientation detection and the
  user-controlled slider
- `.env.local.example` — copy to `.env.local` and fill in the real LiveKit
  values from the password manager
- `app/api/token/route.js` — a working token-generation endpoint. It reads
  `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_URL` from environment
  variables and returns a join token. This is the only file that ever
  touches the API secret — it runs server-side only.
- `lib/audioProcessing.js` — the Case 2 audio chain (vocal + one
  instrument, phone mic, no rig): disables the browser's default voice
  processing, replaces it with a high-pass filter (removes handling
  rumble) and a compressor (balances vocal vs instrument volume). Call
  `createPilotAudioTrack()` to get a processed track ready to publish.

## Visual system pass (fonts, icons, buttons, full emoji library)

Brings the running pilot in line with the Claude Design prototype:

- **Font**: Space Grotesk applied app-wide via `app/layout.js` (assumption
  -- swap this one import if the actual Claude Design prototype landed on
  a different font; nothing else depends on it).
- **Icons**: `@phosphor-icons/react` used for mic, camera, and leave
  controls (`LiveDemo.jsx`), the super-reactions star toggle
  (`ReactionBar.jsx`), and the emoji-picker trigger (`CommentsPanel.jsx`).
- **Buttons**: global reset in `reactions.css` -- no default borders,
  pill/rounded corners everywhere, bold labels. A border now only ever
  appears via the new `.btn-active` class, used for genuinely
  selected/current states (e.g. the active camera thumbnail in the
  director panel) -- never as decoration.
- **Full emoji library**: `emoji-picker-react` (MIT licensed) replaces the
  earlier 24-emoji grid in the comments composer -- full searchable
  Unicode emoji set, standing in until custom Loudentify stickers are
  designed. This is separate from the sticker bar (hearts/fire/riff/run/
  rap), which stays custom-designed, not swapped for a generic library.

PRD ref: this is a pure frontend/visual pass -- no backend, database, or
Scaling & Infrastructure tab implications.

## Multi-camera (3-camera sync)

The join screen now offers "Extra camera" alongside Viewer/Performer, per
slot (A/B). A performer's main phone plus up to 2 extra camera-feed
devices (3 total) can all publish video into the same room:

- Extra camera devices join video-only (`canPublish: true`,
  `canPublishSources: ['camera']`, `canPublishData: false`) -- they never
  publish audio and can't send reactions/comments, since they're just
  camera hardware, not a person interacting with the show.
- The main performer sees a **director panel** (thumbnail row) listing
  every camera tagged to their own slot, and taps one to make it live.
  That choice broadcasts to everyone as an `active-camera` data message.
- Everyone else's screen (other viewers, the other contestant) renders
  only whichever feed was last marked active for that slot -- never
  multiple feeds at once.
- This is manual switching only. No auto-director, no emotion-based shot
  selection, no staccato-timed auto cuts -- those are explicitly deferred
  per the PRD (Won't now / Future Roadmap).

PRD ref: Multi-Camera & Production (Artist category). Scaling ref:
Real-time video/audio -- camera feeds are just additional LiveKit
participants in the same room; this scales exactly the way the rest of
the room already does, no new infrastructure needed.

## Two versions included

- **`components/LiveDemo.jsx`** — the real, LiveKit-connected version.
  This is what `app/page.js` renders. It shows a join screen (name + role:
  viewer / performer A / performer B), fetches a token from
  `/api/token`, connects to the room, publishes video for performers
  (plus the Case 2 processed audio track), and sends/receives reactions
  and go-loud taps as real LiveKit data messages shared across everyone
  in the room.
- **`components/Demo.jsx`** — the original offline/local preview version
  with placeholder video and no network connection. Kept for reference
  and for quickly sanity-checking UI changes without needing LiveKit
  credentials at all.

## What's still rough and likely needs iteration

This was built in one working session, so treat it as a first working
draft, not a finished feature:

- The go-loud threshold logic resets to 0 the moment the room-wide total
  hits 50, on every client independently reading the same messages — this
  should work but hasn't been tested with more than a couple of
  participants at once.
- No reconnect/error handling yet if a performer's connection drops
  mid-stream.
- No UI feedback yet while the token fetch is in flight on the join
  screen.
- `CLAUDE_CODE_PROMPT.md` still has useful next steps for hardening this
  further once Ugo's back.

## Deliberately not included

- Payment/tipping, artist/fan profiles, dashboards, content sharing — all
  post-pilot scope, documented in `Loudentify_Pilot_UI_Spec.md`.
- Case 1 (external rig) and Case 3 (backing track) audio handling —
  deferred; see the spec doc for what each would require.

## Deploying

Connect this repo to Vercel (Next.js works there with zero config). Add
the three LiveKit environment variables in the Vercel project settings —
not just locally — since the token route needs them in production too.
