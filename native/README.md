# Loudentify native (iOS and Android)

Expo (React Native) with expo-router. One codebase for both phones; the
web repo's pure modules (design tokens, delay alignment, guest preview,
sign-up rules, metering, compositor geometry, booking rules) are imported
unchanged through `src/shared.js` (Metro `@loud/lib` alias to `../lib`).

What it does today: Discover feed with the 60-second guest preview, Live,
the show screen around a `Player` (YouTube via a WebView on
youtube-nocookie, or the fixture), chat/vote/follow/remind via the same
API routes as the web, sign-up with the 18+ gate, profile with balance
only (no payments in the app), and camera mode (viewfinder, QR pairing
through the pilot's camfeed routes, ON AIR state, keep-awake, foreground
warning). The artist console and settings open as web screens inside the
app for now.

Expo SDK 57 (React Native 0.86, React 19.2). Every native module the app
uses ships inside Expo Go for SDK 57 (camera, keep-awake, status bar,
fonts, linking, constants, router, webview, async-storage, safe-area,
screens), so the store version of Expo Go opens it; no development build
is needed until the LiveKit native SDK, push notifications or Apple and
Google sign-in land. There is no `babel.config.js` on purpose: Expo
applies `babel-preset-expo` by default, as the SDK 57 template does.

Run: `cd native && npm install && npx expo start` (then scan the QR code
with Expo Go, or use a dev build). Cloud builds: `eas build --profile preview` after
`eas init` (docs/NEEDS_KOREY.md has every step that needs Korey's Apple
or Google account).

## Device-zoom spike (branch `spike/native-device-zoom`)

`modules/loud-camera/` is a local Expo module (Kotlin for Android, Swift
for iOS) that feeds LiveKit from its own camera capturer so the phone's
zoom can be driven during a stream: device zoom first (CameraX
`setZoomRatio` / `AVCaptureDevice.ramp`), a crop-window pan, and a digital
fallback capped at 1.2x only when device zoom is unavailable
(docs/DECISIONS.md 2026-10-12). `app/spike/zoom.js` is the test screen
(Camera, Controller, Survey roles), `src/spike/*` the platform-free
policy with unit tests in `../tests/spike.test.mjs`, and
`src/spike/runtime.js` the wiring (LiveKit room from `/api/spike/token`,
commands over the data channel, batches to the `director-spike` bucket).
It needs a development or preview build (`eas build --profile preview
--platform android`); Expo Go does not carry the module and the screen
says so. The rest of the app is unaffected: `registerGlobals()` in
`app/_layout.js` is guarded, and nothing else imports the module.
