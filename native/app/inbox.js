// Inbox.dc.html — reminders, invites, replies and follows, newest first.
//
// There is no route for notifications and there deliberately is not one:
// the `notifications` table is read by its owner under row-level security,
// which is exactly what the web does (components/Notifications.jsx). So
// this reads the table from the phone too, the same way artist/schedule.js
// reads `places`. Inventing an endpoint would add a second definition of
// "your notifications" that could drift from the policy that already
// decides it.
//
// Every row carries an `href` written for the website. Most of those pages
// have no screen on the phone yet, so a row is only tappable when its href
// maps to a real native route; the rest are read-only rows rather than taps
// that land nowhere.
import { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { router } from 'expo-router';
import {
  Screen, MediaTile, Button, Empty, ErrorPanel, Skeleton, Row, IconButton, Icon,
  color, space, surface, text, face, useLoadingPhase,
} from '../src/ui';
import { supabase, useSession, AUTH_CONFIGURED } from '../src/session';

/**
 * The board tints each row's 44px circle by what the notification is. The kit
 * has one quiet surface and no tinted-circle surface, so the three tints the
 * board uses are named here, in the board's own values, rather than sprinkled
 * through the JSX.
 */
const TINT = {
  versus: color.orange,
  reminder: 'rgba(255,159,28,0.3)',
  comment: 'rgba(46,196,182,0.3)',
  quiet: surface.quiet,
};

const KIND = {
  versus_invite: { tint: TINT.versus, action: 'View' },
  show_live: { tint: null, action: 'Join' },
  show_reminder: { tint: TINT.reminder, action: null },
  comment: { tint: TINT.comment, action: null },
  follow: { tint: TINT.quiet, action: null },
  system: { tint: TINT.quiet, action: null },
};

function KindIcon({ kind }) {
  // The live row is the dark cover tile on the board, not a tint.
  if (kind === 'show_live') {
    return (
      <MediaTile style={{ width: 44, height: 44, borderRadius: 22 }}>
        <Icon.Mic size={20} color={color.porcelain} />
      </MediaTile>
    );
  }
  const tint = (KIND[kind] || KIND.system).tint;
  // A Versus invite is lettered rather than drawn, the way the board has it.
  const glyph = kind === 'versus_invite'
    ? <Text style={{ fontFamily: face.bold, fontSize: 13, fontWeight: '700', letterSpacing: 1, color: color.ink }}>VS</Text>
    : ({
        show_reminder: <Icon.Bell size={20} color={color.ink} />,
        comment: <Icon.Chat size={20} color={color.ink} />,
        follow: <Icon.Person size={20} color={color.ink} />,
      }[kind] || <Icon.Bell size={20} color={color.ink} />);
  return (
    <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: tint, alignItems: 'center', justifyContent: 'center' }}>
      {glyph}
    </View>
  );
}

/**
 * `href` is a path on the website. Only these two have a screen here, so
 * only these two are offered; anything else renders without navigation.
 * Verified against native/app by tests/native-screens.test.mjs.
 */
function nativeRouteFor(href) {
  const show = /^\/show\/([^/?#]+)/.exec(href || '');
  if (show) return `/show/${show[1]}`;
  const desk = /^\/artist\/console\/([^/?#]+)/.exec(href || '');
  if (desk) return `/artist/console/${desk[1]}`;
  return null;
}

/** Same wording as the web panel, so one notification does not read two ways. */
function relativeTime(iso) {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 60) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

const isToday = (iso) => new Date(iso).toDateString() === new Date().toDateString();

export default function Inbox() {
  const { session, loading } = useSession();
  const userId = session?.user?.id || null;
  const [items, setItems] = useState(null);
  const [failed, setFailed] = useState(false);
  const phase = useLoadingPhase(items === null && !failed);

  // An inbox belongs to an account; there is nothing to show a guest.
  useEffect(() => { if (!loading && !session) router.replace('/login'); }, [loading, session]);

  const load = useCallback(async () => {
    if (!userId || !AUTH_CONFIGURED) return;
    setFailed(false);
    const { data, error } = await supabase()
      .from('notifications')
      .select('id, kind, body, href, read_at, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) { setFailed(true); return; }
    setItems(data || []);

    // Marked read after the rows are in hand, so the dots stay for this
    // viewing — opening the inbox should not erase what tells you which
    // items are new while you are still looking at them. The write is what
    // clears the count for next time, on the web as well as here.
    supabase().from('notifications').update({ read_at: new Date().toISOString() })
      .eq('user_id', userId).is('read_at', null)
      .then(() => { /* nothing depends on it having landed */ }, () => { /* likewise */ });
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  const today = (items || []).filter((n) => isToday(n.created_at));
  const earlier = (items || []).filter((n) => !isToday(n.created_at));

  return (
    <Screen>
      <View style={{ flex: 1, paddingTop: 52 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.m, paddingHorizontal: space.screenEdge }}>
          <IconButton label="Back" onPress={() => router.back()}>
            <Icon.Back size={22} color={color.ink} />
          </IconButton>
          <Text style={[text.screenTitle, { flex: 1, fontSize: 30 }]}>Inbox</Text>
        </View>

        {/* Two tabs on the board. Messages leads to Thread.dc.html, which has
            no screen on the phone yet, so it is shown as the board writes it
            and plainly cannot be chosen rather than opening nothing. */}
        <View
          accessibilityRole="tablist"
          accessibilityLabel="Inbox"
          style={{ flexDirection: 'row', gap: space.xs, margin: space.screenEdge, padding: space.xs, borderRadius: 999, backgroundColor: surface.quiet }}
        >
          <View
            accessibilityRole="tab"
            accessibilityState={{ selected: true }}
            style={{ flex: 1, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: color.porcelain, borderWidth: 2, borderColor: color.ink }}
          >
            <Text style={{ fontFamily: face.bold, fontSize: 17, fontWeight: '700', color: color.ink }}>Notifications</Text>
          </View>
          <View
            accessibilityRole="tab"
            accessibilityState={{ selected: false, disabled: true }}
            style={{ flex: 1, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', opacity: 0.5 }}
          >
            <Text style={{ fontFamily: face.regular, fontSize: 17, color: color.ink }}>Messages</Text>
          </View>
        </View>

        {phase === 'loading' ? (
          <InboxSkeleton />
        ) : (
          <ScrollView contentContainerStyle={{ paddingHorizontal: space.screenEdge, paddingBottom: 120, gap: space.l }}>
            {/* Ten seconds with nothing back is the error state, not a longer wait. */}
            {failed || phase === 'slow' ? (
              <ErrorPanel
                title="We could not load your inbox"
                body="It may be the connection. Try again."
                onRetry={load}
                backLabel="Back to Discover"
                onBack={() => router.push('/discover')}
              />
            ) : null}

            {items && !items.length && !failed ? (
              <Empty
                icon={<Icon.Bell size={24} color={color.ink} />}
                title="Nothing yet"
                body="Show reminders and platform updates land here. Schedule a show, or follow an artist, and this fills up on its own."
                actionLabel="Find artists"
                onAction={() => router.push('/discover')}
                testID="inbox-empty"
              />
            ) : null}

            {today.length ? <Group title="Today" items={today} /> : null}
            {earlier.length ? <Group title="Earlier" items={earlier} /> : null}
          </ScrollView>
        )}
      </View>
    </Screen>
  );
}

function Group({ title, items }) {
  return (
    <View style={{ gap: space.sm }}>
      <Text style={text.label}>{title}</Text>
      {items.map((n) => <Note key={n.id} note={n} />)}
    </View>
  );
}

function Note({ note }) {
  const to = nativeRouteFor(note.href);
  const action = (KIND[note.kind] || KIND.system).action;
  return (
    <Row
      icon={<KindIcon kind={note.kind} />}
      title={note.body}
      subtitle={relativeTime(note.created_at)}
      onPress={to ? () => router.push(to) : undefined}
      right={to && action
        ? <Button kind="main" size="chip" onPress={() => router.push(to)} accessibilityLabel={`${action}: ${note.body}`}>{action}</Button>
        : (note.read_at ? null : <View accessibilityLabel="Unread" style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color.red }} />)}
    />
  );
}

function InboxSkeleton() {
  return (
    <View style={{ paddingHorizontal: space.screenEdge, gap: space.sm }}>
      <Skeleton width={70} height={16} />
      {[0, 1, 2, 3].map((i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: space.m, minHeight: 64 }}>
          <Skeleton width={44} height={44} radius={22} />
          <View style={{ flex: 1, gap: space.sm }}>
            <Skeleton width="80%" height={17} />
            <Skeleton width="30%" height={14} />
          </View>
        </View>
      ))}
    </View>
  );
}
