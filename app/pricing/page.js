// /pricing — design/WebPricing.dc.html. Figures come from lib/site/pricing.js.
import SiteShell from '../../components/site/SiteShell';
import { Check } from '../../components/site/SiteIcons';
import { ARTIST_SHARE, FREE_TIER, PACKS, TOKENS_FROM_MINOR, pounds } from '../../lib/site/pricing';

export const metadata = { title: 'Pricing · Loudentify', description: 'Fans never pay to watch. Artists start with free hours and buy a pack only when they need more.' };

const FAQ = [
  ['What happens if I run out mid-show?', 'Nothing stops. The show finishes, and we tell you afterwards.'],
  ['How much of a fan’s support do I keep?', `${ARTIST_SHARE} of the tokens sent to you.`],
  ['Do I need special gear?', 'A phone is enough. A second phone gives you a second camera.'],
  ['Is there a subscription?', 'No. Packs are prepaid, and nothing renews on its own.'],
];
const tbs = (n, unit) => (n == null ? `${unit} to be set` : `${n} ${unit}`);

export default function Pricing() {
  const unset = FREE_TIER.viewerHours == null || PACKS.some((p) => p.priceMinor == null);
  return (
    <SiteShell cta={{ href: '/signup?trigger=pricing', label: 'Sign up free' }}>
      <section className="w-section" style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center' }}>
        <h1 className="w-h1" style={{ fontSize: 56 }}>Watching is free. Always.</h1>
        <p className="w-lead" style={{ maxWidth: 760 }}>Fans never pay to watch. Artists start with free hours and buy a pack only when they need more.</p>
      </section>

      <section className="w-dark" style={{ padding: 32, display: 'flex', gap: 32, alignItems: 'center', flexWrap: 'wrap' }} data-testid="pricing-fans">
        <div style={{ flex: 1, minWidth: 260, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h2 className="w-h2">For fans</h2>
          <p className="w-lead">Watch every show, comment, and vote, at no cost. Tokens are optional, and only for supporting artists you want to back.</p>
        </div>
        <div className="w-pricebox"><span className="w-price" style={{ fontSize: 48 }}>£0</span><span style={{ fontSize: 18, fontWeight: 700 }}>to watch, for ever</span><span style={{ opacity: .85 }}>Tokens from {pounds(TOKENS_FROM_MINOR)}, bought here on the web.</span></div>
      </section>

      <section className="w-section" style={{ display: 'flex', flexDirection: 'column', gap: 24 }} data-testid="pricing-artists">
        <h2 className="w-h2">For artists</h2>
        {unset && <p className="w-note" data-testid="pricing-unset"><span className="w-badge w-badge-draft">DRAFT</span>&nbsp; The allowance and pack sizes are not set yet. The figures marked &ldquo;to be set&rdquo; are placeholders, not prices.</p>}
        <div className="w-grid w-grid-3" style={{ alignItems: 'stretch' }}>
          <div className="w-card" style={{ borderRadius: 24 }}>
            <span className="w-eyebrow">Free to start</span><span className="w-price">£0</span>
            <ul className="w-checklist">
              <li><Check size={18} />{tbs(FREE_TIER.viewerHours, 'viewer-hours a month')}</li>
              <li><Check size={18} />{tbs(FREE_TIER.showSlots, 'show slots a month')}</li>
              <li><Check size={18} />{FREE_TIER.cameras == null ? 'Cameras: to be set' : `Up to ${FREE_TIER.cameras} cameras`}</li>
              <li><Check size={18} />Recordings and clips</li>
            </ul>
            <a href="/signup?trigger=pricing&next=/artist/onboarding" className="w-pill w-pill-outline" style={{ marginTop: 'auto', height: 52 }}>Start free</a>
          </div>
          {PACKS.map((p) => (
            <div key={p.key} className={`w-card ${p.popular ? 'w-popular w-card-tint-teal' : ''}`} style={{ borderRadius: 24 }}>
              {p.popular && <span className="w-popular-tag">Most popular</span>}
              <span className="w-eyebrow">{p.eyebrow}</span><span className="w-price">{pounds(p.priceMinor)}</span>
              <ul className="w-checklist">
                <li><Check size={18} />{tbs(p.viewerHours, 'extra viewer-hours')}</li>
                <li><Check size={18} />{tbs(p.showSlots, 'extra show slots')}</li>
                {p.notes.map((n) => <li key={n}><Check size={18} />{n}</li>)}
              </ul>
              <a href="/artist/earnings" className={`w-pill ${p.popular ? 'w-pill-ink' : 'w-pill-outline'}`} style={{ marginTop: 'auto', height: 52 }}>Buy a pack</a>
            </div>
          ))}
        </div>
        <p style={{ fontSize: 17, opacity: .78 }}>A viewer-hour is one person watching for one hour. A show never cuts off mid-performance, even if your hours run out.</p>
      </section>

      <section className="w-section" style={{ paddingTop: 0, display: 'flex', flexDirection: 'column', gap: 20 }}>
        <h2 className="w-h2">Questions people ask</h2>
        <div className="w-grid w-grid-2" style={{ gap: 16 }}>
          {FAQ.map(([q, a]) => <div key={q} className="w-card" style={{ padding: 22, borderRadius: 20, gap: 6 }}><h3 style={{ fontSize: 19 }}>{q}</h3><p style={{ fontSize: 17 }}>{a}</p></div>)}
        </div>
      </section>
    </SiteShell>
  );
}
