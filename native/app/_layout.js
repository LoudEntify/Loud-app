// native/app/_layout.js — the shell every screen sits in.
//
// Three jobs: hold the fonts until they are ready, keep the status bar
// legible, and register LiveKit's WebRTC globals when the build has them.
//
// The fonts matter more than they look. The whole design is set in PT Sans
// Narrow, and a narrow face is not a style choice here: the boards fit
// "Press and hold to end show" and "Continue with 3 picked" into a 390px
// phone because the letters are narrow. Fall back to the system font and
// the copy wraps, which is how a carefully drawn screen turns into a
// roughly drawn one. So the splash stays up until they have loaded.
import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts, PTSansNarrow_400Regular, PTSansNarrow_700Bold } from '@expo-google-fonts/pt-sans-narrow';
import { color } from '../src/ui';

// LiveKit's WebRTC globals (RTCPeerConnection, MediaStream...) for camera
// mode and the console. Only a development build carries the native side;
// in Expo Go the require throws and the app carries on, so it stays lazy.
try { require('@livekit/react-native').registerGlobals(); } catch { /* not in this build */ }

SplashScreen.preventAutoHideAsync().catch(() => { /* already shown */ });

export default function RootLayout() {
  const [ready, failed] = useFonts({ PTSansNarrow_400Regular, PTSansNarrow_700Bold });

  // A font that will not load is not a reason to show nobody anything: the
  // app opens in the system face rather than holding the splash forever.
  useEffect(() => {
    if (ready || failed) SplashScreen.hideAsync().catch(() => { /* already hidden */ });
  }, [ready, failed]);

  if (!ready && !failed) return null;

  return (
    <>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.ink } }} />
    </>
  );
}
