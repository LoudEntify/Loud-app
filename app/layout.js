import { PT_Sans_Narrow } from 'next/font/google';
import AudioHostProvider from '../components/AudioHostProvider';

// Matches the Claude Design source files' Google Fonts request exactly
// (PT+Sans+Narrow:wght@400;700) -- see VISUAL_SYSTEM_HANDOFF.md.
const ptSansNarrow = PT_Sans_Narrow({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-app',
});

export const metadata = {
  title: 'Loudentify pilot',
  description: 'Live performance pilot build',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={ptSansNarrow.variable}>
      <body style={{ margin: 0, background: '#011627', color: '#fdfffc', fontFamily: 'var(--font-app), sans-serif' }}>
        {/* TASK 2 — the audio host, mounted ABOVE {children} on purpose.
            The root layout is preserved across client-side navigations,
            so this survives Kit Check -> /live (a router.push) and every
            panel remount underneath it. Renders nothing; it exists to
            own the AudioContext and the backing-track player so that no
            component's unmount can close them.
            Do not move it inside a page, a route group, or a conditional
            — a conditionally mounted audio host is the original bug with
            extra steps. See lib/audioHost.js. */}
        <AudioHostProvider />
        {children}
      </body>
    </html>
  );
}
