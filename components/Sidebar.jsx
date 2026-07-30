'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { Compass, Broadcast, UserCircle, Bell, Coins, CaretRight } from '@phosphor-icons/react';

// Matches Sidebar.dc.html from the Claude Design project exactly (icons,
// labels, active/wallet color rules). Profile/Notifications don't have
// pages in this codebase yet, so they still render inert -- present for
// visual fidelity, not wired to a route until their batch lands.
const ITEMS = [
  { key: 'discover', label: 'DISCOVER', href: '/discover', Icon: Compass },
  { key: 'live', label: 'LIVE', href: '/', Icon: Broadcast },
  { key: 'profile', label: 'PROFILE', href: null, Icon: UserCircle },
  { key: 'notifications', label: 'NOTIFICATIONS', href: null, Icon: Bell },
  { key: 'wallet', label: 'WALLET', href: '/wallet', Icon: Coins },
];

const TEAL = '#2ec4b6';
const MUTED = 'rgba(253, 255, 252, 0.55)';
const ORANGE = '#ff9f1c';
const HIDE_DELAY_MS = 2000;

// autoHide is only ever true for the fan-viewer mobile experience (see
// LiveDemo.jsx) -- it drives a 2s idle timer that slides the nav off-screen
// (CSS-only effect, scoped to the mobile breakpoint via .sidebar--fan) and
// a small edge tab to bring it back. The timer itself runs regardless of
// viewport, but since the visual effect is media-query-gated, that's inert
// on desktop.
export default function Sidebar({ active = 'live', autoHide = false }) {
  const [hidden, setHidden] = useState(false);
  const timerRef = useRef(null);

  const resetTimer = useCallback(() => {
    if (!autoHide) return;
    setHidden(false);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setHidden(true), HIDE_DELAY_MS);
  }, [autoHide]);

  useEffect(() => {
    if (!autoHide) return undefined;
    resetTimer();
    return () => clearTimeout(timerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoHide]);

  const navClassName = `sidebar ${autoHide ? 'sidebar--fan' : ''} ${autoHide && hidden ? 'sidebar--hidden' : ''}`;

  return (
    <>
      <nav className={navClassName} onPointerDown={resetTimer} onScroll={resetTimer}>
        <div className="sidebar-header">
          <div className="sidebar-title">Neon Meridian</div>
          <span className="sidebar-subtitle">LIVE MUSIC PLATFORM</span>
        </div>
        <div className="sidebar-nav">
          {ITEMS.map((item) => {
            const isActive = item.key === active;
            const textColor = isActive ? TEAL : MUTED;
            const iconColor = item.key === 'wallet' ? ORANGE : textColor;
            const className = `sidebar-item ${isActive ? 'active' : ''}`;
            const inner = (
              <>
                <item.Icon size={17} weight="regular" color={iconColor} className="sidebar-icon" />
                <span className="sidebar-label">{item.label}</span>
              </>
            );
            if (item.href) {
              return (
                <Link key={item.key} href={item.href} className={className} style={{ color: textColor }}>
                  {inner}
                </Link>
              );
            }
            return (
              <span key={item.key} className={`${className} inert`} style={{ color: textColor }}>
                {inner}
              </span>
            );
          })}
        </div>
      </nav>

      {autoHide && hidden && (
        <button type="button" className="sidebar-reveal-tab" onClick={resetTimer} aria-label="show navigation">
          <CaretRight size={16} weight="bold" />
        </button>
      )}
    </>
  );
}
