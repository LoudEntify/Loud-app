'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Bell, GearSix, Wallet, ChatCircleText, UserPlus } from '@phosphor-icons/react';
import AvatarRing from './AvatarRing';
import EmptyState from './EmptyState';
import AuthButton from './AuthButton';
import ScheduleShow from './ScheduleShow';
import InvitedShows from './InvitedShows';
import BRollLibrary from './BRollLibrary';
import CueSheetLibrary from './CueSheetLibrary';
import RecordingsLibrary from './RecordingsLibrary';
import { getSupabase } from '../lib/supabaseClient';
import { getSession } from '../lib/supabaseAuth';
import { fetchFollowedArtistIds, followArtist, unfollowArtist } from '../lib/follows';

const INK = '#011627';
const PORCELAIN = '#fdfffc';
const TEAL = '#2ec4b6';

// ONE artist profile, TWO modes off the same identity.
//
//   OWNER MODE  — the console. Everything the dashboard used to hold,
//                 sitting under the artist's own public header. There is
//                 no separate "dashboard" destination any more.
//   PUBLIC MODE — the storefront. Photo, name, bio, genres, public
//                 recordings, upcoming shows, follow/message.
//
// ENFORCEMENT IS IN THE DATABASE, NOT IN THIS FILE. `isOwner` decides
// what to RENDER; it is not what keeps private data private. Every
// console data source is owner-scoped by RLS:
//   broll_clips         — select own only
//   wallet_transactions — select own only
//   notifications       — select own only
//   recordings          — own rows, or rows marked public
//   cue_sheets          — service-role API behind verifyArtistAuth
// So a visitor's client literally cannot fetch this artist's private
// rows. Nothing arrives and then gets hidden by CSS.
//
// `shows` is the one exception and deliberately so: its RLS is open, and
// upcoming shows are public information in both modes anyway.
const iconBtn = {
  width: 38, height: 38, display: 'flex', alignItems: 'center', justifyContent: 'center',
  borderRadius: 999, background: 'rgba(1,22,39,0.06)', textDecoration: 'none',
};

const ghostBtn = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '9px 14px', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em',
  color: INK, background: 'transparent', border: '1px solid rgba(1,22,39,0.2)',
  borderRadius: 999, textDecoration: 'none', cursor: 'pointer',
};

export default function ProfileSurface({ artistId }) {
  const [viewer, setViewer] = useState(undefined); // undefined = unknown
  // Held for the owner-only invited-shows section, which reads a
  // service-role route rather than a table the client can see.
  const [viewerToken, setViewerToken] = useState(null);
  const [profile, setProfile] = useState(undefined);
  const [upcoming, setUpcoming] = useState([]);
  const [isFollowing, setIsFollowing] = useState(false);
  const [followsSupported, setFollowsSupported] = useState(true);
  const [followBusy, setFollowBusy] = useState(false);

  // Optimistic, and reverted on failure. Following is low-stakes and
  // instantly reversible; a button that waits for a round trip before
  // acknowledging a tap reads as broken.
  const toggleFollow = useCallback(async () => {
    if (!viewer?.id) { window.location.href = '/auth'; return; }
    const wasFollowing = isFollowing;
    setIsFollowing(!wasFollowing);
    setFollowBusy(true);
    const res = wasFollowing
      ? await unfollowArtist(viewer.id, artistId)
      : await followArtist(viewer.id, artistId);
    if (!res.ok) {
      setIsFollowing(wasFollowing);
      if (res.supported === false) setFollowsSupported(false);
    }
    setFollowBusy(false);
  }, [viewer, artistId, isFollowing]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const session = await getSession();
      if (cancelled) return;
      setViewer(session?.user ?? null);
      setViewerToken(session?.access_token ?? null);

      if (session?.user?.id && session.user.id !== artistId) {
        const followed = await fetchFollowedArtistIds(session.user.id);
        if (!cancelled) {
          setIsFollowing(followed.ids.has(artistId));
          setFollowsSupported(followed.supported);
        }
      }

      const supabase = getSupabase();
      // select('*') rather than a column list, deliberately: this needs
      // `deactivated_at`, which arrives with a hand-run migration, and
      // NAMING a column that does not exist yet 400s the whole query
      // instead of returning null for it. The same reasoning is why
      // lib/discoveryFeed.js's fetchLiveShows uses select('*').
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', artistId)
        .maybeSingle();
      if (cancelled) return;
      setProfile(data || null);

      const { data: shows } = await supabase
        .from('shows')
        .select('*')
        .eq('artist_id', artistId)
        .neq('state', 'ended')
        .order('slated_at', { ascending: true })
        .limit(10);
      if (!cancelled) setUpcoming(shows || []);
    })();
    return () => { cancelled = true; };
  }, [artistId]);

  if (profile === undefined || viewer === undefined) {
    return <div style={{ padding: 40, fontSize: 12, color: 'rgba(1,22,39,0.4)' }}>Loading…</div>;
  }

  if (!profile) {
    return (
      <div style={{ padding: 40 }}>
        <EmptyState
          title="Profile not found"
          body="This account may have been removed, or the link may be wrong."
          action="BROWSE ARTISTS"
          actionHref="/discover"
        />
      </div>
    );
  }

  const isOwner = !!viewer && viewer.id === profile.id;

  // A closed account keeps its URL and loses its storefront.
  //
  // Not a 404, deliberately. Someone following an old link deserves to
  // know the account is gone rather than to be told the link was wrong —
  // and a 404 would invite them to assume they mistyped and try again.
  // The stage name is shown because it is retained against the record
  // (that is the point of retaining it); nothing else is.
  if (profile.deactivated_at && !isOwner) {
    return (
      <div style={{ padding: 40 }}>
        <EmptyState
          title={`${profile.retained_stage_name || profile.display_name || 'This account'} has closed their account`}
          body="Their profile, shows and recordings are no longer public."
          action="BROWSE ARTISTS"
          actionHref="/discover"
        />
      </div>
    );
  }
  const name = profile.display_name || profile.username || 'Artist';

  return (
    <div style={{ minHeight: '100vh', background: PORCELAIN, color: INK, padding: '30px 32px 60px', boxSizing: 'border-box' }}>
      <div style={{ maxWidth: 1080, margin: '0 auto' }}>

        {/* ── Shared identity header ───────────────────────────
            Same header in both modes. In owner mode it gains an edit
            entry point; it does not become a different component, so the
            artist is always looking at the page their audience sees. */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 18, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
            <AvatarRing src={profile.avatar_url} name={name} size={92} alt={`${name}’s photo`} />
            <div>
              <div style={{ fontSize: 23, fontWeight: 700, letterSpacing: '-0.01em' }}>{name}</div>
              <div style={{ fontSize: 10, letterSpacing: '0.08em', color: 'rgba(1,22,39,0.5)', marginTop: 3 }}>
                {profile.username ? `@${profile.username}` : ''}
                {profile.role === 'artist' ? ' · ARTIST' : ' · FAN'}
              </div>
              {profile.bio && (
                <div style={{ fontSize: 12.5, color: 'rgba(1,22,39,0.65)', marginTop: 8, maxWidth: 460, lineHeight: 1.5 }}>{profile.bio}</div>
              )}
              {(profile.genres || []).length > 0 && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                  {profile.genres.map((g) => (
                    <span key={g} style={{ fontSize: 9, letterSpacing: '0.06em', color: TEAL, border: `1px solid rgba(46,196,182,0.5)`, borderRadius: 999, padding: '3px 9px' }}>
                      {g.toUpperCase()}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {isOwner ? (
              <>
                <Link href="/notifications" style={iconBtn} aria-label="Notifications"><Bell size={16} color={INK} /></Link>
                <Link href="/wallet" style={iconBtn} aria-label="Wallet"><Wallet size={16} color={INK} /></Link>
                <Link href="/settings" style={iconBtn} aria-label="Settings"><GearSix size={16} color={INK} /></Link>
                <AuthButton compact />
              </>
            ) : (
              <>
                {/* FOLLOW is real now — there is a `follows` table
                    behind it (docs/overnight2_03_follows.sql). It keeps
                    the old habit of admitting when it cannot work: if
                    that migration has not been run, `followsSupported`
                    goes false and the button says so rather than
                    swallowing taps.

                    MESSAGE still has no backing table and is unchanged. */}
                <button
                  type="button"
                  onClick={toggleFollow}
                  disabled={!followsSupported || followBusy}
                  title={followsSupported ? undefined : 'Following switches on once the pending migration is applied'}
                  style={{
                    ...ghostBtn,
                    opacity: followsSupported ? 1 : 0.45,
                    cursor: followsSupported ? 'pointer' : 'not-allowed',
                    color: isFollowing ? TEAL : INK,
                    border: isFollowing ? `1px solid ${TEAL}` : '1px solid rgba(1,22,39,0.2)',
                  }}
                >
                  <UserPlus size={13} weight="bold" /> {isFollowing ? 'FOLLOWING' : 'FOLLOW'}
                </button>
                <Link href="/messages" style={ghostBtn}>
                  <ChatCircleText size={13} weight="bold" /> MESSAGE
                </Link>
              </>
            )}
          </div>
        </div>

        {/* Owner-only: shows this artist is IN but did not create.
            A pending invitation is a conversation between two artists,
            not a public fact about either — a visitor has no business
            seeing who has been asked and has not answered. */}
        {isOwner && <InvitedShows accessToken={viewerToken} />}

        {/* ── Upcoming shows: both modes ───────────────────────
            A visitor should be able to see when this artist is next on;
            that is the single most useful thing a storefront can say. */}
        {upcoming.length > 0 && (
          <div style={{ marginTop: 28 }}>
            <span style={{ fontSize: 10.5, letterSpacing: '0.12em', color: 'rgba(1,22,39,0.55)' }}>UPCOMING</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
              {upcoming.map((s) => (
                <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', border: '1px solid rgba(1,22,39,0.1)', clipPath: 'polygon(8px 0,100% 0,100% 100%,0 100%,0 8px)' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600 }}>{s.title || 'Untitled show'}</div>
                    <div style={{ fontSize: 10, color: 'rgba(1,22,39,0.5)', marginTop: 2 }}>
                      {new Date(s.slated_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                      {' · '}{(s.performance_mode || 'solo').toUpperCase()}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── OWNER CONSOLE ────────────────────────────────── */}
        {isOwner && (
          <>
            <div style={{ marginTop: 30 }}>
              <span style={{ fontSize: 10.5, letterSpacing: '0.12em', color: 'rgba(1,22,39,0.55)' }}>SHOWS</span>
              <div style={{ marginTop: 12 }}><ScheduleShow /></div>
            </div>

            <div style={{ marginTop: 30 }}><BRollLibrary /></div>
            <div style={{ marginTop: 30 }}><CueSheetLibrary /></div>

            <div style={{ marginTop: 30 }}>
              <RecordingsLibrary artistId={artistId} owner />
            </div>
          </>
        )}

        {/* ── PUBLIC STOREFRONT ────────────────────────────── */}
        {!isOwner && (
          <div style={{ marginTop: 30 }}>
            <RecordingsLibrary artistId={artistId} owner={false} />
          </div>
        )}
      </div>
    </div>
  );
}

