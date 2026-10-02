// /artists — For artists (design/WebForArtists.dc.html).
import SiteShell from '../../components/site/SiteShell';
import { Camera, Sliders, Coin, Mic, Wifi, Moon } from '../../components/site/SiteIcons';

export const metadata = { title: 'For artists · Loudentify', description: 'No venue to book, no crew to hire, no algorithm deciding whether anyone hears you. Set a time, point your phones, and perform.' };

const FEATURES = [
  ['Your phones are the crew', 'Scan a code and a spare phone becomes a second camera. Loudentify cuts between them while you play.', Camera, 'w-disc-teal'],
  ['Set up once', 'Save your mic and camera settings as a place. Every show after that loads them for you.', Sliders, 'w-disc-orange'],
  ['Get paid by fans', 'Fans send tokens during your show. You keep 72.5%, and cash out once your identity is checked.', Coin, 'w-disc-red'],
];
const CHECKS = [['Mic is really sending', Mic], ['Cameras hold steady', Camera], ['Connection is strong', Wifi], ['No interruptions', Moon]];
const COSTS = [
  ['£0', 'to start', 'Free viewer-hours and show slots every month. Buy a prepaid pack only when you outgrow them.', 'w-card-tint-teal'],
  ['72.5%', 'of what fans send you', 'Support goes to you, not into an ad system. Nothing renews on its own.', ''],
  ['0', 'paid placements', 'Nobody can pay to be discovered. New artists get real space in the feed.', ''],
];

export default function ForArtists() {
  return (
    <SiteShell cta={{ href: '/signup?trigger=perform&next=/artist/onboarding', label: 'Start performing' }}>
      <section className="w-hero" style={{ minHeight: 0 }}>
        <div className="w-hero-text">
          <h1 className="w-h1">Play to people who chose to be there</h1>
          <p className="w-lead">No venue to book, no crew to hire, no algorithm deciding whether anyone hears you. Set a time, point your phones, and perform.</p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <a href="/signup?trigger=perform&next=/artist/onboarding" className="w-pill w-pill-lg w-pill-teal">Book your first show</a>
            <a href="/pricing" className="w-pill w-pill-lg w-pill-outline">See what it costs</a>
          </div>
        </div>
        <div className="w-hero-art" aria-hidden="true" style={{ minHeight: 380 }}>
          <span className="w-phone" style={{ width: 200, height: 320, left: '20%', top: 20, borderRadius: 26 }} />
          <span className="w-phone w-phone-dark" style={{ width: 200, height: 260, left: '50%', top: 80, borderRadius: 22 }} />
          <span className="w-orb w-orb-teal" style={{ width: 160, height: 160, right: 0, bottom: 0 }} />
          <span className="w-live-pill" style={{ left: '24%', top: 36 }}>LIVE</span>
        </div>
      </section>

      <section className="w-section" style={{ paddingTop: 0 }}><div className="w-grid w-grid-3" style={{ gap: 24 }}>
        {FEATURES.map(([h, p, Icon, disc]) => (
          <div key={h} className="w-card"><span className={`w-disc ${disc}`}><Icon size={26} /></span><h2 className="w-h3" style={{ fontSize: 24 }}>{h}</h2><p style={{ fontSize: 17, lineHeight: 1.45 }}>{p}</p></div>
        ))}
      </div></section>

      <section className="w-section" style={{ paddingTop: 0 }}><div className="w-dark" style={{ padding: 56, display: 'flex', flexDirection: 'column', gap: 24 }}>
        <h2 className="w-h2">Before you go live</h2>
        <p className="w-lead" style={{ maxWidth: 780 }}>Kit Check runs through everything that has ruined a live show before: a dead mic, a camera that quietly stops sending, a phone that rings mid-song. Nothing streams while you check.</p>
        <div className="w-grid w-grid-4">{CHECKS.map(([l, Icon]) => <div key={l} className="w-tile"><Icon size={24} />{l}</div>)}</div>
      </div></section>

      <section className="w-section" style={{ paddingTop: 0, display: 'flex', flexDirection: 'column', gap: 24 }}>
        <h2 className="w-h2">What it costs</h2>
        <div className="w-grid w-grid-3">
          {COSTS.map(([n, l, p, tint]) => (
            <div key={l} className={`w-card ${tint}`}><span style={{ fontSize: 40, fontWeight: 700, lineHeight: 1 }}>{n}</span><strong style={{ fontSize: 19 }}>{l}</strong><p style={{ fontSize: 17, lineHeight: 1.45 }}>{p}</p></div>
          ))}
        </div>
      </section>

      <section className="w-section" style={{ paddingTop: 0 }}><div className="w-banner w-banner-teal">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}><h2 className="w-h2">Your first show could be tonight</h2><p className="w-lead">Book a slot at least 30 minutes ahead, run Kit Check, and play.</p></div>
        <a href="/signup?trigger=perform&next=/artist/onboarding" className="w-pill w-pill-lg w-pill-ink">Start performing</a>
      </div></section>
    </SiteShell>
  );
}
