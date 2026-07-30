'use client';

import Link from 'next/link';
import { Bell, GearSix } from '@phosphor-icons/react';
import AvatarRing from './AvatarRing';

const INK = '#011627';
const PORCELAIN = '#fdfffc';
const ORANGE = '#ff9f1c';
const RED = '#e71d36';

// Mock data only -- single hardcoded fan identity (Jordan Reyes), same
// mock user Account Settings edits and Auth signs in as.
const FAVORITES = [
  { id: 'fav-1', name: 'Neon Meridian' },
  { id: 'fav-2', name: 'Kilo Wave' },
  { id: 'fav-3', name: 'Rhea Cross' },
  { id: 'fav-4', name: 'Tempo Nine' },
  { id: 'fav-5', name: 'Solstice Blue' },
];

export default function FanProfile() {
  return (
    <div style={{ minHeight: '100vh', width: '100%', boxSizing: 'border-box', background: PORCELAIN, color: INK, padding: '32px 40px 60px' }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
            <AvatarRing name="Jordan Reyes" size={82} gradient="linear-gradient(135deg,#2ec4b6,#17847a)" />
            <div>
              <div style={{ fontSize: 21, fontWeight: 700, color: INK }}>Jordan Reyes</div>
              <span style={{ fontSize: 9.5, letterSpacing: '0.08em', color: 'rgba(1,22,39,0.5)' }}>@jordanreyes &middot; FAN</span>
              <div style={{ marginTop: 8, display: 'inline-block', fontSize: 9.5, letterSpacing: '0.06em', color: ORANGE, background: 'rgba(255,159,28,0.1)', border: '1px solid rgba(255,159,28,0.5)', clipPath: 'polygon(6px 0,100% 0,100% 100%,0 100%,0 6px)', padding: '4px 9px' }}>PREFERS AFROBEATS</div>
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
          </div>
        </div>

        <div style={{ display: 'flex', gap: 24, marginTop: 32, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 260px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: 1, border: '1px solid rgba(1,22,39,0.12)', clipPath: 'polygon(8px 0,100% 0,100% 100%,0 100%,0 8px)', padding: '14px 16px' }}>
                <div style={{ fontSize: 9.5, letterSpacing: '0.08em', color: 'rgba(1,22,39,0.5)' }}>SHOWS WATCHED</div>
                <div style={{ fontSize: 22, fontWeight: 600, color: INK, marginTop: 4 }}>142</div>
              </div>
              <div style={{ flex: 1, border: '1px solid rgba(1,22,39,0.12)', clipPath: 'polygon(0 0,100% 0,100% 100%,calc(100% - 8px) 100%,0 100%)', padding: '14px 16px' }}>
                <div style={{ fontSize: 9.5, letterSpacing: '0.08em', color: 'rgba(1,22,39,0.5)' }}>REACTIONS SENT</div>
                <div style={{ fontSize: 22, fontWeight: 600, color: INK, marginTop: 4 }}>3,904</div>
              </div>
            </div>
            <Link href="/messages" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '14px 0', background: 'rgba(1,22,39,0.06)', borderRadius: 999 }}>
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: INK }}>MESSAGES</span>
            </Link>
          </div>

          <div style={{ flex: '1.4 1 320px' }}>
            <span style={{ fontSize: 10.5, letterSpacing: '0.12em', color: 'rgba(1,22,39,0.55)' }}>TOP 5 FAVORITE ARTISTS</span>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginTop: 14 }}>
              {FAVORITES.map((fav) => (
                <Link key={fav.id} href="/artist" style={{ textDecoration: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                  <AvatarRing name={fav.name} size={92} />
                  <span style={{ fontSize: 8.5, color: 'rgba(1,22,39,0.6)', textAlign: 'center' }}>{fav.name}</span>
                </Link>
              ))}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
