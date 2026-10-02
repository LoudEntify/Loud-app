// /help — design/WebHelp.dc.html.
import SiteShell from '../../components/site/SiteShell';
import HelpSearch from '../../components/site/HelpSearch';
import { ARTICLES, CATEGORIES, MOST_ASKED } from '../../lib/site/help';
import { Person, Camera, Coin, Shield, Chevron } from '../../components/site/SiteIcons';

export const metadata = { title: 'Help · Loudentify', description: 'How can we help?' };
const ICONS = { account: [Person, 'w-disc-teal'], show: [Camera, 'w-disc-orange'], money: [Coin, 'w-disc-red'], safety: [Shield, 'w-disc-teal'] };

export default function Help() {
  const most = MOST_ASKED.map((s) => ARTICLES.find((a) => a.slug === s)).filter(Boolean);
  return (
    <SiteShell cta={null}>
      <section className="w-section" style={{ display: 'flex', flexDirection: 'column', gap: 24, alignItems: 'center', textAlign: 'center' }}>
        <h1 className="w-h1">How can we help?</h1>
        <HelpSearch />
      </section>
      <section className="w-grid w-grid-4">
        {CATEGORIES.map((c) => { const [Icon, disc] = ICONS[c.key]; return <a key={c.key} href={`/help#${c.key}`} className="w-card" style={{ padding: 24 }}><span className={`w-disc ${disc}`} style={{ width: 52, height: 52 }}><Icon size={24} /></span><h2 className="w-h3" style={{ fontSize: 22 }}>{c.title}</h2><p style={{ opacity: .75 }}>{c.blurb}</p></a>; })}
      </section>
      <div className="w-cols" style={{ paddingTop: 40 }}>
        <div className="w-main">
          <h2 className="w-h2">Asked most often</h2>
          <div className="w-list" data-testid="help-most-asked">{most.map((a) => <a key={a.slug} href={`/help/${a.slug}`}><span>{a.title}</span><Chevron size={20} /></a>)}</div>
          {CATEGORIES.map((c) => (
            <div key={c.key} id={c.key} style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
              <h2 className="w-h3" style={{ fontSize: 24 }}>{c.title}</h2>
              <div className="w-list">{ARTICLES.filter((a) => a.category === c.key).map((a) => <a key={a.slug} href={`/help/${a.slug}`}><span>{a.title}</span><Chevron size={20} /></a>)}</div>
            </div>
          ))}
        </div>
        <aside className="w-aside">
          <div className="w-dark" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 12 }}><h2 className="w-h3" style={{ fontSize: 22 }}>Playing your first show?</h2><p style={{ fontSize: 17, lineHeight: 1.45 }}>The setup guide walks through mics, cameras and Kit Check, with what to do when something fails.</p><a href="/help/first-show" className="w-pill w-pill-teal" style={{ alignSelf: 'flex-start' }}>Read the setup guide</a></div>
          <div className="w-card"><h2 className="w-h3" style={{ fontSize: 22 }}>Still stuck?</h2><p style={{ fontSize: 17, lineHeight: 1.45 }}>Send us the show and roughly when it happened, and we can look at what our side recorded.</p><a href="/contact" className="w-pill w-pill-outline" style={{ alignSelf: 'flex-start' }}>Contact us</a></div>
        </aside>
      </div>
    </SiteShell>
  );
}
