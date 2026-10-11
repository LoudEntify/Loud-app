'use client';
// components/site/SiteShell.jsx — the frame around every public website page
// (design/WebHome.dc.html header and footer). Header shows Log in and a CTA
// when signed out, and an avatar menu with Log out when signed in
// (docs/USER_JOURNEY.md, Website). The cookie banner is the same component
// the app uses, so one choice covers both.
import '../../app/viewer.css';
import '../../app/site.css';
import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { useSession } from '../../lib/useSession';
import { signOut } from '../../lib/supabaseAuth';
import CookieBanner from '../viewer/CookieBanner';
import SiteFooter from './SiteFooter';

export const NAV = [
  ['/whats-on', 'Live and upcoming'],
  ['/artists', 'For artists'],
  ['/fans', 'For fans'],
  ['/pricing', 'Pricing'],
  ['/get-app', 'Get the app'],
];

function NavLinks({ pathname, className }) {
  return NAV.map(([href, label]) => (
    <a key={href} href={href} aria-current={pathname === href ? 'page' : undefined} className={className}>{label}</a>
  ));
}

function Account({ cta }) {
  const { session, profile, loading } = useSession();
  const [open, setOpen] = useState(false);
  if (loading) return <span className="w-pill w-pill-ghost" aria-hidden="true" style={{ width: 92 }} />;
  if (!session) {
    return (
      <>
        <a href="/login" className="w-pill w-pill-ghost">Log in</a>
        {cta && <a href={cta.href} className="w-pill w-pill-ink" data-testid="header-cta">{cta.label}</a>}
      </>
    );
  }
  const name = profile?.display_name || 'You';
  return (
    <div style={{ position: 'relative' }}>
      <button className="w-pill w-pill-ghost" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid="account-menu">
        <span className="w-avatar" style={{ width: 28, height: 28 }}>{profile?.avatar_url ? <img src={profile.avatar_url} alt="" /> : null}</span>
        {name}
      </button>
      {open && (
        <div role="menu" className="w-menu-list" style={{ display: 'flex', position: 'absolute', right: 0, top: 52 }}>
          <a role="menuitem" href="/discover">Open the app</a>
          <a role="menuitem" href="/profile">Profile</a>
          <a role="menuitem" href="/wallet">Wallet</a>
          <button role="menuitem" style={{ textAlign: 'left', padding: '12px 14px', fontSize: 17 }} onClick={async () => { await signOut(); window.location.href = '/'; }}>Log out</button>
        </div>
      )}
    </div>
  );
}

export default function SiteShell({ children, cta = { href: '/discover', label: 'Start watching' }, animate = false }) {
  const pathname = usePathname();
  return (
    <div className={`w-root ${animate ? 'w-anim' : ''}`}>
      <a href="#main" className="w-skip">Skip to content</a>
      <header className="w-wrap w-header">
        <a href="/" className="w-logo" aria-label="Loudentify home"><img src="/logo/loudentify-on-light.png" alt="Loudentify" /></a>
        <nav className="w-nav" aria-label="Main"><NavLinks pathname={pathname} /></nav>
        <div className="w-header-right">
          <Account cta={cta} />
          <details className="w-menu">
            <summary aria-label="Menu">Menu</summary>
            <div className="w-menu-list"><NavLinks pathname={pathname} /><a href="/about">About</a><a href="/help">Help</a><a href="/contact">Contact</a>{cta && <a href={cta.href} style={{ fontWeight: 700 }}>{cta.label}</a>}</div>
          </details>
        </div>
      </header>
      <main id="main" className="w-wrap" style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>{children}</main>
      <SiteFooter />
      <CookieBanner />
    </div>
  );
}
