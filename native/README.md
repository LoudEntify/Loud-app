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
