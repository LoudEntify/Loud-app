import { Space_Grotesk } from 'next/font/google';

// Font assumption: applying Space Grotesk as a sensible default matching
// the brief given to Claude Design (clean, geometric, a little edgy).
// Swap this single import if Claude Design's prototype landed on a
// different one -- it's a one-line change, nothing else depends on it.
const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-app',
});

export const metadata = {
  title: 'Loudentify pilot',
  description: 'Live performance pilot build',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={spaceGrotesk.variable}>
      <body style={{ margin: 0, background: '#011627', color: '#fdfffc', fontFamily: 'var(--font-app), sans-serif' }}>
        {children}
      </body>
    </html>
  );
}
