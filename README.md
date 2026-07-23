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
