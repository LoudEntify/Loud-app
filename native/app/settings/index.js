// Settings.dc.html — "Saved once, applied when every show starts."
//
// The hub, and the screen that replaced a WebView: until this round
// Settings on the phone was the website in `app/web.js`. Everything it
// links to is now a native screen, which is why each row below either
// goes somewhere real or does not move at all.
//
// The three values on the right of a row are read, not guessed:
// cameras from the pairing route, Direction from the artist's saved
// settings, Region from `profiles.country`. The two the board writes as
// placeholders and nothing can fill — the mic name and the hours left —
// are left blank rather than filled with a number we do not have.
//
// "Your stage" is drawn for artists only. A viewer has no cameras, no
// director and no allowance, and the routes behind those rows answer a
// viewer with a 403.
import { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { router } from 'expo-router';
import {
  Screen, Row, Section, ScreenHeader, ErrorPanel, Skeleton, Icon,
  color, space, text, useLoadingPhase,
} from '../../src/ui';
import { api } from '../../src/api';
import { useSession } from '../../src/session';
import { countryName } from '@loud/lib/countries.js';

export default function Settings() {
  const { accessToken, profile, loading } = useSession();
  const artist = profile?.role === 'artist';
  const [stage, setStage] = useState(null);
  const [failed, setFailed] = useState(false);
  // Only the artist rows load anything, so a viewer is never kept waiting.
  const phase = useLoadingPhase(artist && stage === null && !failed);

  const load = useCallback(async () => {
    if (!artist || !accessToken) return;
    setFailed(false);
    // Both are read for the two row values. A failure of either is one
    // failure of this screen: the rows still work, they just cannot say
    // what is set, and that is what the error panel offers to retry.
    const [direction, cameras] = await Promise.all([
      api('/api/artist/direction', { accessToken }),
      api('/api/camfeed/pair', { method: 'POST', accessToken, body: { action: 'list' } }),
    ]);
    if (!direction.ok && !cameras.ok) { setFailed(true); return; }
    setStage({
      autoDirector: direction.ok ? direction.data?.settings?.autoDirector : null,
      paired: cameras.ok && !cameras.data?.degraded
        ? (cameras.data?.pairings || []).filter((p) => p.live).length
        : null,
    });
  }, [artist, accessToken]);

  useEffect(() => { if (!loading) load(); }, [loading, load]);

  const country = profile?.country ? countryName(profile.country) : null;

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingTop: 52, paddingBottom: 120, gap: space.xxl }}>
        <ScreenHeader title="Settings" onBack={() => router.push('/profile')} />

        <View style={{ paddingHorizontal: space.screenEdge, gap: space.xxl }}>
          {failed ? (
            <ErrorPanel
              title="We could not read your stage settings"
              body="The rows below still work. Try again to see what is set."
              onRetry={load}
            />
          ) : null}

          {artist ? (
            <Section title="Your stage">
              <Text style={[text.supporting, { marginTop: -space.xs }]}>Saved once, applied when every show starts</Text>

              {/* No mic name: the capturer reports cameras, never audio
                  inputs, so there is nothing here to name. */}
              <Row
                icon={<Icon.Mic size={22} color={color.ink} />}
                title="Audio"
                onPress={() => router.push('/settings/audio')}
              />
              <Row
                icon={<Icon.Camera size={22} color={color.ink} />}
                title="Camera"
                subtitle={phase === 'loading' ? undefined : cameraLine(stage?.paired)}
                right={phase === 'loading' ? <Skeleton width={72} height={16} /> : undefined}
                onPress={() => router.push('/settings/camera')}
              />
              <Row
                icon={<Icon.Sparkle size={22} color={color.ink} />}
                title="Direction"
                subtitle={stage?.autoDirector == null ? undefined : (stage.autoDirector ? 'Auto' : 'Manual cuts only')}
                right={phase === 'loading' ? <Skeleton width={48} height={16} /> : undefined}
                onPress={() => router.push('/settings/direction')}
              />
              <Row
                icon={<Icon.Note size={22} color={color.ink} />}
                title="Studio library"
                subtitle="Tracks, cues, B-roll"
                onPress={() => router.push('/settings/studio')}
              />
              <Row
                icon={<Icon.Film size={22} color={color.ink} />}
                title="Devices"
                subtitle="Cameras, operator"
                onPress={() => router.push('/settings/devices')}
              />
              {/* Not on any settings board, and required anyway: the
                  privacy policy promises an artist can disconnect YouTube
                  in Settings at any time, and until this row existed the
                  only place to do it was the website. */}
              <Row
                icon={<Icon.Share size={22} color={color.ink} />}
                title="YouTube"
                subtitle="The channel your shows go out on"
                onPress={() => router.push('/settings/youtube')}
              />
            </Section>
          ) : null}

          <Section title="Account, money and safety">
            <Row
              icon={<Icon.Person size={22} color={color.ink} />}
              title="Account"
              onPress={() => router.push('/settings/account')}
            />
            {/* "[n] hours left" has no source: there is no allowance route
                and no ledger of viewer-hours. The screen behind this row
                says so rather than this row inventing a number. */}
            {artist ? (
              <Row
                icon={<Icon.Coin size={22} color={color.ink} />}
                title="Allowance and packs"
                onPress={() => router.push('/settings/allowance')}
              />
            ) : null}
            <Row
              icon={<Icon.Coin size={22} color={color.ink} />}
              title="Wallet and payouts"
              onPress={() => router.push('/wallet')}
            />
            <Row
              icon={<Icon.Bell size={22} color={color.ink} />}
              title="Notifications"
              onPress={() => router.push('/settings/notifications')}
            />
            <Row
              icon={<Icon.Flag size={22} color={color.ink} />}
              title="Privacy and safety"
              onPress={() => router.push('/settings/privacy')}
            />
            <Row
              icon={<Icon.Pin size={22} color={color.ink} />}
              title="Region"
              subtitle={country || undefined}
              onPress={() => router.push('/settings/region')}
            />
          </Section>

          {/* Every row the board puts here points at `#`: the four pages
              live on the website and none of them has a screen on the
              phone. They are drawn as the board writes them and plainly
              do not move, rather than as taps that arrive nowhere. */}
          <Section title="Help and legal">
            <Row icon={<Icon.Chat size={22} color={color.ink} />} title="Help centre" />
            <Row icon={<Icon.Doc size={22} color={color.ink} />} title="Terms and Conditions" />
            <Row icon={<Icon.Doc size={22} color={color.ink} />} title="Community Guidelines" />
            <Row icon={<Icon.Doc size={22} color={color.ink} />} title="Privacy policy" />
            <Text style={text.supporting}>
              These four are on loudentify.app. They are not in the app yet.
            </Text>
          </Section>
        </View>
      </ScrollView>
    </Screen>
  );
}

/**
 * The board writes "[n] paired". `null` is not zero: it means the
 * pairing table is not on this deployment, or the read failed, and
 * "0 paired" would be a claim we cannot make.
 */
function cameraLine(paired) {
  if (paired == null) return undefined;
  return paired === 1 ? '1 paired' : `${paired} paired`;
}
