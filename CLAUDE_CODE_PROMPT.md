# Prompt for Claude Code — hand this to Ugo

Paste the text below into Claude Code once it's pointed at this repo, to
pick up exactly where the scaffold leaves off.

---

This repo is a Next.js 14 pilot build for a live music streaming platform.
The UI components, token API route stub, and audio processing chain are
already built — see README.md for what exists and what's left. Please:

1. Install the LiveKit SDKs already listed in package.json and confirm
   `npm run dev` runs the existing UI (placeholder video, working
   reactions) before changing anything.

2. Wire `components/Demo.jsx` to a real LiveKit room:
   - Fetch a token from `/api/token?room=pilot-room&identity=...&contestant=a`
     (or `b`, or omit `contestant` for a viewer-only subscribe token)
   - Replace the placeholder text in the `renderA`/`renderB` props passed
     to `VersusSplit` with LiveKit's `<LiveKitRoom>` and `<VideoTrack>`
     components from `@livekit/components-react`

3. Publish audio using `createPilotAudioTrack()` from
   `lib/audioProcessing.js` instead of the raw mic track, for performers.

4. Replace the local-only reaction handling in `Demo.jsx` with real
   LiveKit data messages: `room.localParticipant.publishData(...)` on
   send, and a room-level data listener that pushes into
   `ReactionStream` for every participant, not just the sender.

5. Move the go-loud 50-count threshold to reflect the whole room (shared
   state via data messages, not each client's own local tally).

Constraints to respect:
- Audio capture must have `echoCancellation`, `noiseSuppression`, and
  `autoGainControl` all disabled — this is already handled inside
  `createPilotAudioTrack()`, don't override it elsewhere.
- Don't build payment/tipping, profiles, dashboards, or Case 1/Case 3
  audio handling — all explicitly out of scope for this pilot, documented
  in `Loudentify_Pilot_UI_Spec.md`.
- Keep LiveKit API secret usage confined to `app/api/token/route.js` —
  never expose it to a client component.

Ask me before making structural changes outside what's listed above.
