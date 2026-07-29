'use client';

import Sidebar from './Sidebar';
import './reactions.css';

// Desktop-first shell: sidebar left, page content fills the rest of the
// viewport. hideSidebar is driven by a page's own fullscreen/maximize
// state (e.g. the live stage), not owned here.
export default function PageShell({ active = 'live', hideSidebar = false, children }) {
  return (
    <div className="page-shell">
      {!hideSidebar && <Sidebar active={active} />}
      <main className="page-shell-main">{children}</main>
    </div>
  );
}
