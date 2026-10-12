// /get-app — design/WebGetApp.dc.html. Until the apps are listed
// (docs/NEEDS_KOREY.md: Apple and Google steps) there is one plain
// "Coming soon" label, not a store button. When both store URLs exist,
// the official "Download on the App Store" and "Get it on Google Play"
// badge artwork (downloaded from Apple's and Google's badge pages, used
// to their guidelines, never redrawn) replaces the label below, each
// linking to its store.
import SiteShell from '../../components/site/SiteShell';
import { PhoneFrame, LiveViewScreen, DiscoverScreen } from '../../components/site/DemoScreens';

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
          {listed ? (
            /* OFFICIAL STORE BADGES GO HERE once the apps are live: Apple's
               and Google's badge artwork as <a href={APP_STORE_URL}> and
               <a href={PLAY_STORE_URL}>, sized and spaced per their rules. */
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }} data-testid="store-links">
              <a href={APP_STORE_URL} className="w-pill w-pill-lg w-pill-ink">App Store</a>
              <a href={PLAY_STORE_URL} className="w-pill w-pill-lg w-pill-ink">Google Play</a>
            </div>
          ) : (
            <span className="w-pill w-pill-lg w-pill-ghost w-coming-soon" aria-disabled="true" data-testid="store-coming-soon">Coming soon to iPhone and Android</span>
          )}
          {!listed && <span className="w-note" data-testid="store-pending"><span className="w-badge w-badge-draft">NOT YET LISTED</span>&nbsp; The apps are built but not in the stores yet. Until then, the web app does everything.</span>}
          <div className="w-card" style={{ flexDirection: 'row', alignItems: 'center', gap: 20, maxWidth: 420 }}>
            <span className="w-qr" aria-label="Scan to download">QR code when the apps are listed</span>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}><strong style={{ fontSize: 18 }}>Scan with your phone</strong><span style={{ opacity: .75 }}>Opens the right store for your device.</span></span>
          </div>
          <span style={{ fontSize: 17 }}>Rather not install anything? <a href="/discover" className="w-link">Watch in your browser</a>.</span>
        </div>
        <div className="w-hero-art" aria-hidden="true" style={{ '--art-h': '660px' }}>
          {/* back: the app's home, Discover; front: the viewer's live view. Both around illustrative performers. */}
          <PhoneFrame width={250} left="10%" top={20} testid="get-app-phone-back" illustrative><DiscoverScreen file="amapiano.webp" lazy={false} /></PhoneFrame>
          <PhoneFrame width={250} left="44%" top={70} testid="get-app-phone-front"><LiveViewScreen file="afrobeat.webp" lazy={false} /></PhoneFrame>
        </div>
      </section>
    </SiteShell>
  );
}
