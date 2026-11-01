// Console.dc.html — the screen an artist holds while they play.
//
// The board, top to bottom: the LIVE pill with the clock and the viewer
// count, the director button; your own camera in a small window top right;
// what viewers are seeing filling the screen; the last few comments; the
// four actions — Prompt, Vote, Cuts, Fix — and the press-and-hold to end.
//
// Cuts is the one the board draws as a button with nothing behind it. The
// panel exists only on TabletConsole.dc.html, as four tiles (Main, Side,
// Close, B-roll) with the live one bordered teal, so the sheet here is
// built from that row and the rules in lib/liveCuts.js. Taking a cut by
// hand leaves Auto; the director button says which is in charge.
//
// Everything it calls is the API the web console calls, so the two cannot
// drift: /console on open, /tick while live, /go-live, /end, /look.
import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, AppState } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useKeepAwake } from 'expo-keep-awake';
import * as Haptics from 'expo-haptics';
import {
  Screen, MediaTile, Sheet, Button, Badge, Field, ErrorPanel, Icon,
  color, space, radius, surface, textOnDark, text, face, gradient,
} from '../../../src/ui';
import { api } from '../../../src/api';
import { useSession } from '../../../src/session';
import { LOOK_CHOICES } from '@loud/lib/direction.js';
import { showOrientation } from '@loud/lib/orientation.js';
import { CUTS, cutAvailability, resolveCut, onAirLabel, directorLabel, DEFAULT_CUT } from '@loud/lib/liveCuts.js';

const TICK_MS = 4000;
const HOLD_MS = 1500;
const clock = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export default function Console() {
  useKeepAwake();
  const { id } = useLocalSearchParams();
  const { session, loading, accessToken } = useSession();
  const [data, setData] = useState(null);
  const [tick, setTick] = useState(null);
  const [comments, setComments] = useState([]);
  const [hideComments, setHideComments] = useState(false);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(null);      // 'live' | 'end' | 'look'
  const [sheet, setSheet] = useState(null);    // 'cuts' | 'look' | 'prompt'
  const [promptText, setPromptText] = useState('');
  const [holdPct, setHoldPct] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [cut, setCut] = useState(DEFAULT_CUT);
  const [mode, setMode] = useState('auto');
  const [refused, setRefused] = useState(null);
  const holdRef = useRef(null);
  const lastComment = useRef(0);

  const show = data?.show;
  const live = Boolean(tick?.live ?? (show?.actual_started_at && !show?.actual_ended_at));
  const orientation = showOrientation(show);

  // What the Cuts sheet can offer: the rig as the console route reports
  // it, keyed by cut (lib/rigCameras.js). null — not {} — means the
  // server could not read the pairings at all, and then the old
  // single-camera assumption is the kinder answer: a show with Main
  // working beats a show with every cut refused.
  const cameras = data?.cameras ?? { main: { live: true } };
  const brollCount = data?.brollCount ?? 0;
  const rows = cutAvailability({ cameras, brollCount, settings: data?.direction || null });

  useEffect(() => { if (!loading && !session) router.replace('/login'); }, [loading, session]);
  useEffect(() => { const sub = AppState.addEventListener('change', () => {}); return () => sub.remove(); }, []);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  const load = useCallback(async () => {
    if (!accessToken || !id) return;
    const r = await api(`/api/artist/shows/${id}/console`, { accessToken });
    if (!r.ok) { setErr(r.data?.error || 'We could not open the console.'); return; }
    setData(r.data);
  }, [accessToken, id]);
  useEffect(() => { load(); }, [load]);

  // The heartbeat: it keeps the broadcast delivering and carries the cut
  // on air, so the composed frame and the egress log agree with the sheet.
  useEffect(() => {
    if (!accessToken || !show) return undefined;
    let stop = false;
    const beat = async () => {
      if (stop) return;
      const r = await api(`/api/artist/shows/${id}/tick`, {
        method: 'POST', accessToken,
        body: { healthy: { a: true, b: true }, cut, directorMode: mode },
      });
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
  }, [accessToken, show, id, cut, mode]);

  // A camera dropping moves the picture on its own, without a tap.
  useEffect(() => {
    const r = resolveCut({ current: cut, requested: null, mode, cameras, brollCount, settings: data?.direction || null });
    if (r.changed) setCut(r.role);
  }, [cameras, brollCount, cut, mode, data]);

  function takeCut(requested) {
    const r = resolveCut({ current: cut, requested, mode, cameras, brollCount, settings: data?.direction || null });
    if (r.refused) {
      setRefused(r.refused);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      return;
    }
    setRefused(null);
    setCut(r.role);
    setMode(r.mode);
    Haptics.selectionAsync().catch(() => {});
  }

  async function goLive() {
    setBusy('live'); setErr(null);
    const r = await api(`/api/artist/shows/${id}/go-live`, { method: 'POST', accessToken });
    setBusy(null);
    if (!r.ok) { setErr(r.data?.error || 'We could not start the broadcast.'); return; }
    // The show starts even when the recorder could not: say so once,
    // rather than letting the artist find out after the show that there
    // is nothing to post.
    if (r.data?.recording === false) setErr('Your show is live, but it is not being recorded. Nothing to do now — finish the show, and tell us afterwards.');
    await load();
  }

  async function setLook(look) {
    setBusy('look');
    const r = await api(`/api/artist/shows/${id}/look`, { method: 'PUT', accessToken, body: look });
    setBusy(null);
    if (r.ok) setData((d) => ({ ...d, show: { ...d.show, look: r.data.look } }));
    else setErr('We could not change the look. Your show is not affected.');
  }

  async function pushPrompt() {
    const body = promptText.trim();
    if (!body) return;
    const r = await api('/api/show-prompts', { method: 'POST', accessToken, body: { room: show.room_name, kind: 'question', body, source: 'composed' } });
    if (r.ok) { setPromptText(''); setSheet(null); } else setErr('We could not send that to viewers.');
  }

  function holdStart() {
    const started = Date.now();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    holdRef.current = setInterval(async () => {
      const pct = Math.min(100, ((Date.now() - started) / HOLD_MS) * 100);
      setHoldPct(pct);
      if (pct >= 100) {
        clearInterval(holdRef.current); holdRef.current = null; setHoldPct(0);
        setBusy('end');
        const r = await api(`/api/artist/shows/${id}/end`, { method: 'POST', accessToken });
        setBusy(null);
        if (r.ok) router.replace(`/artist/post-show/${id}`);
        else setErr('We could not end the show. Try the hold again.');
      }
    }, 50);
  }
  function holdEnd() {
    if (holdRef.current) { clearInterval(holdRef.current); holdRef.current = null; }
    setHoldPct(0);
  }

  if (loading || !data) {
    return (
      <Screen dark>
        <View style={{ flex: 1, justifyContent: 'center', padding: space.xl, gap: space.m }}>
          {err
            ? <ErrorPanel title="We could not open the console" body={err} onRetry={load} backLabel="Back to your profile" onBack={() => router.replace('/profile')} />
            : <Text style={textOnDark.body}>Opening the console…</Text>}
        </View>
      </Screen>
    );
  }

  const delivery = tick?.delivery?.state || show.delivery_state;
  const elapsed = show.actual_started_at ? now - Date.parse(show.actual_started_at) : 0;
  const viewers = tick?.viewers ?? 0;
  const lookKey = show.look?.lut || 'none';

  return (
    <Screen dark>
      {/* What viewers are seeing. The console cannot show the composed
          frame itself (it is built server-side for the broadcast), so it
          names the camera on air rather than implying a preview it does
          not have. */}
      <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: space.s }}>
        <Text style={{ fontFamily: face.regular, fontSize: 14, letterSpacing: 1.1, textTransform: 'uppercase', color: 'rgba(253,255,252,0.7)' }}>
          {live ? onAirLabel(cut) : 'Not live yet'}
        </Text>
        <Text style={{ fontFamily: face.regular, fontSize: 14, color: 'rgba(253,255,252,0.5)' }}>
          {live ? `${orientation === 'landscape' ? 'Landscape' : 'Portrait'} · ${delivery || 'starting'}` : 'Your broadcast starts when you do'}
        </Text>
      </View>

      {/* Top bar */}
      <View style={{ position: 'absolute', left: space.m, right: space.m, top: 52, flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        {live ? <Badge kind="live" /> : <Badge kind="soon">READY</Badge>}
        <Text style={{ fontFamily: face.bold, fontSize: 17, fontWeight: '700', color: color.porcelain }}>{clock(elapsed)}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: 'rgba(1,22,39,0.6)' }}>
          <Icon.Eye size={16} color={color.porcelain} />
          <Text style={{ fontFamily: face.regular, fontSize: 14, color: color.porcelain }}>{viewers}</Text>
        </View>
        <View style={{ flex: 1 }} />
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: mode === 'manual' }}
          accessibilityLabel={directorLabel(mode)}
          onPress={() => takeCut(mode === 'auto' ? cut : 'auto')}
          style={{ height: 36, paddingHorizontal: 12, borderRadius: 18, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: mode === 'manual' ? color.teal : 'rgba(1,22,39,0.6)' }}
        >
          <Icon.Sparkle size={16} color={mode === 'manual' ? color.ink : color.porcelain} />
          <Text style={{ fontFamily: face.bold, fontSize: 15, fontWeight: '700', color: mode === 'manual' ? color.ink : color.porcelain }}>
            {directorLabel(mode)}
          </Text>
        </Pressable>
      </View>

      {/* Your own camera */}
      <MediaTile
        label="You"
        accessibilityLabel="Your camera"
        style={{ position: 'absolute', right: space.m, top: 100, width: 96, height: 128, borderRadius: 14, borderWidth: 2, borderColor: 'rgba(253,255,252,0.5)', justifyContent: 'flex-end', paddingBottom: 6 }}
      />

      {/* Comments */}
      {!hideComments ? (
        <View style={{ position: 'absolute', left: space.l, bottom: 216, width: 260, gap: space.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={textOnDark.label}>Comments</Text>
            <Button kind="quietDark" size="tiny" onPress={() => setHideComments(true)}>Hide</Button>
          </View>
          <ScrollView style={{ maxHeight: 92 }} showsVerticalScrollIndicator={false}>
            {comments.slice(-6).map((c) => (
              <Text key={c.id} style={{ fontFamily: face.regular, fontSize: 16, lineHeight: 21, color: color.porcelain }} numberOfLines={2}>
                <Text style={{ fontFamily: face.bold, fontWeight: '700', color: color.orange }}>{c.author} </Text>
                {c.body}
              </Text>
            ))}
            {!comments.length ? <Text style={{ fontFamily: face.regular, fontSize: 16, color: 'rgba(253,255,252,0.6)' }}>No comments yet.</Text> : null}
          </ScrollView>
        </View>
      ) : (
        <View style={{ position: 'absolute', left: space.l, bottom: 216 }}>
          <Button kind="quietDark" size="tiny" onPress={() => setHideComments(false)}>Show comments</Button>
        </View>
      )}

      {refused ? (
        <View style={{ position: 'absolute', left: space.l, right: space.l, bottom: 180, paddingHorizontal: space.m, paddingVertical: space.s, borderRadius: 999, backgroundColor: color.ink }}>
          <Text style={{ fontFamily: face.regular, fontSize: 15, color: color.porcelain }}>{refused}</Text>
        </View>
      ) : null}

      {/* The four actions */}
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 108, flexDirection: 'row', justifyContent: 'center', gap: 18 }}>
        <Action label="Prompt" onPress={() => setSheet('prompt')}><Icon.Chat size={24} color={color.porcelain} /></Action>
        <Action label="Vote" onPress={() => setSheet('prompt')}><Icon.Chart size={24} color={color.porcelain} /></Action>
        <Action label="Cuts" onPress={() => setSheet('cuts')} testID="cuts"><Icon.Camera size={24} color={color.porcelain} /></Action>
        <Action label="Fix" emphasis onPress={() => router.push(`/artist/fix/${id}`)}><Icon.Wrench size={24} color={color.ink} /></Action>
      </View>

      {/* Go live, or end the show */}
      <View style={{ position: 'absolute', left: space.l, right: space.l, bottom: 32 }}>
        {live ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Press and hold to end show"
            onPressIn={holdStart}
            onPressOut={holdEnd}
            testID="end-show"
            style={{ height: 56, borderRadius: 28, backgroundColor: color.red, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}
          >
            {/* The hold, drawn as it fills. The board implies the gesture in
                the copy and draws no progress; without one, a hold that is
                nearly done looks the same as one that has not started. */}
            <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${holdPct}%`, backgroundColor: 'rgba(0,0,0,0.25)' }} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <Icon.Stop size={20} color={color.white} />
              <Text style={{ fontFamily: face.bold, fontSize: 19, fontWeight: '700', color: color.white }}>
                {busy === 'end' ? 'Ending the show' : 'Press and hold to end show'}
              </Text>
            </View>
          </Pressable>
        ) : (
          <Button kind="main" busy={busy === 'live'} onPress={goLive} testID="go-live">Go live</Button>
        )}
      </View>

      {err ? (
        <View style={{ position: 'absolute', left: space.l, right: space.l, bottom: 100 }}>
          <ErrorPanel title="That did not work" body={err} onRetry={() => setErr(null)} retryLabel="Dismiss" />
        </View>
      ) : null}

      {/* ── The Cuts sheet ───────────────────────────────────────────── */}
      {sheet === 'cuts' ? (
        <Sheet dark label="Cuts" onDismiss={() => setSheet(null)}>
          <View style={{ gap: 4 }}>
            <Text style={[textOnDark.sectionHeading]}>Cuts</Text>
            <Text style={textOnDark.supporting}>
              {mode === 'auto'
                ? 'The director is cutting. Take one yourself and it hands over to you.'
                : 'You are cutting. Director: Auto hands it back.'}
            </Text>
          </View>

          <View style={{ flexDirection: 'row', gap: space.s }}>
            {rows.map((c) => {
              const on = cut === c.role;
              return (
                <Pressable
                  key={c.role}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on, disabled: !c.available }}
                  accessibilityLabel={`${c.label}${c.available ? '' : `, unavailable. ${c.why}`}`}
                  testID={`cut-${c.role}`}
                  onPress={() => takeCut(c.role)}
                  style={{
                    flex: 1, height: 96, borderRadius: radius.field, overflow: 'hidden',
                    alignItems: 'center', justifyContent: 'center',
                    borderWidth: on ? 3 : 2,
                    borderStyle: c.available ? 'solid' : 'dashed',
                    borderColor: on ? color.teal : 'rgba(253,255,252,0.3)',
                    backgroundColor: gradient.base.mediaTile,
                    opacity: c.available ? 1 : 0.55,
                  }}
                >
                  <Text style={{ fontFamily: on ? face.bold : face.regular, fontSize: 15, fontWeight: on ? '700' : '400', color: color.porcelain }}>{c.label}</Text>
                  {on ? <Text style={{ fontFamily: face.bold, fontSize: 11, letterSpacing: 1, color: color.teal, marginTop: 2 }}>ON AIR</Text> : null}
                </Pressable>
              );
            })}
          </View>

          {rows.filter((c) => !c.available).map((c) => (
            <Text key={c.role} style={textOnDark.supporting}>{c.label}: {c.why}</Text>
          ))}

          <View style={{ flexDirection: 'row', gap: space.s }}>
            <Button kind="quietDark" size="medium" style={{ flex: 1 }} onPress={() => { takeCut('auto'); setSheet(null); }}>Back to Auto</Button>
            <Button kind="main" size="medium" style={{ flex: 1 }} onPress={() => setSheet('look')}>Change the look</Button>
          </View>
        </Sheet>
      ) : null}

      {/* ── The look ─────────────────────────────────────────────────── */}
      {sheet === 'look' ? (
        <Sheet dark label="Look" onDismiss={() => setSheet(null)}>
          <Text style={textOnDark.sectionHeading}>Look</Text>
          <ScrollView style={{ maxHeight: 280 }}>
            {LOOK_CHOICES.map((l) => (
              <Pressable
                key={l.key}
                accessibilityRole="radio"
                accessibilityState={{ selected: lookKey === l.key }}
                onPress={() => setLook({ lut: l.key, strength: 1 })}
                style={{ paddingVertical: space.m, flexDirection: 'row', alignItems: 'center', gap: space.m }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[textOnDark.rowTitle]}>{l.label}</Text>
                  <Text style={textOnDark.supporting}>{l.note}</Text>
                </View>
                {lookKey === l.key ? <Icon.Check size={22} color={color.teal} /> : null}
              </Pressable>
            ))}
          </ScrollView>
          <Button kind="quietDark" size="medium" busy={busy === 'look'} onPress={() => setSheet(null)}>Done</Button>
        </Sheet>
      ) : null}

      {/* ── A prompt for viewers ─────────────────────────────────────── */}
      {sheet === 'prompt' ? (
        <Sheet label="Ask viewers something" onDismiss={() => setSheet(null)}>
          <Text style={text.sectionHeading}>Ask viewers something</Text>
          <Field
            label="Your question"
            value={promptText}
            onChangeText={setPromptText}
            placeholder="What should I play next?"
            testID="prompt-text"
          />
          <Button kind="main" onPress={pushPrompt}>Send it to the show</Button>
        </Sheet>
      ) : null}
    </Screen>
  );
}

/** One of the four round actions. Fix is the emphasised one, in orange. */
function Action({ label, onPress, children, emphasis = false, testID }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} testID={testID} onPress={onPress} style={{ width: 68, alignItems: 'center', gap: 6 }}>
      <View style={{ width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: emphasis ? color.orange : surface.quietDark }}>
        {children}
      </View>
      <Text style={{ fontFamily: emphasis ? face.bold : face.regular, fontSize: 14, fontWeight: emphasis ? '700' : '400', color: color.porcelain }}>{label}</Text>
    </Pressable>
  );
}
