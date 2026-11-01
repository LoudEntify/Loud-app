import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { color } from '../src/shared';
// LiveKit's WebRTC globals (RTCPeerConnection, MediaStream...) for the
// device-zoom spike (app/spike/zoom.js). Only a development build carries
// the native side; in Expo Go the require throws and the app carries on
// exactly as before, so this must stay lazy and guarded.
try { require('@livekit/react-native').registerGlobals(); } catch { /* not in this build */ }
export default function RootLayout() {
  return (<>
    <StatusBar style="light" />
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.ink } }} />
  </>);
}
