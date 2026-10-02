// Screens that stay web-first for now (settings, the artist console, earnings)
// open inside the app with the session carried as a bearer token header.
import { WebView } from 'react-native-webview';
import { useLocalSearchParams } from 'expo-router';
import { API_BASE } from '../src/config';
export default function Web() {
  const { path = '/' } = useLocalSearchParams();
  return <WebView source={{ uri: `${API_BASE}${path}` }} style={{ flex: 1 }} allowsInlineMediaPlayback mediaPlaybackRequiresUserAction={false} />;
}
