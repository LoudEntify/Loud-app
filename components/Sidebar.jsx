'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { Compass, Broadcast, UserCircle, Bell, Coins, CaretRight, CaretLeft } from '@phosphor-icons/react';
import { getAccountType, onAccountTypeChange } from '../lib/mockAccount';
import { getSession } from '../lib/supabaseAuth';
import { fetchUnreadCount } from '../lib/unreadCount';

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

const RED_BADGE = '#e71d36';

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
  // ── UNREAD BADGE ──────────────────────────────────────────────
  // Read on mount and re-read when the tab regains focus, rather than
  // subscribed. A count that is a few seconds stale is not a problem; a
  // realtime subscription held open on every page for a number nobody
  // acts on immediately is.
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const session = await getSession();
      if (cancelled) return;
      setUnread(await fetchUnreadCount(session?.user?.id));
    };
    load();
    // Re-read on return, so opening the panel in another tab and coming
    // back does not leave a badge claiming unread items that are read.
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => { cancelled = true; window.removeEventListener('focus', onFocus); };
  }, []);

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
    // One profile destination for everyone. /profile resolves to the
    // artist's own console or the viewer's profile depending on who is
    // asking, so the nav no longer needs to know -- and no longer reads
    // the legacy localStorage accountType flag to decide.
    { key: 'profile', label: 'PROFILE', href: '/profile', Icon: UserCircle },
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
          <div className="sidebar-title">Loudentify</div>
          <span className="sidebar-subtitle">LIVE MUSIC PLATFORM</span>
        </div>
        <div className="sidebar-nav">
          {items.map((item) => {
            const isActive = item.key === active;
            const textColor = isActive ? TEAL : MUTED;
            const iconColor = item.key === 'wallet' ? ORANGE : textColor;
            const className = `sidebar-item ${isActive ? 'active' : ''}`;
            const badge = item.key === 'notifications' && unread > 0 ? unread : null;
            const inner = (
              <>
                <item.Icon size={17} weight="regular" color={iconColor} className="sidebar-icon" />
                <span className="sidebar-label">{item.label}</span>
                {badge !== null && (
                  <span
                    aria-label={`${badge} unread`}
                    style={{
                      marginLeft: 'auto', minWidth: 17, height: 17, padding: '0 5px',
                      borderRadius: 999, background: RED_BADGE, color: '#fff',
                      fontSize: 10, fontWeight: 700, lineHeight: '17px', textAlign: 'center',
                      // Capped so a long-neglected account shows "9+"
                      // rather than a number wide enough to break the nav.
                      boxShadow: '0 0 8px rgba(231,29,54,0.5)',
                    }}
                  >
                    {badge > 9 ? '9+' : badge}
                  </span>
                )}
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
