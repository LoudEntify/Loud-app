// /about — design/WebAbout.dc.html.
import SiteShell from '../../components/site/SiteShell';
import { Eye, Coin, Bars, Mic } from '../../components/site/SiteIcons';

export const metadata = { title: 'About · Loudentify', description: 'Talent should not depend on who can afford a film crew.' };

const VALUES = [
  ['Nobody pays to be found', 'No paid placement in the feed. New artists get real space.', Eye, 'w-disc-teal'],
  ['Money reaches artists', 'They keep 72.5% of what fans send them.', Coin, 'w-disc-orange'],
  ['Votes, not wallets', 'Competition results come from fans, never from who spent most.', Bars, 'w-disc-red'],
  ['The show comes first', 'No ads cutting into a song. Ever.', Mic, 'w-disc-teal'],
];

export default function About() {
  return (
    <SiteShell cta={null}>
      <section className="w-section" style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center' }}>
        <h1 className="w-h1" style={{ fontSize: 58, maxWidth: 900 }}>Talent should not depend on who can afford a film crew</h1>
        <p className="w-lead" style={{ maxWidth: 780 }}>Independent artists can play brilliantly and still look like a shaky phone propped against a mug. Loudentify gives them the production, so the performance is what people judge.</p>
      </section>
      <section className="w-grid w-grid-3" style={{ gap: 24 }}>
        <div className="w-card"><h2 className="w-h3" style={{ fontSize: 24 }}>The problem we started from</h2><p style={{ fontSize: 17, lineHeight: 1.45 }}>Artists told us the same thing: getting heard by strangers is harder than getting good. Gigs are scarce, and a livestream from one fixed angle loses the room.</p></div>
        <div className="w-card"><h2 className="w-h3" style={{ fontSize: 24 }}>What we built</h2><p style={{ fontSize: 17, lineHeight: 1.45 }}>Phones become cameras. Loudentify directs the cuts as the performance happens, so one person alone can put on a show that looks made by a crew.</p></div>
        <div className="w-card"><h2 className="w-h3" style={{ fontSize: 24 }}>Where we are</h2><p style={{ fontSize: 17, lineHeight: 1.45 }}>We have run live pilot shows with real audiences, and we fix what those evenings expose. Every show teaches us something the plan did not.</p></div>
      </section>
      <section className="w-section"><div className="w-dark" style={{ display: 'flex', gap: 40, alignItems: 'center', flexWrap: 'wrap' }}>
        <img src="/logo/loudentify-on-dark.png" alt="Loudentify" style={{ width: 280, maxWidth: '100%' }} />
        <div style={{ flex: 1, minWidth: 260, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h2 className="w-h2">Why a whale</h2>
          <p className="w-lead">Whale song carries for miles through open water. One voice, sent far further than it has any right to reach, and answered by others. That is the whole idea.</p>
        </div>
      </div></section>
      <section className="w-section" style={{ paddingTop: 0, display: 'flex', flexDirection: 'column', gap: 24 }}>
        <h2 className="w-h2">What we hold to</h2>
        <div className="w-grid w-grid-4">
          {VALUES.map(([h, p, Icon, disc]) => <div key={h} className="w-card" style={{ padding: 24 }}><span className={`w-disc ${disc}`} style={{ width: 48, height: 48 }}><Icon size={22} /></span><h3 className="w-h3">{h}</h3><p style={{ fontSize: 16, lineHeight: 1.45 }}>{p}</p></div>)}
        </div>
      </section>
      <section className="w-section" style={{ paddingTop: 0 }}><div className="w-banner" style={{ background: 'linear-gradient(135deg, rgba(46,196,182,.32), rgba(255,255,255,.9) 60%)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}><h2 className="w-h2">Want to work with us, or write about us?</h2><p className="w-lead">We answer everything that is not spam.</p></div>
        <a href="/contact" className="w-pill w-pill-lg w-pill-ink">Get in touch</a>
      </div></section>
    </SiteShell>
  );
}
