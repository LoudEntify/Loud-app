// The five states, native (design/StatesPatterns.dc.html).
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import { styles } from '../theme';
import { color } from '../shared';
function Loading({ dark }) { return <View style={[dark ? styles.screenDark : styles.screenLight, { alignItems: 'center', justifyContent: 'center' }]} accessibilityRole="progressbar" accessibilityLabel="Loading"><ActivityIndicator color={color.teal} /></View>; }
function Empty({ dark, inline, title, body, action, onAction, secondary, onSecondary }) {
  const inner = <View style={[dark ? styles.panelDark : styles.card, { alignItems: 'center', gap: 8 }]}><Text style={{ fontSize: 20, fontWeight: '700', color: dark ? color.porcelain : color.ink }}>{title}</Text>{body && <Text style={dark ? styles.mutedDark : styles.muted}>{body}</Text>}{action && <Pressable style={[styles.btn, styles.btnTeal]} onPress={onAction}><Text style={styles.btnText}>{action}</Text></Pressable>}{secondary && <Pressable onPress={onSecondary}><Text style={{ fontWeight: '700', textDecorationLine: 'underline', color: dark ? color.porcelain : color.ink }}>{secondary}</Text></Pressable>}</View>;
  return inline ? inner : <View style={[dark ? styles.screenDark : styles.screenLight, { padding: 16, paddingTop: 120 }]}>{inner}</View>;
}
function Error({ dark, title, body, onRetry, retry = true }) {
  return <View style={[dark ? styles.screenDark : styles.screenLight, { padding: 16, paddingTop: 120 }]}><View style={{ padding: 16, borderRadius: 18, backgroundColor: 'rgba(231,29,54,0.18)', gap: 8 }}><Text style={{ fontSize: 18, fontWeight: '700', color: dark ? color.porcelain : color.ink }}>{title}</Text>{body && <Text style={dark ? styles.bodyDark : styles.body}>{body}</Text>}{retry && <Pressable style={[styles.btn, styles.btnTeal]} onPress={onRetry}><Text style={styles.btnText}>Try again</Text></Pressable>}</View></View>;
}
export const States = { Loading, Empty, Error };
