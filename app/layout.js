import { PT_Sans_Narrow } from 'next/font/google';

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
        {children}
      </body>
    </html>
  );
}
