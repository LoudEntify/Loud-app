// The whole of the public site while the gate is up.
//
// The mark and three words. No navigation, no sign-up, no log-in, no
// footer links to pages that would themselves be gated — a page that
// says "coming soon" and then offers a way in has not said it.
//
// Server-rendered and static: there is nothing here to make dynamic,
// and a page with no client bundle cannot be made to do anything by
// anyone who opens it.
import Logo from '../../components/Logo';

export const metadata = {
  title: 'Loudentify — coming soon',
  description: 'Live music, directed as it happens. Coming soon.',
  robots: { index: false, follow: false },
};

export default function ComingSoon() {
  return (
    <main
      style={{
        position: 'fixed', inset: 0,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 28,
        background: '#011627', padding: 24, textAlign: 'center',
      }}
    >
      <Logo surface="dark" height={64} />
      <p
        style={{
          margin: 0,
          fontFamily: '"PT Sans Narrow", system-ui, sans-serif',
          fontSize: 22, letterSpacing: '0.14em', textTransform: 'uppercase',
          color: 'rgba(253,255,252,0.82)',
        }}
      >
        Coming soon
      </p>
    </main>
  );
}
