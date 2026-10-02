# Phase 4 handoff: the native apps (iOS and Android)

2 October 2026. Branch `claude/overnight-build-2026-10-02`. Plain English first.

## What exists

One Expo (React Native) app in `native/` that builds for iPhone and Android from the same code, with the viewer flows: Discover (snapping feed, the 60-second guest preview using the same meter as the web), Live, the show screen (player with nothing over it, side buttons, vote card, chat, follow, remind; votes and comments stamped with the player's own position), sign-up with the 18+ gate (the same rules module as the web, the same server route), log in, and Profile with the token balance and **no buy button anywhere**. Camera mode: the phone scans the pairing code from the artist's main device, gets the pilot's device credential, shows the viewfinder, role, ON AIR/REHEARSAL state, keeps the screen awake and warns when the app is backgrounded. The artist console, settings and earnings open as web screens inside the app for now.

The player sits behind the same `PlayerSource` contract as the web: YouTube through `react-native-youtube-iframe` on the privacy-enhanced domain (with `getCurrentTime()` for position stamping), and the fixture for seeded shows.

Design tokens and the pure rules are imported from the web repo unchanged (`native/src/shared.js`; the test `tests/native-shared.test.mjs` proves each loads without a browser). EAS build profiles (`native/eas.json`): development, preview (installable APK / ad-hoc iOS), production.

**Update (2 Oct 2026, later):** `native/` was upgraded from Expo SDK 53 to SDK 57 (React Native 0.86.3, React 19.2.3) so the Expo Go app from the stores can open it; the `splash` setting moved to the `expo-splash-screen` config plugin, the status bar is set through the `expo-status-bar` plugin, the tab bar no longer has a fixed height (Android is always edge-to-edge now), and `babel.config.js` went away in favour of Expo's default. `expo install --check`, `expo-doctor` and `expo export` (iOS and Android Hermes bundles) pass, and CI now runs them (`ci.yml` → `native` job). Still nothing on a device: that is the Expo Go test in `docs/NEEDS_KOREY.md`.

## What I could and could not run

- Ran: the shared-module test (passes); dependency resolution of the Expo project (`npm install` in `native/`; see `docs/STATUS.md` for the result).
- Could not run: `eas build` (needs an Expo account and Korey's Apple/Google credentials), a simulator or a device. **Nothing has been installed on a phone.** The device checklist in NEEDS_KOREY is the gate.
- Untested on a device, therefore: the YouTube WebView player, camera permissions on iOS, universal links, the tab bar on notched phones.

## What is stubbed or deferred

- Apple and Google sign-in (providers in NEEDS_KOREY); email works.
- Publishing the camera's frames into the show (needs the LiveKit native SDK and credentials); the pairing, credential and states are real.
- Picture-in-picture (PRD 105, "decide after testing on real devices").
- Push notifications (needs APNs/FCM keys; reminders show in the Inbox on the web).
- The native artist console and director.

## How to try it (Korey)

`docs/NEEDS_KOREY.md` → "Phase 4" has the click-by-click: Expo account, `eas init`, `eas build --profile preview`, install on both phones, the seven checks.

## Technical notes

PRD rows: 176 (built, device-untested), 105 (deferred), 90–92, 94, 96, 98, 101, 108 (balance only), 126 (camera side). Scaling: Stateless hosting (the app is a client of the same API), Auth. Migrations: none. Tests: `tests/native-shared.test.mjs`.
