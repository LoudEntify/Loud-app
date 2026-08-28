'use client';

import Sidebar from './Sidebar';
import OnboardingNudge from './OnboardingNudge';
import './reactions.css';

// Desktop-first shell: sidebar left, page content fills the rest of the
// viewport. hideSidebar is driven by a page's own fullscreen/maximize
// state (e.g. the live stage), not owned here -- fully unmounts Sidebar,
// no animation. autoHideSidebar is only ever true for the fan-viewer
// mobile experience (see LiveDemo.jsx) -- everywhere else it's the
// default false. sidebarCollapsed/onToggleSidebarCollapse are a
// separate, performer-only manual collapse (see Sidebar.jsx) -- Sidebar
// stays mounted and animates via CSS width, rather than unmounting like
// hideSidebar does; onToggleSidebarCollapse being undefined (viewer,
// camfeed) means Sidebar simply never renders its collapse button.
//
// liveOverlay (build 3c) -- ONLY ever passed true by LiveDemo.jsx. Adds
// .page-shell--live, the scoping hook every live-screen-only style in
// reactions.css hangs off (sidebar-as-video-overlay, the text/icon
// halo, etc.) -- every other page's call site omits it, so nothing in
// this build can affect Discover/Profile/etc, structurally, not just by
// convention: the class this all depends on can't exist there.
export default function PageShell({ active = 'live', hideSidebar = false, autoHideSidebar = false, sidebarCollapsed = false, onToggleSidebarCollapse, liveOverlay = false, children }) {
  return (
    <div className={`page-shell ${liveOverlay ? 'page-shell--live' : ''}`}>
      {!hideSidebar && (
        <Sidebar
          active={active}
          autoHide={autoHideSidebar}
          collapsed={sidebarCollapsed}
          onToggleCollapse={onToggleSidebarCollapse}
        />
      )}
      <main className="page-shell-main">
        {/* Deliberately gated on !liveOverlay: a setup reminder laid over
            someone's live performance is indefensible, and gating it here
            (rather than inside the component) means no live surface can
            accidentally opt back in. */}
        {!liveOverlay && <OnboardingNudge />}
        {children}
      </main>
    </div>
  );
}
