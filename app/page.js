// / — the website home (design/WebHome.dc.html): hero, the live strip of
// real shows, how a show works, the two audience cards. The app itself
// lives at /discover; the pilot's front door stayed at /pilot. The hero's
// shapes are CSS only and animate only when the device allows motion.
import SiteShell from '../components/site/SiteShell';
import { LiveCard } from '../components/site/ShowCards';
import { publicSchedule } from '../lib/site/publicShows';
import { Mic, Camera, Calendar, Sparkle, Scissors } from '../components/site/SiteIcons';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Loudentify · A production crew in your pocket',
  description: 'Independent artists play live to real audiences. Your phones become the cameras, and Loudentify directs the show. Watch free in your browser.',
  openGraph: { title: 'Loudentify', description: 'Live music, directed for you.', siteName: 'Loudentify', type: 'website', images: [{ url: '/logo/loudentify-on-dark.png', width: 1200, height: 630 }] },
};

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
    <SiteShell animate cta={{ href: '/discover', label: 'Start watching' }}>
      <section className="w-hero" data-testid="hero">
        <div className="w-hero-text">
          <h1 className="w-h1" style={{ fontSize: 68 }}>A production crew in your pocket</h1>
          <p className="w-lead" style={{ fontSize: 22 }}>Independent artists play live to real audiences. Your phones become the cameras, and Loudentify directs the show.</p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <a href="/discover" className="w-pill w-pill-lg w-pill-teal" style={{ height: 58 }}>Watch a show, free</a>
            <a href="/artists" className="w-pill w-pill-lg w-pill-outline" style={{ height: 58 }}>Perform on Loudentify</a>
          </div>
          <span className="w-note">No account needed to start watching.</span>
        </div>
        <div className="w-hero-art" aria-hidden="true">
          <span className="w-orb w-orb-teal" style={{ width: 300, height: 300, right: 40, top: 20 }} />
          <span className="w-orb w-orb-orange" style={{ width: 220, height: 220, left: 30, bottom: 40 }} />
          <span className="w-orb w-orb-red" style={{ width: 180, height: 180, right: 120, bottom: 0 }} />
          <span className="w-tile-mic" style={{ left: '38%', top: '34%' }}><Mic size={64} /></span>
          <span className="w-bubble w-bubble-bl" style={{ left: 20, top: 60 }}>that run was unreal</span>
          <span className="w-bubble w-bubble-teal w-bubble-br" style={{ right: 10, top: 180 }}>play the second one again</span>
          <span className="w-live-pill" style={{ left: 60, top: 220 }}>LIVE</span>
          <span className="w-bars" style={{ right: 60, bottom: 80 }}><i style={{ height: 16 }} /><i style={{ height: 30 }} /><i style={{ height: 40 }} /><i style={{ height: 22 }} /><i style={{ height: 12 }} /></span>
        </div>
      </section>

      <section className="w-section" data-testid="live-strip" style={{ paddingTop: 8 }}>
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

      <section className="w-section"><div className="w-dark" style={{ padding: 56 }}>
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
    </SiteShell>
  );
}
