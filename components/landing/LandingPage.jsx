// components/landing/LandingPage.jsx — the public landing at "/": the
// viewport-locked hero (headline, two calls to action, the mosaic) with the
// site's own sections passed in as children underneath, then the site
// footer and the cookie banner. Imported only by app/page.js; nothing in
// the live show, camera, replay or console paths may import it.
import '../../app/viewer.css';
import '../../app/site.css';
import './landing.css';
import LandingHeader, { GO_LIVE } from './LandingHeader';
import LandingGate from './LandingGate';
import Mosaic from './Mosaic';
import SiteFooter from '../site/SiteFooter';
import CookieBanner from '../viewer/CookieBanner';

export const HEADLINE = ['Your stage.', 'Our crew.', 'Live.'];
export const BODY = 'Loudentify films and directs live shows for independent artists, with an AI director behind the camera.';
export const WATCH = '/discover';

export default function LandingPage({ children }) {
  return (
    <div className="lm-root" data-testid="landing">
      <div className="lm-bg" aria-hidden="true"><div className="lm-bg-layer" /></div>
      <LandingGate />
      <a href="#main" className="w-skip">Skip to content</a>
      <LandingHeader />
      <main id="main">
        <section className="lm-hero" data-testid="hero">
          <div className="lm-text">
            <h1 className="lm-h1">
              {HEADLINE.map((line, i) => (
                <span key={line} className="lm-mask"><span className={`lm-line${i === HEADLINE.length - 1 ? ' lm-line-live' : ''}`} style={{ '--i': i }}>{line}</span></span>
              ))}
            </h1>
            <p className="lm-body">{BODY}</p>
            <div className="lm-ctas">
              <a href={GO_LIVE} className="lm-pill lm-pill-teal" data-testid="cta-go-live">Go Live</a>
              <a href={WATCH} className="lm-pill lm-pill-outline" data-testid="cta-watch">Watch a show</a>
            </div>
          </div>
          <Mosaic />
        </section>
        <div className="w-root lm-below">
          <div className="w-wrap">{children}</div>
          <SiteFooter surface="dark" />
        </div>
      </main>
      <CookieBanner />
    </div>
  );
}
