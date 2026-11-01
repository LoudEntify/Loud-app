// PostShow.dc.html — "Show ended. Thank you for performing. Here is how
// it went."
//
// This screen was never reachable from the phone: ending a show dropped
// the artist back on their profile, so the four numbers the show just
// produced went unseen and the recording's visibility was never asked
// about. The console's press-and-hold now lands here.
//
// The numbers come back from the end route itself (`insights`), which is
// why they can be shown immediately; a reopen reads them from
// /api/artist/insights instead. Visibility writes to `recordings` under
// row-level security, the same way the web screen does it — there is no
// route for it, and inventing one for a single toggle is not worth the
// surface.
import { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import {
  Screen, Card, Button, Chip, ErrorPanel, Skeleton, Icon,
  color, space, radius, text, face, useLoadingPhase,
} from '../../../src/ui';
import { api } from '../../../src/api';
import { supabase, useSession } from '../../../src/session';
import { formatDuration } from '@loud/lib/insights.js';

const VISIBILITY = [
  { key: 'public', label: 'Public' },
  { key: 'unlisted', label: 'Unlisted' },
  { key: 'private', label: 'Private' },
];

export default function PostShow() {
  const { id } = useLocalSearchParams();
  const { accessToken, loading } = useSession();
  const [insights, setInsights] = useState(null);
  const [recording, setRecording] = useState(null);
  const [visibility, setVisibility] = useState('public');
  const [failed, setFailed] = useState(false);
  const phase = useLoadingPhase(insights === null && !failed);

  const load = useCallback(async () => {
    if (!accessToken || !id) return;
    setFailed(false);
    const r = await api(`/api/artist/insights?show=${id}`, { accessToken });
    if (!r.ok) { setFailed(true); return; }
    setInsights(r.data?.shows?.[0] || {});
    // The recording row is read directly: there is no route that lists one.
    const { data } = await supabase().from('recordings').select('id, title, duration_ms, visibility').eq('show_id', id).maybeSingle();
    if (data) { setRecording(data); setVisibility(data.visibility || 'public'); }
  }, [accessToken, id]);

  useEffect(() => { if (!loading) load(); }, [loading, load]);

  async function setShown(next) {
    const was = visibility;
    setVisibility(next);                       // answer the tap at once
    if (!recording?.id) return;
    const { error } = await supabase().from('recordings').update({ visibility: next }).eq('id', recording.id);
    if (error) setVisibility(was);             // and put it back if it did not take
  }

  if (phase !== 'done' && phase !== 'slow') {
    return (
      <Screen>
        <View style={{ padding: space.screenEdge, paddingTop: 56, gap: space.l }}>
          <Skeleton width={180} height={36} />
          <Skeleton width="100%" height={140} radius={16} />
          <Skeleton width="100%" height={120} radius={16} />
        </View>
      </Screen>
    );
  }

  const stats = [
    { label: 'Peak viewers', value: insights?.peak_viewers ?? 0 },
    { label: 'Watch time', value: formatDuration(insights?.watch_time_ms || 0) },
    { label: 'Votes cast', value: insights?.votes_cast ?? 0 },
    { label: 'Tokens received', value: insights?.tokens_received ?? 0 },
  ];

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: space.screenEdge, paddingTop: 56, paddingBottom: 40, gap: space.l }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ flex: 1 }} />
          <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => router.replace('/profile')} style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(1,22,39,0.07)' }}>
            <Icon.Close size={22} color={color.ink} />
          </Pressable>
        </View>

        <View style={{ gap: 4 }}>
          <Text style={text.screenTitle}>Show ended</Text>
          <Text style={text.body}>Thank you for performing. Here is how it went.</Text>
        </View>

        {failed ? <ErrorPanel title="We could not load your numbers" body="The show ended properly; this is only the summary." onRetry={load} /> : null}

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
          {stats.map((s) => (
            <Card key={s.label} style={{ width: '48%', gap: 2 }}>
              <Text style={text.supporting}>{s.label}</Text>
              <Text style={{ fontFamily: face.bold, fontSize: 28, fontWeight: '700', color: color.ink }}>{s.value}</Text>
            </Card>
          ))}
        </View>

        {recording ? (
          <Card style={{ gap: space.m }}>
            <View style={{ gap: 2 }}>
              <Text style={text.rowTitle}>Recording ready</Text>
              <Text style={text.supporting}>{recording.title} · {formatDuration(recording.duration_ms || 0)}</Text>
            </View>
            <View accessibilityRole="radiogroup" accessibilityLabel="Who can see the recording" style={{ flexDirection: 'row', gap: space.sm }}>
              {VISIBILITY.map((v) => (
                <Chip key={v.key} selected={visibility === v.key} onPress={() => setShown(v.key)} style={{ flex: 1 }}>{v.label}</Chip>
              ))}
            </View>
          </Card>
        ) : (
          <Card>
            <Text style={text.supporting}>Your recording is still being written. It appears on your profile when it is ready.</Text>
          </Card>
        )}

        <Button kind="main" onPress={() => router.push('/profile')} icon={<Icon.Film size={20} color={color.ink} />}>Make a clip</Button>
        <Button kind="quiet" size="medium" onPress={() => router.replace('/profile')}>Back to your profile</Button>
      </ScrollView>
    </Screen>
  );
}
