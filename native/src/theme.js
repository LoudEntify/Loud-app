// native/src/theme.js — the web's design tokens, as React Native styles.
import { StyleSheet } from 'react-native';
import { color, font, radius, size } from './shared';

export const tokens = { color, font, radius, size };
export const styles = StyleSheet.create({
  screenDark: { flex: 1, backgroundColor: color.ink },
  screenLight: { flex: 1, backgroundColor: color.mist },
  h1: { fontSize: 34, fontWeight: '700', color: color.ink, lineHeight: 36 },
  h1Dark: { fontSize: 34, fontWeight: '700', color: color.porcelain, lineHeight: 36 },
  body: { fontSize: 17, color: color.ink, lineHeight: 22 },
  bodyDark: { fontSize: 17, color: color.porcelain, lineHeight: 22 },
  muted: { fontSize: 15, color: color.mutedOnLight },
  mutedDark: { fontSize: 15, color: color.mutedOnDark },
  btn: { minHeight: size.touch, paddingHorizontal: 18, borderRadius: 22, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  btnTeal: { backgroundColor: color.teal },
  btnOrange: { backgroundColor: color.orange },
  btnGhostDark: { backgroundColor: 'rgba(253,255,252,0.14)' },
  btnGhostLight: { backgroundColor: 'rgba(1,22,39,0.07)' },
  btnText: { fontSize: 17, fontWeight: '700', color: color.ink },
  btnTextDark: { fontSize: 17, fontWeight: '700', color: color.porcelain },
  badgeLive: { backgroundColor: color.red, color: '#fff', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, fontSize: 12, fontWeight: '700', letterSpacing: 1, overflow: 'hidden' },
  badgeSoon: { backgroundColor: color.orange, color: color.ink, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, fontSize: 12, fontWeight: '700', letterSpacing: 1, overflow: 'hidden' },
  card: { borderRadius: radius.card, backgroundColor: 'rgba(255,255,255,0.72)', padding: 14 },
  cardDark: { borderRadius: radius.card, backgroundColor: 'rgba(1,22,39,0.82)', padding: 14 },
  panelDark: { borderRadius: radius.cardLg, backgroundColor: 'rgba(253,255,252,0.1)', padding: 14 },
  field: { height: 48, borderRadius: radius.field, backgroundColor: 'rgba(1,22,39,0.07)', paddingHorizontal: 14, fontSize: 17, color: color.ink },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
});
