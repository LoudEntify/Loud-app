# YouTube viewer delivery: addendum to the architecture and journey docs

Status: this is the product-behaviour detail for YouTube delivery. The security, privacy, safety, reliability and release rules for it are in ARCHITECTURE.md v2, which wins on any conflict. YouTube delivery is built first. Loudentify's own hosting follows when funded. Where this addendum conflicts with the older docs on viewer delivery, this addendum wins.

## Why
Per-viewer streaming cost is too high to scale. Planning basis: up to 400 viewers per artist across 100+ concurrent streamers.

## Shape
- Artists perform and are directed on Loudentify (AI director, multicamera, Kit Check, console). Viewers watch an embedded YouTube player inside the Loudentify app and website. Only viewers use the YouTube flow.
- One composed output per show is captured by the egress engine (LiveKit egress) and sent to YouTube over RTMP. It is the same composed picture the artists see. No per-viewer adjustment. The Loudentify logo is burned into the video before it leaves.
- The same egress output is also recorded to the artist's account and used for AI director training. Only one egress stream per show.
- Artists connect a Google/YouTube account at sign-up (YouTube only). Loudentify creates the broadcast and stream through the YouTube Live Streaming API and stores the video id for the embed.
- Versus: the composed show is streamed to both artists' channels. Viewer counts are aggregated across both. Loudentify's own channel is for Loudentify as an entity, not artists' shows.
- Build delivery behind a `PlayerSource` interface (`youtube`, later `loudentify-llhls`).

## The composed picture (portrait 9:16)
- Solo: the AI director output, full frame.
- Versus has three views, switched by the artists:
  1. Conversation: frame split half and half, top and bottom, both artists equal.
  2. Artist A performing: A's feed fills the frame; B in a small portrait window in the lower right, about 31% of frame width.
  3. Artist B performing: the mirror.
- Each artist has Conversation and Perform buttons. Tapping Perform while the other artist is performing sends a stage request. The performing artist must confirm ("Hand over the stage" or "Not yet"). Switching to Conversation is immediate. Current view is a show-level fact on `shows`.
- Artist screens show exactly the composed frame. Viewers see it a few seconds later.
- Kit Check shows only the artist's own camera cropped to the three windows (conversation half, full performing frame, corner window), with framing guides. It never shows the YouTube broadcast.

## Viewer screen rules
- No overlay of any kind on the YouTube player frame. Chat, emoji, reactions tab, votes, Support, Share, Report sit beside and below it.
- Phone: frame about 304 x 540, side buttons 44px. "Bigger" goes to about 340 x 604 with chat collapsed to one line. A vote sheet shrinks the frame to 270 wide. Guest sign-up shrinks the frame to 200 x 356 (YouTube minimum is 200 x 200). Fold and tablet use the 768 layout. Computer: 405 x 720 frame between info and chat. Website show page: frame plus sign-up card.
- Voting is open in all three Versus views. Prompt cards and votes use the same one-vote-each rule.
- Cannot make the embed unclickable. Accepted.

## Things Claude Code must handle and record
- YouTube delay: votes, Support thank-yous and reactions must line up with what the viewer sees, not what the server sees. Extend playback-position stamping to votes, with a short grace window when voting closes.
- Viewer-hours metering: count a view after 30 seconds using player events from the embed. Metering never blocks playback.
- Embedded YouTube uses cookies: use the privacy-enhanced embed domain where possible, gate behind the cookie banner and update the privacy notice.
- YouTube API quota and OAuth: the live streaming scope is a sensitive scope and needs Google verification; default API quota is limited. Log this in `docs/NEEDS_KOREY.md` on day one with steps.
- Embedded players must be at least 200 x 200 and must not be obscured. Do not use a transparent click-blocker over the player.
- Covers: licensing is researched separately. Originals only in the public product.
