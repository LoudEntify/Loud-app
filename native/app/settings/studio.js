// StudioLibrary.dc.html — backing tracks, cue sheets, B-roll.
//
// Four tabs rather than the board's three: set lists are part of this
// library (/api/set-lists), they have no other screen on the phone, and
// leaving them out would make an artist's running orders unreachable.
//
// Listing and deleting are real on every tab. UPLOADING IS NOT, and the
// board's "Upload B-roll" button is therefore not drawn: picking a file
// needs a document picker this build does not carry, and a button that
// opens nothing is the exact thing this rebuild exists to remove. The
// line where it would have been says where uploading does work.
//
// B-roll has no list route. The clips are read straight from
// `broll_clips` under row-level security, which is what the website does
// (components/BRollLibrary.jsx) — inventing an endpoint would give
// "your clips" a second definition that could drift from the policy
// already deciding it.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { router } from 'expo-router';
import {
  Screen, Card, MediaTile, Button, Chip, Sheet, Row, ScreenHeader,
  Empty, ErrorPanel, Skeleton, Icon,
  color, space, radius, surface, text, useLoadingPhase,
} from '../../src/ui';
import { NotStored } from '../../src/settings';
import { pickFile, uploadFile } from '../../src/upload';
import { api } from '../../src/api';
import { supabase, useSession, AUTH_CONFIGURED } from '../../src/session';
import { MAX_TOTAL_BYTES, megabytes } from '@loud/lib/mediaQuota.js';
import { fetchTrack } from '../../src/trackLoader';
import { useBackingTrack } from '../../src/backingTrack';

const TABS = [
  { key: 'tracks', label: 'Backing tracks' },
  { key: 'cues', label: 'Cue sheets' },
  { key: 'broll', label: 'B-roll' },
  { key: 'sets', label: 'Set lists' },
];

export default function StudioLibrary() {
  const { session, accessToken, loading } = useSession();
  const userId = session?.user?.id || null;
  const [tab, setTab] = useState('tracks');
  const [lib, setLib] = useState(null);
  const [failed, setFailed] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [options, setOptions] = useState(null);     // the item whose sheet is open
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [uploadError, setUploadError] = useState(null);
  // Cueing a track for the show. The transport lives outside this screen
  // (src/backingTrackHost.js), so a track cued here is the one the
  // console finds, and leaving this screen does not unload it.
  const backing = useBackingTrack();
  const [cueing, setCueing] = useState(null);       // the track being prepared
  const [cueProgress, setCueProgress] = useState(0);
  const [cueError, setCueError] = useState(null);
  const phase = useLoadingPhase(lib === null && !failed);

  const load = useCallback(async () => {
    if (!accessToken) return;
    setFailed(false);
    setActionError(null);
    const [tracks, cues, sets] = await Promise.all([
      api('/api/tracks', { accessToken }),
      api('/api/cue-sheets?all=1', { accessToken }),
      api('/api/set-lists', { accessToken }),
    ]);
    const broll = userId && AUTH_CONFIGURED
      ? await supabase().from('broll_clips')
        .select('id, title, storage_path, size_bytes, duration_ms, created_at')
        .eq('artist_id', userId).order('created_at', { ascending: false })
      : { data: [], error: null };

    // Every tab fails on its own. One dead endpoint must not empty the
    // other three, so each list is either rows or null, and null is what
    // the tab reports as "we could not read this".
    if (!tracks.ok && !cues.ok && !sets.ok && broll.error) { setFailed(true); return; }
    setLib({
      tracks: tracks.ok ? (tracks.data?.tracks || []) : null,
      quota: tracks.ok ? (tracks.data?.quota || null) : null,
      cues: cues.ok ? (cues.data?.sheets || []) : null,
      broll: broll.error ? null : (broll.data || []),
      sets: sets.ok ? (sets.data?.setLists || []) : null,
    });
  }, [accessToken, userId]);

  useEffect(() => { if (!loading) load(); }, [loading, load]);

  /** Delete one item. Each kind has its own route; all four are owner-scoped. */
  // Pick, upload, register — src/upload.js, the same three steps and
  // the same routes the website uses. The list is re-read afterwards
  // rather than having the new row pushed in by hand: the server knows
  // the duration, the real size and the quota, and guessing any of them
  // here would be a second answer that could disagree.
  async function startUpload(kind) {
    setUploadError(null);
    const file = await pickFile(kind).catch((e) => { setUploadError(String(e?.message || e)); return null; });
    if (!file) return;
    setUploading(true); setProgress(0);
    const r = await uploadFile({ kind, file, accessToken, onProgress: setProgress });
    setUploading(false); setProgress(0);
    if (!r.ok) { setUploadError(r.error); return; }
    await load();
  }

  /**
   * Fetch a track and hand it to the mixer.
   *
   * `headphones` is the artist's own answer, not a sensor reading: the
   * capturer reports no audio routes, and the rule that a track needs
   * headphones is a real one (through the speaker the microphone hears
   * the track too, so it goes out twice). Kit Check asks the same
   * question the same way, for the same reason.
   */
  async function cueTrack(item, headphones) {
    setCueError(null);
    setCueProgress(0);
    setCueing(item);
    const got = await fetchTrack({
      id: item.id,
      rowHash: item.sha256,
      accessToken,
      onProgress: setCueProgress,
    });
    if (!got.ok) { setCueError(got.reason); setCueing(null); return; }

    const loaded = await backing.load({
      path: got.path,
      trackId: item.id,
      // Both hashes are the row's: fetchTrack has already proved the
      // file on disk matches it, and re-hashing here would read a 30MB
      // file a second time to learn the same thing.
      rowHash: item.sha256,
      fileHash: item.sha256,
      headphones,
    });
    setCueing(null);
    if (!loaded.ok) { setCueError(backing.error || 'That track did not load.'); return; }
    setOptions(null);
  }

  async function remove(item) {
    setOptions(null);
    setBusyId(item.id);
    setActionError(null);
    const r = item.kind === 'tracks' ? await api('/api/tracks/delete', { method: 'POST', accessToken, body: { id: item.id } })
      : item.kind === 'broll' ? await api('/api/broll/delete', { method: 'POST', accessToken, body: { id: item.id } })
        : item.kind === 'cues' ? await api(`/api/cue-sheets?id=${encodeURIComponent(item.id)}`, { method: 'DELETE', accessToken })
          : await api(`/api/set-lists?id=${encodeURIComponent(item.id)}`, { method: 'DELETE', accessToken });
    setBusyId(null);
    // The routes refuse for good reasons — a track inside a set list is
    // the one that catches people — and they say why in a sentence, so
    // that sentence is what is shown rather than a generic failure.
    if (!r.ok) { setActionError(r.data?.error || 'That did not delete. Nothing has been removed.'); return; }
    load();
  }

  const used = useMemo(() => {
    if (lib?.quota) return lib.quota.used;
    // No quota from the route (it is only returned with the tracks read)
    // means the usage cannot be stated, not that it is zero.
    return null;
  }, [lib]);

  if (phase === 'loading') return <StudioSkeleton />;

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingTop: 52, paddingBottom: 120, gap: space.l }}>
        <ScreenHeader title="Studio library" onBack={() => router.push('/settings')} />

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm, paddingHorizontal: space.screenEdge }}>
          <View accessibilityRole="tablist" accessibilityLabel="Library" style={{ flexDirection: 'row', gap: space.sm }}>
            {TABS.map((t) => (
              <Chip key={t.key} role="tab" selected={tab === t.key} onPress={() => setTab(t.key)} testID={`studio-${t.key}`}>
                {t.label}
              </Chip>
            ))}
          </View>
        </ScrollView>

        <View style={{ paddingHorizontal: space.screenEdge, gap: space.l }}>
          {failed || (!lib && phase === 'slow') ? (
            <ErrorPanel
              title="We could not load your library"
              body="It may be the connection. Try again."
              onRetry={load}
              backLabel="Back to Settings"
              onBack={() => router.push('/settings')}
            />
          ) : null}

          {actionError ? <ErrorPanel title="That did not delete" body={actionError} onRetry={load} /> : null}

          {/* Storage is one allowance across tracks and B-roll
              (lib/mediaQuota.js), so it is shown on every tab rather than
              only on the one the board drew it on. */}
          <Card style={{ gap: space.sm }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text style={[text.rowTitle, { flex: 1 }]}>Storage</Text>
              <Text style={text.body}>
                {used == null ? 'Not known' : `${megabytes(used)} MB of ${megabytes(MAX_TOTAL_BYTES)} MB`}
              </Text>
            </View>
            {used == null ? null : (
              <View
                accessibilityRole="progressbar"
                accessibilityLabel="Storage used"
                accessibilityValue={{ min: 0, max: 100, now: Math.round((used / MAX_TOTAL_BYTES) * 100) }}
                style={{ height: 8, borderRadius: 4, backgroundColor: surface.quiet, overflow: 'hidden' }}
              >
                <View style={{ width: `${Math.min(100, Math.round((used / MAX_TOTAL_BYTES) * 100))}%`, height: '100%', borderRadius: 4, backgroundColor: color.teal }} />
              </View>
            )}
            <Text style={text.supporting}>Up to 100 MB per video. Sound is muted when you upload.</Text>
          </Card>

          {/* The board draws "Upload B-roll" here. It was not drawn
              because picking a file needed a document picker the build
              did not carry, so an artist standing in a venue could not
              add a clip or a track without going to a laptop. The same
              three steps the website uses (src/upload.js), through the
              same routes, so there is one storage layout and one set of
              quota rules. */}
          {tab === 'tracks' || tab === 'broll' ? (
            <View style={{ gap: space.s }}>
              <Button
                kind="main"
                busy={uploading}
                onPress={() => startUpload(tab === 'tracks' ? 'track' : 'broll')}
                testID={`studio-upload-${tab}`}
              >
                {uploading
                  ? `Uploading ${Math.round(progress * 100)}%`
                  : tab === 'tracks' ? 'Upload a backing track' : 'Upload B-roll'}
              </Button>
              {uploading ? (
                <View style={{ height: 8, borderRadius: 4, backgroundColor: 'rgba(1,22,39,0.12)', overflow: 'hidden' }}>
                  <View style={{ width: `${Math.round(progress * 100)}%`, height: '100%', borderRadius: 4, backgroundColor: color.teal }} />
                </View>
              ) : null}
              {uploadError ? (
                <ErrorPanel title="That upload did not finish" body={uploadError} onRetry={() => setUploadError(null)} retryLabel="Dismiss" />
              ) : null}
            </View>
          ) : (
            <NotStored testID="studio-no-upload">
              Set lists and cue sheets are built on loudentify.app and appear here.
            </NotStored>
          )}

          {tab === 'tracks' ? (
            <ItemList
              rows={lib?.tracks}
              kind="tracks"
              emptyTitle="No backing tracks"
              emptyBody="Tracks you upload on the website appear here, ready to pick before a show."
              icon={<Icon.Note size={22} color={color.ink} />}
              describe={(t) => [t.title || t.original_filename || 'Untitled track', [msToClock(t.duration_ms), bytesLine(t.size_bytes)].filter(Boolean).join(' · ')]}
              busyId={busyId}
              onOptions={setOptions}
            />
          ) : null}

          {tab === 'cues' ? (
            <ItemList
              rows={lib?.cues}
              kind="cues"
              emptyTitle="No cue sheets"
              emptyBody="A cue sheet is the list of moves for one track. They are written on the console while you rehearse."
              icon={<Icon.Sparkle size={22} color={color.ink} />}
              describe={(s) => [s.name || s.track_label || 'Untitled sheet', `${(s.cues || []).length} ${(s.cues || []).length === 1 ? 'cue' : 'cues'}`]}
              busyId={busyId}
              onOptions={setOptions}
            />
          ) : null}

          {tab === 'broll' ? (
            <ItemList
              rows={lib?.broll}
              kind="broll"
              emptyTitle="No B-roll"
              emptyBody="B-roll is your own short clips. The director cuts to them between songs when you let it."
              thumb
              describe={(c) => [c.title || 'Untitled clip', [msToClock(c.duration_ms), bytesLine(c.size_bytes)].filter(Boolean).join(' · ')]}
              busyId={busyId}
              onOptions={setOptions}
            />
          ) : null}

          {tab === 'sets' ? (
            <ItemList
              rows={lib?.sets}
              kind="sets"
              emptyTitle="No set lists"
              emptyBody="A set list is a named running order of your tracks. They are built on the website."
              icon={<Icon.Doc size={22} color={color.ink} />}
              describe={(s) => [s.name || 'Untitled set', `${(s.set_list_items || []).length} ${(s.set_list_items || []).length === 1 ? 'track' : 'tracks'}`]}
              busyId={busyId}
              onOptions={setOptions}
            />
          ) : null}
        </View>
      </ScrollView>

      {options ? (
        <Sheet onDismiss={() => setOptions(null)} label={`Options for ${options.title}`}>
          <Text style={text.sectionHeading}>{options.title}</Text>
          <Text style={text.supporting}>
            {options.kind === 'tracks'
              ? 'Deleting a track removes the file. Your cue sheets for it are kept.'
              : options.kind === 'sets'
                ? 'Deleting a set list removes the running order. The tracks in it are kept.'
                : 'This cannot be undone.'}
          </Text>
          {/* Cue it for the show. Tracks only: a cue sheet or a set list
              is not something the mixer can play. */}
          {options.kind === 'tracks' ? (
            <>
              <Text style={text.rowTitle}>Use it in your show</Text>
              <Text style={text.supporting}>
                Your headphones have to be in. Through the speaker your microphone
                hears the track too, so it would go out twice.
              </Text>
              {cueing ? (
                <Text style={text.supporting} testID="cue-progress">
                  Getting the track… {Math.round(cueProgress * 100)}%
                </Text>
              ) : (
                <View style={{ flexDirection: 'row', gap: space.sm }}>
                  <Button kind="main" style={{ flex: 1 }} onPress={() => cueTrack(options, 'wired')} testID="cue-wired">
                    Wired in
                  </Button>
                  <Button kind="quiet" style={{ flex: 1 }} onPress={() => cueTrack(options, 'bluetooth')} testID="cue-bluetooth">
                    Bluetooth
                  </Button>
                </View>
              )}
              {cueError ? <Text style={text.supporting} testID="cue-error">{cueError}</Text> : null}
              {backing.transport.trackId === options.id ? (
                <Text style={text.supporting} testID="cue-ready">
                  Ready in your show. The console's Track button plays it.
                </Text>
              ) : null}
            </>
          ) : null}
          <Button kind="destructive" onPress={() => remove(options)}>Delete</Button>
          <Button kind="quiet" onPress={() => setOptions(null)}>Keep it</Button>
        </Sheet>
      ) : null}
    </Screen>
  );
}

/**
 * One tab's rows. `rows` of null means that list could not be read,
 * which is a different sentence from an empty library and gets one.
 */
function ItemList({ rows, kind, emptyTitle, emptyBody, icon, thumb = false, describe, busyId, onOptions }) {
  if (rows === null || rows === undefined) {
    return (
      <NotStored>
        We could not read this part of your library. The rest of the screen is
        still what it says.
      </NotStored>
    );
  }
  if (!rows.length) {
    return (
      <Empty
        icon={<Icon.Note size={24} color={color.ink} />}
        title={emptyTitle}
        body={emptyBody}
        testID={`studio-${kind}-empty`}
      />
    );
  }
  return (
    <View style={{ gap: space.sm }}>
      {rows.map((row) => {
        const [title, detail] = describe(row);
        return (
          <Row
            key={row.id}
            icon={thumb ? <MediaTile style={{ width: 64, height: 48, borderRadius: 8 }} /> : icon}
            title={title}
            subtitle={detail}
            right={(
              <Button
                kind="quiet"
                size="small"
                busy={busyId === row.id}
                onPress={() => onOptions({ id: row.id, kind, title })}
                accessibilityLabel={`Options for ${title}`}
              >
                Options
              </Button>
            )}
          />
        );
      })}
    </View>
  );
}

const msToClock = (ms) => {
  const total = Math.round((Number(ms) || 0) / 1000);
  if (!total) return '';
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};
const bytesLine = (bytes) => (Number(bytes) ? `${megabytes(bytes)} MB` : '');

function StudioSkeleton() {
  return (
    <Screen>
      <View style={{ paddingTop: 52, paddingHorizontal: space.screenEdge, gap: space.l }}>
        <Skeleton width={44} height={44} radius={22} />
        <Skeleton width={220} height={34} />
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          {[132, 108, 80].map((w, i) => <Skeleton key={i} width={w} height={36} radius={18} />)}
        </View>
        <Skeleton width="100%" height={96} radius={radius.card} />
        <Skeleton width="100%" height={64} radius={radius.card} />
        <Skeleton width="100%" height={64} radius={radius.card} />
        <Skeleton width="100%" height={64} radius={radius.card} />
      </View>
    </Screen>
  );
}
