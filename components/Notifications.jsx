'use client';

import Link from 'next/link';
import { Broadcast, ChatCircleText, UserPlus } from '@phosphor-icons/react';

const INK = '#011627';
const PORCELAIN = '#fdfffc';
const TEAL = '#2ec4b6';
const RED = '#e71d36';

// Mock data only -- static notification feed, no real-time/backend source
// yet. "Went live" items link into the existing "/" join flow (the only
// live destination that exists); comment/follow items have no page to
// land on yet, so they render inert rather than link to a fake target.
const ITEMS = [
  { id: 1, href: '/', text: 'Neon Meridian just went live — Versus vs Solstice Blue', time: '2m ago', unread: true, iconBg: 'rgba(231,29,54,0.12)', iconColor: RED, Icon: Broadcast, border: 'rgba(231,29,54,0.35)' },
  { id: 2, href: null, text: '"dro" replied to your comment: quote — "drop the bass NOW"', time: '14m ago', unread: true, iconBg: 'rgba(46,196,182,0.1)', iconColor: TEAL, Icon: ChatCircleText, border: 'rgba(46,196,182,0.3)' },
  { id: 3, href: null, text: 'mira.wav started following you', time: '1h ago', unread: false, iconBg: 'rgba(1,22,39,0.08)', iconColor: 'rgba(1,22,39,0.7)', Icon: UserPlus, border: 'rgba(1,22,39,0.1)' },
  { id: 4, href: null, text: "benji quoted your comment on Rhea Cross's show", time: '3h ago', unread: false, iconBg: 'rgba(1,22,39,0.08)', iconColor: TEAL, Icon: ChatCircleText, border: 'rgba(1,22,39,0.1)' },
  { id: 5, href: null, text: 'Kilo Wave started following you', time: '1d ago', unread: false, iconBg: 'rgba(1,22,39,0.08)', iconColor: 'rgba(1,22,39,0.7)', Icon: UserPlus, border: 'rgba(1,22,39,0.1)' },
  { id: 6, href: '/', text: 'Marlin Grace just went live — Solo', time: '2d ago', unread: false, iconBg: 'rgba(1,22,39,0.08)', iconColor: RED, Icon: Broadcast, border: 'rgba(1,22,39,0.1)' },
];

export default function Notifications() {
  return (
    <div style={{ minHeight: '100vh', width: '100%', boxSizing: 'border-box', background: PORCELAIN, color: INK, padding: '32px 40px 60px' }}>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>

        <div style={{ fontSize: 21, fontWeight: 700, color: INK }}>Notifications</div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 22 }}>
          {ITEMS.map((item) => {
            const Wrapper = item.href ? Link : 'div';
            return (
              <Wrapper
                key={item.id}
                href={item.href ?? undefined}
                style={{ display: 'flex', alignItems: 'center', gap: 12, textDecoration: 'none', padding: '13px 14px', border: `1px solid ${item.border}`, clipPath: 'polygon(10px 0,100% 0,100% 100%,0 100%,0 10px)', position: 'relative', cursor: item.href ? 'pointer' : 'default' }}
              >
                <div style={{ width: 36, height: 36, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: item.iconBg, clipPath: 'polygon(6px 0,100% 0,100% 100%,0 100%,0 6px)' }}>
                  <item.Icon size={16} color={item.iconColor} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: INK, lineHeight: 1.35 }}>{item.text}</div>
                  <div style={{ fontSize: 9.5, color: 'rgba(1,22,39,0.45)', marginTop: 3 }}>{item.time}</div>
                </div>
                {item.unread && (
                  <div style={{ width: 7, height: 7, borderRadius: '50%', background: RED, boxShadow: `0 0 8px ${RED}`, flexShrink: 0 }} />
                )}
              </Wrapper>
            );
          })}
        </div>

      </div>
    </div>
  );
}
