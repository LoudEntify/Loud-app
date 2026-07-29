# Visual system handoff — from Claude Design (Fan Viewer + Artist Broadcast)

**Source of truth:** two Claude Design prototypes, `Fan Viewer.dc.html` and
`Artist Broadcast.dc.html` (the desktop/final-iteration versions, after the
"systemic button pass" and font/color firming-up documented in their chat
transcript). This doc is scoped **only** to the visual system those two
screens express — not to any of the other ~13 screens in that design
project (discover feed, dashboards, profiles, etc.), which don't exist in
this codebase and are explicitly **not** being built here.

This is a **restyle of what's already running**, not new page creation.
The only real screens in this repo are:
- the join/home screen (`components/LiveDemo.jsx`, mode/role steps)
- the live viewer screen (fan-facing render path in `LiveDemo.jsx` + `VersusSplit.jsx`, `ReactionBar.jsx`, `SuperReactionPanel.jsx`, `CommentsPanel.jsx`)
- the live broadcast screen (performer-facing render path in the same files, `mic-cam-controls`, `DirectorPanel`)
- the wallet page (`components/TokenWallet.jsx`, already added separately)

---

## 1. Extracted design system (confirm before editing)

### Color palette — base pair + accents, and how they're actually used

| Role | Color | Hex | Usage rule |
|---|---|---|---|
| Base (dark) | Ink Black | `#011627` | Background. Swapped with Porcelain for contrast contexts — never a third neutral. |
| Base (light) | Porcelain | `#fdfffc` | Primary text/icon color on dark; background swap target on light surfaces (e.g. the wallet page). |
| Accent | Teal | `#2ec4b6` | Default "interactive / active / selected" accent — active camera-thumbnail border+glow, drag-handle border+dots+glow, quoted/reply comment text. |
| Accent | Red | `#e71d36` | "Live" + "urgent" semantic accent only — LIVE indicator dot+glow, GO LOUD label+progress+glow, mic-muted color, the Leave button fill+glow. |
| Accent | Orange | `#ff9f1c` | Used sparingly — FIRE and +1 sticker glyphs, coins/wallet icon. |

**Rule extracted from the source files:** the three accents are never flat
fills across large surfaces. Every accent appearance in the prototypes is
paired with a glow (`box-shadow` or `filter: drop-shadow(...)`) and
confined to interactive, live, or preview moments — never decorative
background color.

**Current pilot deviation:** `components/reactions.css` and `LiveDemo.jsx`
use an entirely different, off-palette color set left over from before
this palette was adopted — e.g. `#E24B4A`, `#EF9F27`, `#378ADD`,
`#639922`, `#7F77DD`, `#D85A30`, `#534AB7`, `#2C2C2A`, `#1a1a19`,
`#444441`, `#55544f`, `#6DA8E0`. None of these are in the palette above
and all need to be replaced. `components/TokenWallet.jsx` is the
exception — it already uses `INK`/`PORCELAIN`/`TEAL` constants correctly
and can be used as the reference implementation for the rest of the pass.

### Font

- Single global typeface: **PT Sans Narrow**, weights 400 (regular) and
  700 (bold) only. No secondary/mono pairing.
- Applied with a universal selector in the source files
  (`* { font-family: 'PT Sans Narrow', sans-serif; }`) so nothing falls
  back to a browser default — this is deliberate, not an accident to clean
  up.
- All-caps + wide letter-spacing (`0.06em`–`0.14em`) for UI chrome/labels
  (`LIVE · VERSUS`, `GO LOUD`, `COMMENTS`, `MIC ON`, sticker captions).
  Regular case + weight for comment/body copy. Bold (700) for
  usernames/labels.
- **Current pilot deviation:** `app/layout.js` loads **Space Grotesk**,
  explicitly flagged in its own code comment as a placeholder assumption
  ("swap this one import if the actual Claude Design prototype landed on
  a different font — it's a one-line change"). This is that swap.

### Buttons — shape, corner treatment, border/border-less logic

Two distinct rule sets, don't conflate them:

**A. Real buttons (rectangular actions, discrete icon actions):**
- No default border — fill/color carries the visual weight.
- A visible border (2px, teal, soft glow) appears **only** to mark a
  genuinely active/selected state among a set of options (e.g. the active
  camera thumbnail in the director panel) — never as decoration.
- Corner radius: pill (`border-radius: 999px`) for rectangular action
  buttons, fully circular (`50%`) for single discrete icon actions (the
  Leave button: 56px circle, `#e71d36` fill, glow, no border).
- Bold (700) label weight always.
- **This part is already correctly implemented** — `reactions.css` already
  has the right global reset (`button { border:none; border-radius:999px;
  font-weight:700; }` + `.btn-active`). It's the *colors and per-component
  overrides* on top of it that drift off-palette (see table above and
  the per-file notes below).

**B. Floating icon controls over live video** (maximize/minimize, mic/cam
toggle, sticker taps, reaction-rail taps): these have **no background,
fill, or border chrome at all** in the source files — bare icon (or custom
glyph) plus optional caption, state communicated only through color
(porcelain = on/default, red = off/muted) and hover opacity/scale. This is
a real divergence from the current pilot: `control-btn`,
`leave-btn-floating`, and `go-loud-btn` in `reactions.css` currently render
as filled/bordered pill buttons with off-palette backgrounds
(`#2C2C2A`, `#D85A30`). In the source design, GO LOUD in particular has
**no button box at all** — it's glowing red text plus a thin progress bar,
nothing else.

### Distinctive shape language — chamfering (separate from button radius)

- Video/stage panels and thumbnail frames use a single-corner **chamfer
  cut via CSS `clip-path`** on their outer edge (e.g.
  `polygon(20px 0,100% 0,100% 100%,0 100%,0 20px)`) — not rounded
  rectangles.
- The versus divider's drag-handle is a hexagonal chamfered chip
  (`clip-path: polygon(50% 0,100% 20%,100% 80%,50% 100%,0 80%,0 20%)`),
  not a rounded pill.
- This chamfered/notched treatment is for **structural containers**
  (video frames, thumbnails, cards); **buttons use the pill/circle radius
  rule (A) above instead** — two different corner grammars for two
  different jobs.
- **Current pilot deviation:** `.versus-stage` uses `border-radius: 12px`
  (rounded rectangle) and `.drag-handle` uses `border-radius: 10px`
  (rounded rect) — both should become the chamfered clip-path treatment.

### Icon style

- **Phosphor Icons**, regular weight, consistent everywhere, for all
  functional/navigational icons (mic, mic-slash, video-camera,
  video-camera-slash, corners-out/in for maximize, send, coins, etc.).
  `LiveDemo.jsx` already does this correctly via `@phosphor-icons/react`.
- Custom illustrated glyphs (built from the same CSS `clip-path`
  technique already used in the source files — no new asset files needed)
  are reserved for brand-distinctive elements only: the sticker set
  (heart/fire/clap/laugh/+1) and the Leave/hang-up glyph. These should
  **not** be swapped to library icons or emoji.
- **Current pilot deviation:** `ReactionBar.jsx` currently renders raw
  Unicode emoji inside filled colored circles for the sticker set. The
  source design has no circular badge container at all — bare
  clip-path glyph + glow + caption label underneath.

### Spacing

- Overlay edge padding: 20–32px from screen edges.
- Icon-to-label gaps: 6–8px.
- Comment list vertical rhythm: 10px between rows.
- Sticker/reaction-rail gaps: 14px between icons.
- Reply indentation ~18px with a small arrow glyph (⤷); quoted/reply text
  renders in teal (`#2ec4b6`), never a random blue
  (current pilot's `.quote-block` uses `#6DA8E0` — needs correcting).

---

## 2. The Claude Code prompt

Paste everything in the fenced block below into a Claude Code session
pointed at this repo.

```
Apply the visual system extracted from the Claude Design prototypes
"Fan Viewer.dc.html" and "Artist Broadcast.dc.html" to this existing
Next.js pilot app. This is a restyle of what's already built, not new
page creation.

STEP 0 — before touching anything: re-read VISUAL_SYSTEM_HANDOFF.md in
this repo's root and print back a short summary of the colors, font, and
button/shape rules you're about to apply, plus the specific files/values
you intend to change. Wait for my explicit confirmation before making any
edits.

SCOPE — only these existing surfaces:
- The global font + color system, set at the app level:
  app/layout.js and components/reactions.css (the shared stylesheet
  imported by the live-show components).
- The shared button styling (radius, border logic, weight) in
  components/reactions.css.
- The four screens that actually exist in code:
  1. Join/home screen — components/LiveDemo.jsx (the 'mode' and 'role'
     steps before joining).
  2. Live viewer screen (fan-facing) — the RoomInner render path in
     components/LiveDemo.jsx plus components/VersusSplit.jsx,
     components/ReactionBar.jsx, components/SuperReactionPanel.jsx,
     components/ReactionStream.jsx, components/CommentsPanel.jsx.
  3. Live broadcast screen (performer-facing) — the same files, the
     mic-cam-controls block and DirectorPanel in LiveDemo.jsx.
  4. Wallet page — components/TokenWallet.jsx. This one is already close
     to compliant (uses the correct INK/PORCELAIN/TEAL hex values,
     chamfered clip-path corners, and the .btn-active pattern already) —
     treat it as the reference implementation for the rest of the pass,
     don't rebuild it.

DO NOT:
- Create any new routes, pages, or top-level components. No discover
  feed, artist/fan profile, dashboard, notifications, recorded shows,
  competitions, auth, or settings screens — none of those exist in this
  codebase and none should be added as part of this pass.
- Introduce a persistent sidebar nav or any other structural component
  that doesn't already exist here, even though the source prototypes have
  one — this app only has the 4 screens listed above.
- Change any LiveKit/room/data-channel logic, component structure, or
  interaction behavior. Only visual properties (color, font, border,
  radius, shadow, spacing, clip-path) should change.

WHAT TO DO:

1. Font: replace the Space_Grotesk import in app/layout.js with
   next/font/google's PT_Sans_Narrow, weights ['400','700'], keeping the
   same --font-app CSS variable so nothing downstream needs to change.
   This matches the source files' Google Fonts request exactly
   (PT+Sans+Narrow:wght@400;700).

2. Color palette: replace every off-palette hex value in
   components/reactions.css and any inline styles in components/*.jsx
   with the 5-color system below. Do not introduce any other colors.
   - Base: Ink Black #011627, Porcelain #fdfffc (swap pair, never a third
     neutral)
   - Accent: Teal #2ec4b6 (default interactive/active/selected)
   - Accent: Red #e71d36 (live + urgent/leave semantics only)
   - Accent: Orange #ff9f1c (sparing use — fire/+1 stickers, coins icon)
   Known off-palette values to replace, found in reactions.css and
   LiveDemo.jsx: #E24B4A, #EF9F27, #378ADD, #639922, #7F77DD, #D85A30,
   #534AB7, #2C2C2A, #1a1a19, #444441, #55544f, #6DA8E0.
   Accents must stay paired with a glow (box-shadow or drop-shadow) and
   confined to interactive/live states — never a flat fill across a large
   surface.

3. Buttons: keep the existing global reset in reactions.css (no default
   border, border-radius: 999px, font-weight: 700) — it's already
   correct. Fix the per-component overrides that currently break it:
   - .go-loud-btn currently renders as a filled pill button. In the
     source design GO LOUD has no button box at all — just glowing red
     (#e71d36) text plus a thin progress bar. Remove its background/fill
     and match that treatment.
   - .control-btn (mic/cam toggles) and .leave-btn-floating currently use
     off-palette fills (#2C2C2A, #D85A30/#E24B4A) with visible boxes. Mic
     and camera toggles should be borderless icon+label controls (color
     alone signals on/off state: porcelain = on, red = off) as in the
     source. The Leave button should stay a filled circle but in exact
     #e71d36 with a red glow shadow, no border.
   - Border only appears on the one genuinely active/selected element in
     a set (e.g. the active camera thumbnail via .btn-active) — verify no
     other button carries a border.

4. Shape language — chamfered corners for structural containers, not
   buttons: replace the rounded-rectangle border-radius on .versus-stage
   (currently 12px) and .drag-handle (currently 10px, rounded rect) with
   the clip-path chamfer/hexagon treatment from the source files. Keep
   this distinct from button radius — panels/frames/thumbnails get the
   chamfer, buttons keep the pill/circle radius from step 3.

5. Icons: keep @phosphor-icons/react for all functional icons (already
   correctly used for mic/camera/leave in LiveDemo.jsx) — regular weight
   throughout. For the sticker set in ReactionBar.jsx, replace the
   emoji-in-filled-circle treatment with bare colored glyphs + glow +
   caption label (no circular badge background), using the same
   CSS clip-path technique the source files use — no new icon library, no
   new asset files.

6. Spacing/typography polish to match the source: all-caps + wide
   letter-spacing (0.06em-0.14em) on UI chrome labels (LIVE, GO LOUD,
   COMMENTS, MIC ON/OFF), bold weight on usernames, and fix
   .quote-block's color from #6DA8E0 to the correct teal #2ec4b6.

After each numbered step, keep the app runnable (npm run dev) and don't
let visual changes break the existing LiveKit join/reaction/comment
functionality — this is styling only.
```
