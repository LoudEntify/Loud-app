// The show screen on a phone: the player with nothing over it, side
// buttons, the vote card, chat. Geometry comes from the shared layout rules
// (computeShowLayout on the web); here the same frame sizes are applied
// with the phone's own dimensions. Votes, reactions and Support are stamped
// with the player's own position, like the web.
import { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, TextInput, useWindowDimensions, ScrollView, Linking } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { api } from '../../src/api';
import { useSession } from '../../src/session';
import { styles } from '../../src/theme';
import { color, playerFrame, GATED_ACTIONS } from '../../src/shared';
import { Player } from '../../src/player/PlayerSource';
import { States } from '../../src/components/States';

export default function Show() {
  const { id } = useLocalSearchParams();
  const { width, height } = useWindowDimensions();
  const { session, accessToken } = useSession();
  const [p, setP] = useState(null); const [err, setErr] = useState(null); const [comments, setComments] = useState([]); const [draft, setDraft] = useState(''); const [myVote, setMyVote] = useState(null); const [toast, setToast] = useState(null);
  const playerRef = useRef(null); const last = useRef(0);
  const load = async () => { const r = await api(`/api/viewer/show/${id}`, { accessToken }); if (!r.ok) { setErr(r.status === 404 ? 'notfound' : 'error'); return; } setErr(null); setP(r.data); if (r.data.myVote) setMyVote(r.data.myVote.choice_index); };
  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id, accessToken]);
  useEffect(() => { const poll = async () => { const r = await api(`/api/viewer/comments?show=${id}&after=${last.current}`); if (r.ok && r.data.comments.length) { last.current = Math.max(last.current, ...r.data.comments.map((c) => c.id)); setComments((c) => [...c, ...r.data.comments].slice(-100)); } }; poll(); const t = setInterval(poll, 3000); return () => clearInterval(t); }, [id]);
  const gate = (action, fn) => (GATED_ACTIONS.includes(action) && !session ? router.push(`/signup?trigger=${action}`) : fn());
  const pos = async () => (await playerRef.current?.positionMs?.()) ?? null;
  const say = (t) => { setToast(t); setTimeout(() => setToast(null), 2500); };
  if (err === 'notfound') return <States.Error dark title="We couldn't find this show" retry={false} />;
  if (err && !p) return <States.Error dark title="We couldn't load this show" onRetry={load} />;
  if (!p) return <States.Loading dark />;
  const show = p.show; const live = show.derived_state === 'live'; const isVersus = show.performance_mode === 'versus';
  // phone frame: 304 x 540 at 390 wide; scale to this phone, never under 200 x 200
  const frameW = Math.max(playerFrame.min.w, Math.min(playerFrame.phone.w, width - 12 - 56 - 18)); const frameH = Math.max(playerFrame.min.h, Math.round(frameW * 16 / 9));
  const prompt = p.prompt; const name = show.artist?.display_name || show.artist_name || 'Artist';
  return (
    <View style={styles.screenDark}>
      <View style={[styles.row, { paddingTop: 52, paddingHorizontal: 12 }]}>
        <Pressable onPress={() => router.back()} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(1,22,39,0.5)', alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: color.porcelain, fontSize: 20 }}>←</Text></Pressable>
        <View style={{ flex: 1 }}><Text style={{ color: color.porcelain, fontSize: 19, fontWeight: '700' }} numberOfLines={1}>{isVersus ? `${name} vs ${show.artist_b?.display_name || 'B'}` : name}</Text><View style={styles.row}>{live ? <Text style={styles.badgeLive}>LIVE</Text> : <Text style={styles.badgeSoon}>SOON</Text>}<Text style={{ color: color.porcelain, fontSize: 14 }}>{p.viewers} watching</Text></View></View>
        {!isVersus && <Pressable style={[styles.btn, styles.btnTeal]} onPress={() => gate('follow', async () => { say(p.following ? 'Unfollowed' : 'Following'); load(); })}><Text style={styles.btnText}>{p.following ? 'Following' : 'Follow'}</Text></Pressable>}
      </View>
      <View style={{ flexDirection: 'row', paddingHorizontal: 12, marginTop: 8, gap: 6 }}>
        <View style={{ width: frameW, height: frameH, borderWidth: 1, borderColor: 'rgba(253,255,252,0.28)' }} accessibilityLabel="Player">{live ? <Player ref={playerRef} show={show} width={frameW} height={frameH} /> : <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: 'rgba(253,255,252,0.7)' }}>{show.derived_state === 'ended' ? 'The show has ended' : 'Not started yet'}</Text></View>}</View>
        <View style={{ width: 56, alignItems: 'center', gap: 10 }}>
          {[live ? ['Support', () => gate('support', () => Linking.openURL(`${process.env.EXPO_PUBLIC_API_BASE || 'https://loudentify.app'}/show/${id}`)), color.orange] : ['Remind me', () => gate('remind', () => say("We'll remind you")), color.orange], ['Share', () => say('Link copied'), 'rgba(1,22,39,0.55)'], ['Report', () => say("Thanks. We'll look at it."), 'rgba(1,22,39,0.55)']].map(([label, fn, bg]) => <Pressable key={label} onPress={fn} style={{ alignItems: 'center', gap: 3 }}><View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: bg }} /><Text style={{ color: color.porcelain, fontSize: 12, fontWeight: '700' }}>{label}</Text></Pressable>)}
        </View>
      </View>
      {prompt && <View style={[styles.cardDark, { marginHorizontal: 12, marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 8 }]}><View style={{ flex: 1 }}><Text style={{ color: color.teal, fontSize: 12, fontWeight: '700', letterSpacing: 1 }}>VOTE OPEN</Text><Text style={{ color: color.porcelain, fontWeight: '700' }} numberOfLines={1}>{prompt.body}</Text></View>{(prompt.options || []).slice(0, 2).map((o, i) => <Pressable key={i} onPress={() => gate('vote', async () => { const r = await api('/api/viewer/vote', { method: 'POST', accessToken, body: { promptId: prompt.id, choiceIndex: i, playbackPositionMs: await pos() } }); if (r.ok) setMyVote(i); else say(r.data?.error || 'Could not vote'); })} style={[styles.btn, { height: 40, paddingHorizontal: 10, backgroundColor: myVote === i ? 'rgba(46,196,182,0.2)' : 'rgba(253,255,252,0.14)', borderWidth: 2, borderColor: myVote === i ? color.teal : 'transparent' }]}><Text style={styles.btnTextDark} numberOfLines={1}>{typeof o === 'string' ? o : o.label}</Text></Pressable>)}</View>}
      <ScrollView style={{ flex: 1, marginHorizontal: 12, marginTop: 6 }} contentContainerStyle={{ justifyContent: 'flex-end', flexGrow: 1, gap: 6 }}>{comments.slice(-30).map((c) => <Text key={c.id} style={{ color: color.porcelain, fontSize: 16 }}><Text style={{ color: color.orange, fontWeight: '700' }}>{c.author}</Text> {c.body}</Text>)}</ScrollView>
      <View style={[styles.row, { padding: 12, paddingBottom: 24 }]}>
        <TextInput value={draft} onChangeText={setDraft} placeholder={live ? 'Say something' : 'Say hello'} placeholderTextColor="#c9cfd1" onFocus={() => gate('comment', () => {})} style={{ flex: 1, height: 48, borderRadius: 24, backgroundColor: 'rgba(253,255,252,0.16)', color: color.porcelain, paddingHorizontal: 16, fontSize: 17 }} />
        <Pressable onPress={() => gate('comment', async () => { const t = draft.trim(); if (!t) return; setDraft(''); const r = await api('/api/viewer/comments', { method: 'POST', accessToken, body: { showId: id, body: t, playbackPositionMs: await pos() } }); if (r.ok) setComments((c) => [...c, r.data.comment]); })} style={[styles.btn, styles.btnTeal, { width: 48, height: 48, borderRadius: 24, paddingHorizontal: 0 }]}><Text style={styles.btnText}>➤</Text></Pressable>
      </View>
      {toast && <View style={{ position: 'absolute', left: 16, right: 16, bottom: 90, padding: 12, borderRadius: 16, backgroundColor: color.porcelain }}><Text style={{ fontWeight: '700', textAlign: 'center' }}>{toast}</Text></View>}
    </View>
  );
}
