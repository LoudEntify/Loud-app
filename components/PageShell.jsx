'use client';

import Sidebar from './Sidebar';
import './reactions.css';

// Desktop-first shell: sidebar left, page content fills the rest of the
// viewport. hideSidebar is driven by a page's own fullscreen/maximize
// state (e.g. the live stage), not owned here. autoHideSidebar is only
// ever true for the fan-viewer mobile experience (see LiveDemo.jsx) --
// everywhere else it's the default false.
export default function PageShell({ active = 'live', hideSidebar = false, autoHideSidebar = false, children }) {
  return (
    <div className="page-shell">
      {!hideSidebar && <Sidebar active={active} autoHide={autoHideSidebar} />}
      <main className="page-shell-main">{children}</main>
    </div>
  );
}
