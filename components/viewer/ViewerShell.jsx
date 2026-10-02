'use client';
// components/viewer/ViewerShell.jsx — the frame around every viewer screen:
// the stylesheet, the tab bar, the offline bar and the cookie banner.
import '../../app/viewer.css';
import TabBar from './TabBar';
import CookieBanner from './CookieBanner';
import { OfflineBar } from './States';

export default function ViewerShell({ children, variant = 'light', tabs = true, cookieBanner = true, className = '' }) {
  return (
    <div className={`v-root ${variant === 'dark' ? 'v-dark' : 'v-light'} ${className}`}>
      <OfflineBar />
      {children}
      {tabs && <TabBar variant={variant === 'dark' ? 'dark' : 'light'} />}
      {/* The floating banner never appears on the show screen: it would sit over
          the player. There, consent for the embed is asked INSIDE the player's
          box (PlayerFrame) and analytics stays off until the banner is answered
          on another screen. */}
      {cookieBanner && <CookieBanner />}
    </div>
  );
}
