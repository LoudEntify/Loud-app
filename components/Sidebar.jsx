'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { Compass, Broadcast, UserCircle, Bell, Coins, CaretRight, CaretLeft } from '@phosphor-icons/react';
import { getAccountType, onAccountTypeChange } from '../lib/mockAccount';

// Matches Sidebar.dc.html from the Claude Design project exactly (icons,
// labels, active/wallet color rules). PROFILE's destination is the one
// item that isn't static -- it routes off the mock accountType (see
// lib/mockAccount.js): artists always land on the Artist Dashboard,
// fans always land on Fan Profile, regardless of what page they were
// just on.
const BASE_ITEMS = [
  { key: 'discover', label: 'DISCOVER', href: '/discover', Icon: Compass },
  { key: 'live', label: 'LIVE', href: '/', Icon: Broadcast },
  { key: 'notifications', label: 'NOTIFICATIONS', href: '/notifications', Icon: Bell },
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
// collapsed/onToggleCollapse are a SEPARATE mechanism from autoHide/hidden
// above -- a manual, performer-only toggle (left-menu collapse, see
// BroadcastStage/LiveDemo) rather than an idle timer. Deliberately kept
// independent: autoHide's slide-away CSS (sidebar--hidden) only works
// because .sidebar--fan is position:fixed and mobile-only, taken fully
// out of flex flow -- the performer's sidebar stays position:sticky,
// genuinely occupying its flex column, so collapsing it needs to
// actually shrink its width (sidebar--collapsed, below) for the page
// content to reclaim the space, not just translate it off-screen.
export default function Sidebar({ active = 'live', autoHide = false, collapsed = false, onToggleCollapse }) {
  const [hidden, setHidden] = useState(false);
  const timerRef = useRef(null);

  // Defaults to 'fan' for the first (server-matching) render, then
  // corrects on mount -- localStorage isn't available during SSR, and
  // reading it before hydration would cause a mismatch.
  const [accountType, setAccountTypeState] = useState('fan');

  useEffect(() => {
    setAccountTypeState(getAccountType());
    return onAccountTypeChange(() => setAccountTypeState(getAccountType()));
  }, []);

  const items = [
    ...BASE_ITEMS.slice(0, 2),
    { key: 'profile', label: 'PROFILE', href: accountType === 'artist' ? '/dashboard' : '/profile', Icon: UserCircle },
    ...BASE_ITEMS.slice(2),
  ];

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

  const navClassName = `sidebar ${autoHide ? 'sidebar--fan' : ''} ${autoHide && hidden ? 'sidebar--hidden' : ''} ${collapsed ? 'sidebar--collapsed' : ''}`;

  return (
    <>
      <nav className={navClassName} onPointerDown={resetTimer} onScroll={resetTimer}>
        {onToggleCollapse && (
          <button
            type="button"
            className="sidebar-collapse-btn"
            onClick={onToggleCollapse}
            aria-label="hide navigation"
          >
            <CaretLeft size={14} weight="bold" />
          </button>
        )}
        <div className="sidebar-header">
          <div className="sidebar-title">Neon Meridian</div>
          <span className="sidebar-subtitle">LIVE MUSIC PLATFORM</span>
        </div>
        <div className="sidebar-nav">
          {items.map((item) => {
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

      {/* Separate from the reveal tab above -- see this file's own
          top-of-function comment for why collapsed/autoHide are two
          independent mechanisms. Uses its own CSS
          (sidebar-reveal-tab--collapse) so it works at any breakpoint,
          without touching autoHide's existing mobile-only styling. */}
      {collapsed && (
        <button
          type="button"
          className="sidebar-reveal-tab sidebar-reveal-tab--collapse"
          onClick={onToggleCollapse}
          aria-label="show navigation"
        >
          <CaretRight size={16} weight="bold" />
        </button>
      )}
    </>
  );
}
