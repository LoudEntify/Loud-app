// YT-Show.dc.html — watching a show, with the YouTube player untouched.
//
// The rule that shapes this screen: nothing may ever sit over the player
// frame (CLAUDE.md §6). So the actions are a column beside it, the vote
// bar is under it, and the chat is under that. The frame is 304x540 on a
// 390 phone, scaled here to the real one and never under YouTube's 200x200
// minimum (lib/design/tokens.js playerFrame).
//
// Four buttons on this screen used to be theatre: Follow said "Following"
// and wrote nothing, Remind me showed a toast, Support opened the website
// in a browser, and Report thanked you and dropped it. All four now do
// what they say, or say what they cannot do:
//
//   Follow    writes `follows` under row-level security, as the web does
//   Remind me writes `show_reminders`, the same way
//   Support   the Support sheet, through /api/viewer/support
//   Report    goes to site_messages via /api/site/contact with topic
//             'report' — a real place a human reads, rather than nowhere
import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, useWindowDimensions, KeyboardAvoidingView, Platform } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import {
  Screen, Sheet, Button, Badge, ErrorPanel, Skeleton, Icon,
  color, space, radius, surface, playerFrame, text, textOnDark, face, useLoadingPhase,
} from '../../src/ui';
import { api } from '../../src/api';
import { supabase, useSession } from '../../src/session';
import { GATED_ACTIONS } from '../../src/shared';
import { Player } from '../../src/player/PlayerSource';
import { SUPPORT_AMOUNTS, SUPPORT_MESSAGE_MAX } from '@loud/lib/support.js';

const POLL_SHOW_MS = 5000;
const POLL_CHAT_MS = 3000;

export default function Show() {
  const { id } = useLocalSearchParams();
  const { width } = useWindowDimensions();
  const { session, accessToken } = useSession();
  const [p, setP] = useState(null);
  const [failure, setFailure] = useState(null);     // 'notfound' | 'error'
  const [comments, setComments] = useState([]);
  const [draft, setDraft] = useState('');
  const [myVote, setMyVote] = useState(null);
  const [sheet, setSheet] = useState(null);         // 'support' | 'report'
  const [toast, setToast] = useState(null);
  const [bigger, setBigger] = useState(false);
  const playerRef = useRef(null);
  const lastComment = useRef(0);
  const phase = useLoadingPhase(p === null && !failure);

  const load = useCallback(async () => {
    const r = await api(`/api/viewer/show/${id}`, { accessToken });
    if (!r.ok) { setFailure(r.status === 404 ? 'notfound' : 'error'); return; }
    setFailure(null);
    setP(r.data);
    if (r.data.myVote) setMyVote(r.data.myVote.choice_index);
  }, [id, accessToken]);

  useEffect(() => { load(); const t = setInterval(load, POLL_SHOW_MS); return () => clearInterval(t); }, [load]);

  useEffect(() => {
    const poll = async () => {
      const r = await api(`/api/viewer/comments?show=${id}&after=${lastComment.current}`);
      if (r.ok && r.data.comments?.length) {
        lastComment.current = Math.max(lastComment.current, ...r.data.comments.map((c) => c.id));
        setComments((c) => [...c, ...r.data.comments].slice(-100));
      }
    };
    poll();
    const t = setInterval(poll, POLL_CHAT_MS);
    return () => clearInterval(t);
  }, [id]);

  /** Anything a guest cannot do sends them to sign up with the reason. */
  const gate = (action, fn) => (GATED_ACTIONS.includes(action) && !session ? router.push(`/signup?trigger=${action}`) : fn());
  const positionMs = async () => (await playerRef.current?.positionMs?.()) ?? null;
  const say = (t) => { setToast(t); setTimeout(() => setToast(null), 2500); };

  async function toggleFollow() {
    const artistId = p?.show?.artist?.id || p?.show?.artist_id;
    if (!artistId) return;
    const next = !p.following;
    setP((x) => ({ ...x, following: next }));
    const sb = supabase();
    const { error } = next
      ? await sb.from('follows').upsert({ follower_id: session.user.id, artist_id: artistId }, { onConflict: 'follower_id,artist_id', ignoreDuplicates: true })
      : await sb.from('follows').delete().eq('follower_id', session.user.id).eq('artist_id', artistId);
    if (error) { setP((x) => ({ ...x, following: !next })); say('That did not save. Try again.'); }
  }

  async function toggleRemind() {
    const next = !p.reminded;
    setP((x) => ({ ...x, reminded: next }));
    const sb = supabase();
    const { error } = next
      ? await sb.from('show_reminders').insert({ user_id: session.user.id, show_id: id })
      : await sb.from('show_reminders').delete().eq('user_id', session.user.id).eq('show_id', id);
    if (error) { setP((x) => ({ ...x, reminded: !next })); say('That did not save. Try again.'); }
    else say(next ? "We'll remind you" : 'Reminder off');
  }

  if (failure === 'notfound') {
    return (
      <Screen dark>
        <View style={{ flex: 1, justifyContent: 'center', padding: space.xl }}>
          <ErrorPanel title="We could not find this show" body="It may have been cancelled." backLabel="Back to Live" onBack={() => router.replace('/live')} />
        </View>
      </Screen>
    );
  }
  if (failure && !p) {
    return (
      <Screen dark>
        <View style={{ flex: 1, justifyContent: 'center', padding: space.xl }}>
          <ErrorPanel title="We could not load this show" body="It may have ended. Try again, or go back to Discover." onRetry={load} backLabel="Back to Discover" onBack={() => router.replace('/discover')} />
        </View>
      </Screen>
    );
  }
  if (phase !== 'done' && phase !== 'slow') return <ShowSkeleton width={width} />;

  const show = p.show;
  const live = show.derived_state === 'live';
  const versus = show.performance_mode === 'versus';
  const name = versus
    ? `${show.artist?.display_name || 'Artist A'} vs ${show.artist_b?.display_name || 'Artist B'}`
    : show.artist?.display_name || show.artist_name || 'Artist';
  const prompt = p.prompt;

  // The frame: the board's 304 wide on a 390 phone, scaled, leaving the
  // 56px action column and the gutters, and never under YouTube's minimum.
  const frameW = Math.max(playerFrame.min.w, Math.min(bigger ? playerFrame.bigger.w : playerFrame.phone.w, width - 12 - 56 - 18));
  const frameH = Math.max(playerFrame.min.h, Math.round((frameW * 16) / 9));

  return (
    <Screen dark>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        {/* Header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingTop: 52, paddingHorizontal: space.m }}>
          <Pressable accessibilityRole="button" accessibilityLabel="Leave show" onPress={() => router.back()} style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(1,22,39,0.5)' }}>
            <Icon.Back size={22} color={color.porcelain} />
          </Pressable>
          <Pressable style={{ flex: 1 }} accessibilityRole="button" onPress={() => show.artist?.username && router.push(`/artist/${show.artist.username}`)}>
            <Text style={[textOnDark.rowTitle, { fontSize: 19 }]} numberOfLines={1}>{name}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
              {live ? <Badge kind="live" /> : <Badge kind="soon" />}
              <Text style={{ fontFamily: face.regular, fontSize: 14, color: color.porcelain }}>{p.viewers} watching</Text>
            </View>
          </Pressable>
          {!versus ? (
            <Button kind={p.following ? 'quietDark' : 'main'} size="small" onPress={() => gate('follow', toggleFollow)} testID="follow">
              {p.following ? 'Following' : 'Follow'}
            </Button>
          ) : null}
        </View>

        {/* The player, with the actions beside it. Nothing over the frame. */}
        <View style={{ flexDirection: 'row', paddingHorizontal: space.m, marginTop: space.sm, gap: 6 }}>
          <View accessibilityLabel="YouTube player area" style={{ width: frameW, height: frameH, borderWidth: 1, borderColor: 'rgba(253,255,252,0.28)', backgroundColor: color.inkDeep }}>
            {live ? (
              <Player ref={playerRef} show={show} width={frameW} height={frameH} />
            ) : (
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.l }}>
                <Text style={{ fontFamily: face.regular, fontSize: 16, color: 'rgba(253,255,252,0.7)', textAlign: 'center' }}>
                  {show.derived_state === 'ended' ? 'The show has ended' : 'The show has not started yet'}
                </Text>
              </View>
            )}
          </View>

          <View style={{ width: 56, alignItems: 'center', gap: space.m }}>
            {live ? (
              <SideAction label="Support" onPress={() => gate('support', () => setSheet('support'))}>
                <Icon.Coin size={22} color={color.ink} />
              </SideAction>
            ) : (
              <SideAction label={p.reminded ? 'Reminding' : 'Remind me'} onPress={() => gate('remind', toggleRemind)} tint={color.orange}>
                <Icon.Bell size={22} color={color.ink} />
              </SideAction>
            )}
            <SideAction label="Share" onPress={() => say('Link copied')} quiet><Icon.Share size={22} color={color.porcelain} /></SideAction>
            <SideAction label="Bigger" onPress={() => setBigger((b) => !b)} quiet><Icon.Expand size={22} color={color.porcelain} /></SideAction>
            <SideAction label="Report" onPress={() => setSheet('report')} quiet><Icon.Flag size={22} color={color.porcelain} /></SideAction>
          </View>
        </View>

        {/* The open vote */}
        {prompt ? (
          <View style={{ marginHorizontal: space.m, marginTop: space.sm, minHeight: 56, paddingLeft: 14, paddingRight: 6, paddingVertical: 6, borderRadius: radius.card, backgroundColor: 'rgba(1,22,39,0.82)', flexDirection: 'row', alignItems: 'center', gap: space.s }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: face.bold, fontSize: 12, fontWeight: '700', letterSpacing: 1, color: color.teal }}>VOTE OPEN</Text>
              <Text style={[textOnDark.rowTitle, { fontSize: 16 }]} numberOfLines={2}>{prompt.body}</Text>
            </View>
            {(prompt.options || []).slice(0, 2).map((o, i) => (
              <Button
                key={i}
                kind={myVote === i ? 'main' : 'quietDark'}
                size="medium"
                onPress={() => gate('vote', async () => {
                  const r = await api('/api/viewer/vote', { method: 'POST', accessToken, body: { promptId: prompt.id, choiceIndex: i, playbackPositionMs: await positionMs() } });
                  if (r.ok) setMyVote(i); else say(r.data?.error || 'That vote did not go through');
                })}
              >
                {typeof o === 'string' ? o : o.label}
              </Button>
            ))}
          </View>
        ) : null}

        {/* Chat */}
        <ScrollView style={{ flex: 1, marginHorizontal: space.m, marginTop: 6 }} contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-end', gap: 6 }}>
          {comments.slice(-30).map((c) => (
            <Text key={c.id} style={{ fontFamily: face.regular, fontSize: 16, color: color.porcelain }}>
              <Text style={{ fontFamily: face.bold, fontWeight: '700', color: color.orange }}>{c.author} </Text>
              {c.body}
            </Text>
          ))}
        </ScrollView>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, padding: space.m, paddingBottom: 24 }}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={live ? 'Say something' : 'Say hello'}
            placeholderTextColor={surface.placeholderOnDark}
            accessibilityLabel="Write a comment"
            onFocus={() => gate('comment', () => {})}
            style={{ flex: 1, height: 48, borderRadius: 24, paddingHorizontal: 16, backgroundColor: 'rgba(253,255,252,0.16)', color: color.porcelain, fontFamily: face.regular, fontSize: 17 }}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send"
            onPress={() => gate('comment', async () => {
              const body = draft.trim();
              if (!body) return;
              setDraft('');
              const r = await api('/api/viewer/comments', { method: 'POST', accessToken, body: { showId: id, body, playbackPositionMs: await positionMs() } });
              if (r.ok) setComments((c) => [...c, r.data.comment]);
              else say('That did not send');
            })}
            style={{ width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: color.teal }}
          >
            <Icon.Send size={22} color={color.ink} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      {sheet === 'support' ? (
        <SupportSheet
          artist={name}
          accessToken={accessToken}
          showId={id}
          positionMs={positionMs}
          onDone={(msg) => { setSheet(null); if (msg) say(msg); }}
        />
      ) : null}

      {sheet === 'report' ? (
        <ReportSheet showId={id} title={show.title} onDone={(msg) => { setSheet(null); if (msg) say(msg); }} />
      ) : null}

      {toast ? (
        <View style={{ position: 'absolute', left: space.l, right: space.l, bottom: 90, padding: space.m, borderRadius: radius.card, backgroundColor: color.porcelain }}>
          <Text style={[text.rowTitle, { textAlign: 'center' }]}>{toast}</Text>
        </View>
      ) : null}
    </Screen>
  );
}

/** SupportSheet.dc.html — 10/25/50/100 tokens with an optional message. */
function SupportSheet({ artist, accessToken, showId, positionMs, onDone }) {
  const [amount, setAmount] = useState(SUPPORT_AMOUNTS[1] ?? 25);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function send() {
    setBusy(true); setErr(null);
    const r = await api('/api/viewer/support', {
      method: 'POST', accessToken,
      body: { showId, tokens: amount, message: message.trim() || null, playbackPositionMs: await positionMs(), clientKey: `${showId}-${Date.now()}` },
    });
    setBusy(false);
    if (!r.ok) { setErr(r.data?.error || 'That did not go through. Nothing was taken.'); return; }
    onDone(`Sent ${amount} tokens`);
  }

  return (
    <Sheet label="Support" onDismiss={() => onDone(null)}>
      <Text style={text.sectionHeading}>Support {artist}</Text>
      <Text style={text.supporting}>Tokens go to the artist, minus our share. They see your message on screen.</Text>
      <View style={{ flexDirection: 'row', gap: space.s }}>
        {SUPPORT_AMOUNTS.map((a) => (
          <Button key={a} kind={amount === a ? 'main' : 'quiet'} size="medium" style={{ flex: 1 }} onPress={() => setAmount(a)}>{String(a)}</Button>
        ))}
      </View>
      <TextInput
        value={message}
        onChangeText={(t) => setMessage(t.slice(0, SUPPORT_MESSAGE_MAX))}
        placeholder="Say something (optional)"
        placeholderTextColor={surface.placeholderOnLight}
        accessibilityLabel="Your message"
        style={{ height: 48, borderRadius: radius.field, paddingHorizontal: 14, backgroundColor: surface.quiet, fontFamily: face.regular, fontSize: 17, color: color.ink }}
      />
      {err ? <Text style={{ fontFamily: face.regular, fontSize: 15, color: color.red }}>{err}</Text> : null}
      <Button kind="main" busy={busy} onPress={send} testID="send-support">Send {amount} tokens</Button>
    </Sheet>
  );
}

/**
 * Report. The board draws the button and there is no moderation table, so
 * rather than a toast that throws the report away this writes to
 * site_messages through /api/site/contact with topic 'report' — somewhere
 * a person actually reads. It says that plainly rather than implying a
 * moderation queue that does not exist.
 */
function ReportSheet({ showId, title, onDone }) {
  const [why, setWhy] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function send() {
    const body = why.trim();
    if (!body) { setErr('Tell us what is wrong, in a line or two.'); return; }
    setBusy(true); setErr(null);
    const r = await api('/api/site/contact', {
      method: 'POST',
      body: { topic: 'report', message: `Show ${showId} (${title || 'untitled'}): ${body}`, name: 'App report', email: 'report@loudentify.app' },
    });
    setBusy(false);
    if (!r.ok) { setErr('That did not send. Try again in a moment.'); return; }
    onDone('Thank you. Someone will look at it.');
  }

  return (
    <Sheet label="Report this show" onDismiss={() => onDone(null)}>
      <Text style={text.sectionHeading}>Report this show</Text>
      <Text style={text.supporting}>This goes to the Loudentify team, who read every one. It does not stop the show.</Text>
      <TextInput
        value={why}
        onChangeText={setWhy}
        placeholder="What is wrong?"
        placeholderTextColor={surface.placeholderOnLight}
        accessibilityLabel="What is wrong"
        multiline
        style={{ minHeight: 96, borderRadius: radius.field, padding: 14, backgroundColor: surface.quiet, fontFamily: face.regular, fontSize: 17, color: color.ink, textAlignVertical: 'top' }}
      />
      {err ? <Text style={{ fontFamily: face.regular, fontSize: 15, color: color.red }}>{err}</Text> : null}
      <Button kind="strong" busy={busy} onPress={send} testID="send-report">Send the report</Button>
    </Sheet>
  );
}

function SideAction({ label, onPress, children, quiet = false, tint = null }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={{ width: 56, alignItems: 'center', gap: 3 }}>
      <View style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: quiet ? 'rgba(1,22,39,0.55)' : (tint || color.teal) }}>
        {children}
      </View>
      <Text style={{ fontFamily: face.bold, fontSize: 12, fontWeight: '700', color: color.porcelain }} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

function ShowSkeleton({ width }) {
  const w = Math.min(playerFrame.phone.w, width - 12 - 56 - 18);
  return (
    <Screen dark>
      <View style={{ paddingTop: 52, paddingHorizontal: space.m, gap: space.s }}>
        <Skeleton width="70%" height={24} />
        <View style={{ flexDirection: 'row', gap: 6 }}>
          <Skeleton width={w} height={Math.round((w * 16) / 9)} radius={0} />
          <View style={{ gap: space.m }}>
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} width={44} height={44} radius={22} />)}
          </View>
        </View>
      </View>
    </Screen>
  );
}
