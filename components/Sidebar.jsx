'use client';

import Link from 'next/link';
import { Compass, Broadcast, UserCircle, Bell, Coins } from '@phosphor-icons/react';

// Matches Sidebar.dc.html from the Claude Design project exactly (icons,
// labels, active/wallet color rules). Discover/Profile/Notifications have
// no pages in this codebase yet, so they render inert -- present for visual
// fidelity, not wired to a route.
const ITEMS = [
  { key: 'discover', label: 'DISCOVER', href: null, Icon: Compass },
  { key: 'live', label: 'LIVE', href: '/', Icon: Broadcast },
  { key: 'profile', label: 'PROFILE', href: null, Icon: UserCircle },
  { key: 'notifications', label: 'NOTIFICATIONS', href: null, Icon: Bell },
  { key: 'wallet', label: 'WALLET', href: '/wallet', Icon: Coins },
];

const TEAL = '#2ec4b6';
const MUTED = 'rgba(253, 255, 252, 0.55)';
const ORANGE = '#ff9f1c';

export default function Sidebar({ active = 'live' }) {
  return (
    <nav className="sidebar">
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
  );
}
