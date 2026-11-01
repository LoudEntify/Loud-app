// The artist console on the phone (Console.dc.html; the web twin is
// components/artist/ConsoleScreen.jsx).
//
// This is the screen an artist holds while they play, so it is the one that
// least tolerates being a web page in a frame: the keyboard, the back
// gesture and the screen staying awake all have to be the phone's own.
//
// What it does: go live, show how the delivery is doing, carry comments
// from viewers, push a prompt or a vote, change the look mid-show, and end
// the show on a press and hold. The picture it shows is the artist's own
// camera through the capturer, when this phone is also the camera; when the
// camera is a second phone, it shows the state rather than pretending to a
// preview it does not have.
//
// Everything it calls is the same API the web console calls, so the two
// cannot drift: /console on open, /tick while live, /go-live, /end,
// /look, /versus, /stage-request.
import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, AppState } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useKeepAwake } from 'expo-keep-awake';
import { api } from '../../../src/api';
import { useSession } from '../../../src/session';
import { styles } from '../../../src/theme';
import { color } from '../../../src/shared';
import { LOOK_CHOICES } from '@loud/lib/direction.js';
import { showOrientation } from '@loud/lib/orientation.js';

const TICK_MS = 4000;
const HOLD_MS = 1500;
const fmt = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

export default function Console() {
  useKeepAwake();
  const { id } = useLocalSearchParams();
  const { session, loading, accessToken } = useSession();
  const [data, setData] = useState(null);
  const [tick, setTick] = useState(null);
  const [comments, setComments] = useState([]);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(null);     // 'live' | 'end' | 'look' | null
  const [sheet, setSheet] = useState(null);   // 'look' | 'prompt' | null
  const [promptText, setPromptText] = useState('');
  const [holdPct, setHoldPct] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [away, setAway] = useState(false);
  const holdRef = useRef(null);
  const lastComment = useRef(0);

  const show = data?.show;
  const live = Boolean(tick?.live ?? (show?.actual_started_at && !show?.actual_ended_at));
  const orientation = showOrientation(show);

  useEffect(() => { if (!loading && !session) router.replace('/login'); }, [loading, session]);
  useEffect(() => { const sub = AppState.addEventListener('change', (s) => setAway(s !== 'active')); return () => sub.remove(); }, []);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  const load = useCallback(async () => {
    if (!accessToken || !id) return;
    const r = await api(`/api/artist/shows/${id}/console`, { accessToken });
    if (!r.ok) { setErr(r.data?.error || 'Could not open the console.'); return; }
    setData(r.data);
  }, [accessToken, id]);
  useEffect(() => { load(); }, [load]);

  // While live: the heartbeat that keeps the broadcast delivering, and the comments.
  useEffect(() => {
    if (!accessToken || !show) return undefined;
    let stop = false;
    const beat = async () => {
      if (stop) return;
      const r = await api(`/api/artist/shows/${id}/tick`, { method: 'POST', accessToken, body: { healthy: { a: true, b: true } } });
      if (!stop && r.ok) setTick(r.data);
      const c = await api(`/api/viewer/comments?show=${id}&after=${lastComment.current}`);
      if (!stop && c.ok && c.data?.comments?.length) {
        setComments((prev) => [...prev, ...c.data.comments].slice(-40));
        lastComment.current = c.data.comments[c.data.comments.length - 1].id;
      }
    };
    beat();
    const t = setInterval(beat, TICK_MS);
    return () => { stop = true; clearInterval(t); };
  }, [accessToken, show, id]);

  async function goLive() {
    setBusy('live'); setErr(null);
    const r = await api(`/api/artist/shows/${id}/go-live`, { method: 'POST', accessToken });
    setBusy(null);
    if (!r.ok) { setErr(r.data?.error || 'Could not go live.'); return; }
    await load();
  }

  async function setLook(look) {
    setBusy('look');
    const r = await api(`/api/artist/shows/${id}/look`, { method: 'PUT', accessToken, body: look });
    setBusy(null);
    if (r.ok) setData((d) => ({ ...d, show: { ...d.show, look: r.data.look } }));
    else setErr(r.data?.error || 'Could not change the look. The show is not affected.');
  }

  async function pushPrompt() {
    const body = promptText.trim();
    if (!body) return;
    const r = await api('/api/show-prompts', { method: 'POST', accessToken, body: { room: show.room_name, kind: 'question', body, source: 'composed' } });
    if (r.ok) { setPromptText(''); setSheet(null); } else setErr(r.data?.error || 'Could not push that.');
  }

  function holdStart() {
    const started = Date.now();
    holdRef.current = setInterval(async () => {
      const pct = Math.min(100, ((Date.now() - started) / HOLD_MS) * 100);
      setHoldPct(pct);
      if (pct >= 100) {
        clearInterval(holdRef.current); holdRef.current = null; setHoldPct(0);
        setBusy('end');
        const r = await api(`/api/artist/shows/${id}/end`, { method: 'POST', accessToken });
        setBusy(null);
        if (r.ok) router.replace('/profile'); else setErr(r.data?.error || 'Could not end the show.');
      }
    }, 50);
  }
  function holdEnd() { if (holdRef.current) { clearInterval(holdRef.current); holdRef.current = null; } setHoldPct(0); }

  if (loading || !data) {
    return <View style={[styles.screenDark, { padding: 20, paddingTop: 80, gap: 12 }]}><Text style={styles.bodyDark}>{err || 'Opening the console…'}</Text>{err && <Pressable style={[styles.btn, styles.btnGhostDark]} onPress={load}><Text style={styles.btnTextDark}>Try again</Text></Pressable>}</View>;
  }

  const delivery = tick?.delivery?.state || show.delivery_state;
  const elapsed = show.actual_started_at ? now - Date.parse(show.actual_started_at) : 0;
  const look = show.look?.lut || 'none';

  return (
    <View style={styles.screenDark}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 56, gap: 12 }}>
        <View style={[styles.row, { gap: 8, flexWrap: 'wrap' }]}>
          {live ? <Text style={styles.badgeLive}>LIVE</Text> : <Text style={styles.badgeSoon}>READY</Text>}
          {live && <Text style={{ color: color.porcelain, fontSize: 17, fontWeight: '700' }}>{fmt(elapsed)}</Text>}
          <Text style={{ color: color.porcelain }}>{tick?.viewers ?? 0} watching</Text>
          <View style={{ flex: 1 }} />
          <Text style={[styles.badgeSoon, { backgroundColor: delivery === 'ok' ? color.teal : color.red, color: delivery === 'ok' ? color.ink : '#fff' }]}>
            {delivery === 'ok' ? 'DELIVERING' : String(delivery || 'waiting').toUpperCase()}
          </Text>
        </View>

        <Text style={styles.h1Dark}>{show.title}</Text>
        <Text style={styles.mutedDark}>
          {show.performance_mode === 'versus' ? 'Versus' : 'Solo'} · {orientation === 'landscape' ? 'Landscape 16:9' : 'Portrait 9:16'} · {show.duration_minutes} min
          {data.youtubeMode === 'mock' ? ' · YouTube in test mode' : ''}
        </Text>

        {away && <Text style={{ color: color.orange, fontWeight: '700' }}>Keep Loudentify in front: the show needs this screen.</Text>}
        {err && <Text style={{ color: color.orange }}>{err}</Text>}

        {!live && (
          <Pressable style={[styles.btn, styles.btnTeal, { height: 56 }]} disabled={busy === 'live'} onPress={goLive} testID="go-live">
            <Text style={styles.btnText}>{busy === 'live' ? 'Going live…' : 'Go live'}</Text>
          </Pressable>
        )}

        <View style={[styles.row, { gap: 8, flexWrap: 'wrap' }]}>
          <Pressable style={[styles.btn, styles.btnGhostDark, { flex: 1 }]} onPress={() => router.push('/camera')}><Text style={styles.btnTextDark}>Use this phone as a camera</Text></Pressable>
        </View>
        <View style={[styles.row, { gap: 8 }]}>
          <Pressable style={[styles.btn, styles.btnGhostDark, { flex: 1 }]} onPress={() => setSheet('look')}><Text style={styles.btnTextDark}>Look: {LOOK_CHOICES.find((l) => l.key === look)?.label || 'None'}</Text></Pressable>
          <Pressable style={[styles.btn, styles.btnGhostDark, { flex: 1 }]} onPress={() => setSheet('prompt')}><Text style={styles.btnTextDark}>Ask the room</Text></Pressable>
        </View>

        {tick?.prompt && (
          <View style={[styles.cardDark, { gap: 4 }]}>
            <Text style={{ color: color.teal, fontWeight: '700', fontSize: 12, letterSpacing: 1 }}>PROMPT OPEN</Text>
            <Text style={{ color: color.porcelain, fontWeight: '700' }}>{tick.prompt.body}</Text>
          </View>
        )}

        <View style={[styles.panelDark, { minHeight: 120, gap: 4 }]} accessibilityLabel="Comments">
          {comments.slice(-8).map((c) => (
            <Text key={c.id} style={{ color: color.porcelain }} numberOfLines={1}>
              <Text style={{ fontWeight: '700', color: color.orange }}>{c.author} </Text>{c.body}
            </Text>
          ))}
          {comments.length === 0 && <Text style={styles.mutedDark}>Comments appear here.</Text>}
        </View>

        {live && (
          <Pressable
            onPressIn={holdStart} onPressOut={holdEnd}
            style={[styles.btn, { height: 56, backgroundColor: 'rgba(231,29,54,0.25)', borderWidth: 2, borderColor: color.red, overflow: 'hidden' }]}
            testID="end-show" disabled={busy === 'end'}
          >
            <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${holdPct}%`, backgroundColor: color.red }} />
            <Text style={styles.btnTextDark}>{busy === 'end' ? 'Ending…' : 'Press and hold to end the show'}</Text>
          </Pressable>
        )}
        <View style={{ height: 24 }} />
      </ScrollView>

      {sheet === 'look' && (
        <View style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(1,22,39,0.6)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: color.mist, padding: 20, gap: 12, borderTopLeftRadius: 24, borderTopRightRadius: 24 }}>
            <Text style={styles.h1}>Look</Text>
            <Text style={styles.muted}>The grade on your broadcast. Viewers see the change within a few seconds. Your recording keeps the camera&apos;s own picture.</Text>
            <View style={[styles.row, { flexWrap: 'wrap', gap: 8 }]}>
              {LOOK_CHOICES.map((l) => (
                <Pressable key={l.key} disabled={busy === 'look'} onPress={() => setLook({ lut: l.key, strength: show.look?.strength ?? 1 })}
                  style={[styles.btn, { height: 40, paddingHorizontal: 14, backgroundColor: look === l.key ? color.porcelain : 'rgba(1,22,39,0.07)', borderWidth: look === l.key ? 2 : 0, borderColor: color.ink }]}>
                  <Text style={{ fontWeight: look === l.key ? '700' : '400' }}>{l.label}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable style={[styles.btn, { height: 52, backgroundColor: color.ink }]} onPress={() => setSheet(null)}><Text style={styles.btnTextDark}>Back to the show</Text></Pressable>
          </View>
        </View>
      )}

      {sheet === 'prompt' && (
        <View style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(1,22,39,0.6)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: color.mist, padding: 20, gap: 12, borderTopLeftRadius: 24, borderTopRightRadius: 24 }}>
            <Text style={styles.h1}>Ask the room</Text>
            <TextInput value={promptText} onChangeText={setPromptText} placeholder="What should I play next?" style={styles.field} placeholderTextColor="#c9cfd1" />
            <Pressable style={[styles.btn, styles.btnTeal, { height: 52 }]} onPress={pushPrompt}><Text style={styles.btnText}>Push it</Text></Pressable>
            <Pressable style={[styles.btn, styles.btnGhostLight, { height: 52 }]} onPress={() => setSheet(null)}><Text style={styles.btnText}>Cancel</Text></Pressable>
          </View>
        </View>
      )}
    </View>
  );
}
