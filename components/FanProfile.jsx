'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import EmptyState from './EmptyState';
import AuthButton from './AuthButton';
import { getSession, getProfile } from '../lib/supabaseAuth';
import { Bell, GearSix } from '@phosphor-icons/react';
import AvatarRing from './AvatarRing';

const INK = '#011627';
const PORCELAIN = '#fdfffc';
const ORANGE = '#ff9f1c';
const RED = '#e71d36';

// Real identity only. The hardcoded fan (Jordan Reyes) and their five
// invented favourite artists are gone.
//
// Stats are ABSENT rather than zeroed: shows-watched and reactions-sent
// are not counted anywhere yet, and printing "0" claims a measurement
// that isn't happening. Favourites have no backing table yet either, so
// that panel states plainly what it will hold.

export default function FanProfile() {
  const [profile, setProfile] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const session = await getSession();
      if (cancelled || !session?.user) return;
      const { profile: p } = await getProfile(session.user.id);
      if (!cancelled) setProfile(p);
    })();
    return () => { cancelled = true; };
  }, []);

  const name = profile?.display_name || profile?.full_name || 'Your profile';
  const handle = profile?.username ? `@${profile.username}` : 'no handle yet';
  const genreLabel = (profile?.genres || [])[0];

  return (
    <div style={{ minHeight: '100vh', width: '100%', boxSizing: 'border-box', background: PORCELAIN, color: INK, padding: '32px 40px 60px' }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
            <AvatarRing src={profile?.avatar_url} name={name} size={82} gradient="linear-gradient(135deg,#2ec4b6,#17847a)" alt="Your photo" />
            <div>
              <div style={{ fontSize: 21, fontWeight: 700, color: INK }}>{name}</div>
              <span style={{ fontSize: 9.5, letterSpacing: '0.08em', color: 'rgba(1,22,39,0.5)' }}>{handle} &middot; FAN</span>
              {genreLabel && (
                <div style={{ marginTop: 8, display: 'inline-block', fontSize: 9.5, letterSpacing: '0.06em', color: ORANGE, background: 'rgba(255,159,28,0.1)', border: '1px solid rgba(255,159,28,0.5)', clipPath: 'polygon(6px 0,100% 0,100% 100%,0 100%,0 6px)', padding: '4px 9px' }}>PREFERS {genreLabel.toUpperCase()}</div>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <Link href="/wallet" style={{ width: 38, height: 38, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 999, background: 'rgba(255,159,28,0.12)', textDecoration: 'none' }}>
              <div style={{ width: 13, height: 13, background: ORANGE, clipPath: 'polygon(50% 0,100% 25%,100% 75%,50% 100%,0 75%,0 25%)' }} />
            </Link>
            <Link href="/notifications" style={{ width: 38, height: 38, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 999, background: 'rgba(1,22,39,0.06)', textDecoration: 'none' }}>
              <Bell size={16} color={INK} />
              <div style={{ position: 'absolute', top: 6, right: 6, width: 6, height: 6, borderRadius: '50%', background: RED, boxShadow: `0 0 6px ${RED}` }} />
            </Link>
            <Link href="/settings" style={{ width: 38, height: 38, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 999, background: 'rgba(1,22,39,0.06)', textDecoration: 'none' }}>
              <GearSix size={16} color={INK} />
            </Link>
            <AuthButton compact />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 24, marginTop: 32, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 260px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Link href="/messages" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '14px 0', background: 'rgba(1,22,39,0.06)', borderRadius: 999 }}>
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: INK }}>MESSAGES</span>
            </Link>
          </div>

          <div style={{ flex: '1.4 1 320px' }}>
            <span style={{ fontSize: 10.5, letterSpacing: '0.12em', color: 'rgba(1,22,39,0.55)' }}>FAVOURITE ARTISTS</span>
            <div style={{ marginTop: 14 }}>
              <EmptyState
                compact
                title="No favourites yet"
                body="Artists you follow will appear here."
                action="FIND ARTISTS"
                actionHref="/discover"
              />
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
