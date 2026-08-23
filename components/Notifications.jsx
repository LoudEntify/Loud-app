'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Broadcast, ChatCircleText, UserPlus, Bell } from '@phosphor-icons/react';
import { getSupabase } from '../lib/supabaseClient';
import { getSession } from '../lib/supabaseAuth';
import EmptyState from './EmptyState';

const INK = '#011627';
const PORCELAIN = '#fdfffc';
const TEAL = '#2ec4b6';
const RED = '#e71d36';

// Real notifications only. The mock feed that used to live here
// (invented follows, invented replies, invented artists) is gone --
// fabricated activity is the fastest way to make every real number on
// the platform untrustworthy.
//
// Reads the `notifications` table (docs/notifications_migration.sql).
// If that migration has not been run yet the query errors and this
// renders the empty state rather than breaking the page.
const ICONS = {
  show_reminder: { Icon: Broadcast, color: RED, bg: 'rgba(231,29,54,0.12)', border: 'rgba(231,29,54,0.35)' },
  show_live: { Icon: Broadcast, color: RED, bg: 'rgba(231,29,54,0.12)', border: 'rgba(231,29,54,0.35)' },
  comment: { Icon: ChatCircleText, color: TEAL, bg: 'rgba(46,196,182,0.1)', border: 'rgba(46,196,182,0.3)' },
  follow: { Icon: UserPlus, color: 'rgba(1,22,39,0.7)', bg: 'rgba(1,22,39,0.08)', border: 'rgba(1,22,39,0.1)' },
  system: { Icon: Bell, color: 'rgba(1,22,39,0.7)', bg: 'rgba(1,22,39,0.08)', border: 'rgba(1,22,39,0.1)' },
};

function relativeTime(iso) {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 60) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export default function Notifications() {
  const [items, setItems] = useState(null); // null = loading

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const session = await getSession();
        if (!session?.user) { if (!cancelled) setItems([]); return; }
        const { data, error } = await getSupabase()
          .from('notifications')
          .select('*')
          .eq('user_id', session.user.id)
          .order('created_at', { ascending: false })
          .limit(50);
        if (cancelled) return;
        setItems(error ? [] : (data || []));
      } catch {
        if (!cancelled) setItems([]);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div style={{ minHeight: '100vh', width: '100%', boxSizing: 'border-box', background: PORCELAIN, color: INK, padding: '32px 40px 60px' }}>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>

        <div style={{ fontSize: 21, fontWeight: 700, color: INK }}>Notifications</div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 22 }}>
          {items === null && (
            <div style={{ fontSize: 12, color: 'rgba(1,22,39,0.4)' }}>Loading…</div>
          )}

          {items !== null && items.length === 0 && (
            <EmptyState
              title="Nothing yet"
              body="Show reminders and platform updates land here. Schedule a show, or follow an artist, and this fills up on its own."
              action="FIND ARTISTS"
              actionHref="/discover"
            />
          )}

          {(items || []).map((item) => {
            const style = ICONS[item.kind] || ICONS.system;
            const Wrapper = item.href ? Link : 'div';
            return (
              <Wrapper
                key={item.id}
                href={item.href ?? undefined}
                style={{ display: 'flex', alignItems: 'center', gap: 12, textDecoration: 'none', padding: '13px 14px', border: `1px solid ${style.border}`, clipPath: 'polygon(10px 0,100% 0,100% 100%,0 100%,0 10px)', position: 'relative', cursor: item.href ? 'pointer' : 'default' }}
              >
                <div style={{ width: 36, height: 36, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: style.bg, clipPath: 'polygon(6px 0,100% 0,100% 100%,0 100%,0 6px)' }}>
                  <style.Icon size={16} color={style.color} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: INK, lineHeight: 1.35 }}>{item.body}</div>
                  <div style={{ fontSize: 9.5, color: 'rgba(1,22,39,0.45)', marginTop: 3 }}>{relativeTime(item.created_at)}</div>
                </div>
                {!item.read_at && (
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
