// Live.dc.html / LiveLoading.dc.html — what is on, and what is next.
//
// A light screen: the title with Search and Inbox beside it, a row of
// filter chips, "Live now" as two-up cover tiles with a red dot beside the
// heading, then "Starting soon" as rows with a Remind me button, and the
// competitions card at the foot.
//
// The chips filter on the device from what the route already returned,
// rather than refetching per tap: the list is small, and a filter that
// waits on the network feels broken.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import {
  Screen, Card, MediaTile, Chip, Badge, Button, Empty, ErrorPanel, Skeleton, Icon,
  color, space, size, radius, text, face, useLoadingPhase,
} from '../../src/ui';
import { api } from '../../src/api';
import { supabase, useSession } from '../../src/session';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'following', label: 'Following' },
  { key: 'solo', label: 'Solo' },
  { key: 'versus', label: 'Versus' },
];

const showName = (s) => (s.performance_mode === 'versus'
  ? `${s.artist?.display_name || 'Artist A'} vs ${s.artist_b?.display_name || 'Artist B'}`
  : s.artist?.display_name || s.artist_name || 'Artist');

const minutesUntil = (iso) => Math.max(0, Math.round((Date.parse(iso) - Date.now()) / 60000));

export default function Live() {
  const { width } = useWindowDimensions();
  const { accessToken, loading } = useSession();
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState('all');
  const phase = useLoadingPhase(data === null && !failed);

  const load = useCallback(async () => {
    setFailed(false);
    const r = await api('/api/viewer/live', { accessToken });
    if (!r.ok) { setFailed(true); return; }
    setData(r.data);
  }, [accessToken]);

  useEffect(() => { if (!loading) load(); }, [loading, load]);

  const match = useCallback((s) => {
    if (filter === 'all') return true;
    if (filter === 'following') return !!s.followed;
    if (filter === 'solo') return s.performance_mode !== 'versus';
    if (filter === 'versus') return s.performance_mode === 'versus';
    return (s.genre || '').toLowerCase() === filter.toLowerCase();
  }, [filter]);

  const genreChips = useMemo(
    () => (data?.genres || []).slice(0, 4).map((g) => ({ key: g, label: g })),
    [data],
  );

  const liveNow = (data?.liveNow || []).filter(match);
  const soon = (data?.soon || []).filter(match);
  const upcoming = (data?.upcoming || []).filter(match);
  const tile = (width - space.screenEdge * 2 - space.s) / 2;

  if (phase !== 'done' && phase !== 'slow') return <LiveSkeleton tile={tile} />;

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: space.screenEdge, paddingTop: 56, paddingBottom: 120, gap: space.l }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <Text style={[text.screenTitle, { flex: 1, fontSize: 36 }]}>Live</Text>
          <RoundAction label="Search" onPress={() => router.push('/search')}><Icon.Search size={22} color={color.ink} /></RoundAction>
          <RoundAction label="Inbox" onPress={() => router.push('/inbox')}><Icon.Bell size={22} color={color.ink} /></RoundAction>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm, paddingRight: space.l }}>
          {[...FILTERS, ...genreChips].map((c) => (
            <Chip key={c.key} selected={filter === c.key} onPress={() => setFilter(c.key)}>{c.label}</Chip>
          ))}
        </ScrollView>

        {failed && !data ? (
          <ErrorPanel title="We could not load Live" body="It may be the connection. Try again." onRetry={load} />
        ) : null}

        <View style={{ gap: space.s }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color.red }} />
            <Text style={[text.sectionHeading, { flex: 1 }]}>Live now</Text>
          </View>

          {liveNow.length ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
              {liveNow.map((s) => <CoverTile key={s.id} show={s} width={tile} />)}
            </View>
          ) : (
            <Empty
              icon={<Icon.Eye size={24} color={color.ink} />}
              title="Nothing live right now"
              body={soon.length ? `${soon.length} ${soon.length === 1 ? 'show starts' : 'shows start'} later today.` : 'Shows are booked at least thirty minutes ahead.'}
              actionLabel={soon.length ? undefined : 'Open Discover'}
              onAction={() => router.push('/discover')}
              testID="live-empty"
            />
          )}
        </View>

        {soon.length ? (
          <View style={{ gap: space.s }}>
            <Text style={text.sectionHeading}>Starting soon</Text>
            {soon.map((s) => <SoonRow key={s.id} show={s} />)}
          </View>
        ) : null}

        {upcoming.length ? (
          <View style={{ gap: space.s }}>
            <Text style={text.sectionHeading}>Later on</Text>
            {upcoming.map((s) => <SoonRow key={s.id} show={s} />)}
          </View>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Monthly genre competitions, coming soon"
          onPress={() => router.push('/competitions')}
          style={{ flexDirection: 'row', alignItems: 'center', gap: space.m, backgroundColor: color.ink, borderRadius: radius.cardLg, padding: space.l }}
        >
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ fontFamily: face.bold, fontSize: 19, fontWeight: '700', color: color.porcelain }}>Monthly genre competitions</Text>
            <Text style={{ fontFamily: face.regular, fontSize: 15, color: color.mutedOnDark }}>Coming soon</Text>
          </View>
          <Icon.Chevron size={22} color={color.porcelain} />
        </Pressable>
      </ScrollView>
    </Screen>
  );
}

function CoverTile({ show, width }) {
  const versus = show.performance_mode === 'versus';
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={showName(show)} onPress={() => router.push(`/show/${show.id}`)} style={{ width }}>
      <MediaTile style={{ width, height: 200, borderRadius: radius.card }}>
        <View style={{ position: 'absolute', left: space.s, top: space.s, flexDirection: 'row', gap: 6 }}>
          <Badge kind="live" />
        </View>
        {versus ? <View style={{ position: 'absolute', right: space.s, top: space.s }}><Badge kind="versus" /></View> : null}
        {show.viewers != null ? (
          <View style={{ position: 'absolute', left: space.s, bottom: space.s, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: 'rgba(1,22,39,0.6)' }}>
            <Icon.Eye size={16} color={color.porcelain} />
            <Text style={{ fontFamily: face.regular, fontSize: 14, color: color.porcelain }}>{show.viewers}</Text>
          </View>
        ) : null}
      </MediaTile>
      <View style={{ paddingTop: 6, gap: 2 }}>
        <Text style={text.rowTitle} numberOfLines={1}>{showName(show)}</Text>
        <Text style={text.supporting} numberOfLines={1}>{show.title}</Text>
      </View>
    </Pressable>
  );
}

/**
 * "Remind me", which until now only opened the show.
 *
 * A reminder is a row in `show_reminders` written by its owner under
 * row-level security — there is no route, and the web writes it the same
 * way (components/viewer/LiveTab.jsx). A guest is sent to sign up, because
 * a reminder needs somebody to remind.
 */
function RemindButton({ show }) {
  const { session } = useSession();
  const [on, setOn] = useState(!!show.reminded);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (!session?.user?.id) { router.push('/signup?trigger=remind'); return; }
    const next = !on;
    setOn(next);                      // answer the tap at once
    setBusy(true);
    const sb = supabase();
    const { error } = next
      ? await sb.from('show_reminders').insert({ user_id: session.user.id, show_id: show.id })
      : await sb.from('show_reminders').delete().eq('user_id', session.user.id).eq('show_id', show.id);
    setBusy(false);
    if (error) setOn(!next);          // and put it back if it did not take
  }

  return (
    <Button
      kind={on ? 'main' : 'quiet'}
      size="small"
      busy={busy}
      onPress={toggle}
      icon={<Icon.Bell size={18} color={color.ink} />}
    >
      {on ? 'Reminding' : 'Remind me'}
    </Button>
  );
}

function SoonRow({ show }) {
  const mins = minutesUntil(show.slated_at);
  return (
    <Card style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>
      <MediaTile style={{ width: 64, height: 64, borderRadius: radius.field }} />
      <Pressable style={{ flex: 1, gap: 2 }} accessibilityRole="button" onPress={() => router.push(`/show/${show.id}`)}>
        <Text style={text.rowTitle} numberOfLines={1}>{showName(show)}</Text>
        <Text style={text.supporting} numberOfLines={1}>{show.title}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color.orange }} />
          <Text style={text.supporting}>
            {mins > 90
              ? new Date(show.slated_at).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' })
              : `Starts in ${mins} min`}
          </Text>
        </View>
      </Pressable>
      <RemindButton show={show} />
    </Card>
  );
}

const RoundAction = ({ label, onPress, children }) => (
  <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={{ width: size.touch, height: size.touch, borderRadius: size.touch / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(1,22,39,0.07)' }}>
    {children}
  </Pressable>
);

function LiveSkeleton({ tile }) {
  return (
    <Screen>
      <View style={{ padding: space.screenEdge, paddingTop: 56, gap: space.l }}>
        <Skeleton width={120} height={36} />
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          {[72, 96, 72, 88].map((w, i) => <Skeleton key={i} width={w} height={36} radius={18} />)}
        </View>
        <Skeleton width={140} height={22} />
        <View style={{ flexDirection: 'row', gap: space.s }}>
          <Skeleton width={tile} height={200} radius={16} />
          <Skeleton width={tile} height={200} radius={16} />
        </View>
        <Skeleton width={160} height={22} />
        <Skeleton width="100%" height={88} radius={16} />
      </View>
    </Screen>
  );
}
