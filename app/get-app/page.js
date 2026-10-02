// /get-app — design/WebGetApp.dc.html. The store links are placeholders
// until the apps are listed (docs/NEEDS_KOREY.md: Apple and Google steps);
// the badges here are drawn in CSS, and the official badge artwork goes in
// when the listings exist.
import SiteShell from '../../components/site/SiteShell';

export const metadata = { title: 'Get the app · Loudentify', description: 'Watch live shows, get told when your artists go on, and perform from the same app.' };

const APP_STORE_URL = process.env.NEXT_PUBLIC_APP_STORE_URL || '';
const PLAY_STORE_URL = process.env.NEXT_PUBLIC_PLAY_STORE_URL || '';

export default function GetApp() {
  const listed = Boolean(APP_STORE_URL && PLAY_STORE_URL);
  return (
    <SiteShell cta={null}>
      <section className="w-hero" style={{ minHeight: 0 }}>
        <div className="w-hero-text">
          <h1 className="w-h1">Loudentify on your phone</h1>
          <p className="w-lead">Watch live shows, get told when your artists go on, and perform from the same app. A spare phone becomes your second camera.</p>
          <div className="w-badges" data-testid="store-badges">
            <a href={APP_STORE_URL || '/help/get-the-app'} className="w-store w-store-apple" aria-label="Download on the App Store" aria-disabled={!APP_STORE_URL}><span className="w-store-logo" /><span><small>Download on the</small><b>App Store</b></span></a>
            <a href={PLAY_STORE_URL || '/help/get-the-app'} className="w-store w-store-play" aria-label="Get it on Google Play" aria-disabled={!PLAY_STORE_URL}><span className="w-store-logo" /><span><small>GET IT ON</small><b>Google Play</b></span></a>
          </div>
          {!listed && <span className="w-note" data-testid="store-pending"><span className="w-badge w-badge-draft">NOT YET LISTED</span>&nbsp; The apps are built but not in the stores yet. Until then, the web app does everything.</span>}
          <div className="w-card" style={{ flexDirection: 'row', alignItems: 'center', gap: 20, maxWidth: 420 }}>
            <span className="w-qr" aria-label="Scan to download">QR code when the apps are listed</span>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}><strong style={{ fontSize: 18 }}>Scan with your phone</strong><span style={{ opacity: .75 }}>Opens the right store for your device.</span></span>
          </div>
          <span style={{ fontSize: 17 }}>Rather not install anything? <a href="/discover" className="w-link">Watch in your browser</a>.</span>
        </div>
        <div className="w-hero-art" aria-hidden="true" style={{ minHeight: 560 }}>
          <span className="w-phone w-phone-dark" style={{ width: 250, height: 500, left: '18%', top: 20, borderRadius: 36, borderWidth: 6 }} />
          <span className="w-phone" style={{ width: 250, height: 500, left: '48%', top: 60, borderRadius: 36, borderWidth: 6 }} />
          <span className="w-live-pill" style={{ left: '52%', top: 84 }}>LIVE</span>
          <span className="w-bars" style={{ left: '24%', top: 420 }}><i style={{ height: 16, background: 'var(--teal)' }} /><i style={{ height: 30, background: 'var(--teal)' }} /><i style={{ height: 22, background: 'var(--orange)' }} /><i style={{ height: 12, background: 'var(--red)' }} /></span>
        </div>
      </section>
    </SiteShell>
  );
}
