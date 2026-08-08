'use client';

import Sidebar from './Sidebar';
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
export default function PageShell({ active = 'live', hideSidebar = false, autoHideSidebar = false, sidebarCollapsed = false, onToggleSidebarCollapse, children }) {
  return (
    <div className="page-shell">
      {!hideSidebar && (
        <Sidebar
          active={active}
          autoHide={autoHideSidebar}
          collapsed={sidebarCollapsed}
          onToggleCollapse={onToggleSidebarCollapse}
        />
      )}
      <main className="page-shell-main">{children}</main>
    </div>
  );
}
