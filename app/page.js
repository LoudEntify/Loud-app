// / — the public landing page (components/landing): a viewport-locked
// hero with the moving mosaic, then the site's live strip of real shows,
// how a show works and the two audience cards from the previous home
// (design/WebHome.dc.html), on the dark silk. Signed-in visitors are sent
// on to /discover by the landing itself. The app lives at /discover; the
// pilot's front door stayed at /pilot.
//
// PRD rows 173 (home live strip), 174 (home hero: reduced motion, never
// delays loading), 175 (contrast, targets, labels, reduced motion), 90/91
// (Watch a show -> Discover, Go Live -> artist sign-up).
import LandingPage from '../components/landing/LandingPage';
import { LiveCard } from '../components/site/ShowCards';
import { publicSchedule } from '../lib/site/publicShows';
import { Mic, Camera, Calendar, Sparkle, Scissors } from '../components/site/SiteIcons';

// The live strip is read once a minute, not on every request.
export const revalidate = 60;

export const metadata = {
  title: 'Loudentify · Your stage. Our crew. Live.',
  description: 'Loudentify films and directs live shows for independent artists, with an AI director behind the camera. Watch free in your browser.',
  openGraph: { title: 'Loudentify', description: 'Live music, directed for you.', siteName: 'Loudentify', type: 'website', images: [{ url: '/logo/loudentify-on-dark.png', width: 1200, height: 630 }] },
};

// Only this route extends under the notch and home indicator, so its
// safe-area padding has something to respect.
export const viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#011627' };

const STEPS = [
  ['1. Book a slot', 'Pick a date and time at least 30 minutes ahead, and share the link.', Calendar],
  ['2. Set your phones', 'Scan a code to turn a spare phone into a second camera.', Camera],
  ['3. Just perform', 'Loudentify cuts between your cameras while you play.', Sparkle],
  ['4. Share the best bits', 'Cut clips from your recording and post them anywhere.', Scissors],
];

export default async function Home() {
  const { rows, error } = await publicSchedule({ days: 2, limit: 40 });
  const live = rows.filter((s) => s.derived_state === 'live');
  const soon = rows.filter((s) => s.derived_state !== 'live');
  const strip = [...live, ...soon].slice(0, 4);
  return (
    <LandingPage>
      <section className="w-section" data-testid="live-strip">
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, marginBottom: 20 }}>
          <h2 className="w-h2"><span className="w-live-dot" aria-hidden="true" />{live.length ? 'Live right now' : 'Starting soon'}</h2>
          <a href="/whats-on" className="w-link">See what&rsquo;s on</a>
        </div>
        {error ? (
          <div className="w-error" role="status"><strong>We could not load the live shows.</strong><span>The schedule is still at <a href="/whats-on" className="w-link">What&rsquo;s on</a>.</span></div>
        ) : strip.length === 0 ? (
          <div className="w-empty" data-testid="live-strip-empty"><strong style={{ fontSize: 20 }}>Nothing is on right now.</strong><span>Shows are booked at least 30 minutes ahead, so the next one is never far. <a href="/whats-on" className="w-link">See the week</a>.</span></div>
        ) : (
          <div className="w-grid w-grid-4">{strip.map((s) => <LiveCard key={s.id} show={s} />)}</div>
        )}
      </section>

      <section className="w-section" style={{ paddingTop: 0 }}><div className="w-dark" style={{ padding: 56 }}>
        <h2 className="w-h2" style={{ marginBottom: 28 }}>How a show works</h2>
        <div className="w-grid w-grid-4">
          {STEPS.map(([h, p, Icon]) => (
            <div key={h} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <span className="w-disc" style={{ background: 'var(--silk-teal)', color: 'var(--ink)' }}><Icon size={26} /></span>
              <h3 className="w-h3">{h}</h3>
              <p style={{ fontSize: 17, lineHeight: 1.4, opacity: .9 }}>{p}</p>
            </div>
          ))}
        </div>
      </div></section>

      <section className="w-section" style={{ paddingTop: 0 }}><div className="w-grid w-grid-2" style={{ gap: 24 }}>
        <div className="w-card w-card-tint-teal" style={{ padding: 32, borderRadius: 24 }}>
          <h2 className="w-h2">For artists</h2>
          <p style={{ fontSize: 18, lineHeight: 1.45 }}>Play to people who chose to be there. Free hours to start, then prepaid packs when you need more. Keep 72.5% of what fans send you.</p>
          <a href="/artists" className="w-pill w-pill-ink" style={{ alignSelf: 'flex-start', height: 52 }}>Start performing</a>
        </div>
        <div className="w-card w-card-tint-orange" style={{ padding: 32, borderRadius: 24 }}>
          <h2 className="w-h2">For fans</h2>
          <p style={{ fontSize: 18, lineHeight: 1.45 }}>Watch live music for free, comment, vote in the moment, and support the artists you love. No ads in the middle of a song.</p>
          <a href="/discover" className="w-pill w-pill-ink" style={{ alignSelf: 'flex-start', height: 52 }}>Find a show</a>
        </div>
      </div></section>
    </LandingPage>
  );
}
