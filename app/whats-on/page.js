// /whats-on — the public schedule (design/WebLiveUpcoming.dc.html, PRD:
// "every public show with its own page"). Server-rendered so search
// engines see it; filters are links so they work without JavaScript.
import SiteShell from '../../components/site/SiteShell';
import { LiveCard, ScheduleRow } from '../../components/site/ShowCards';
import { publicSchedule, dayBucket } from '../../lib/site/publicShows';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'What’s on · Loudentify', description: 'Every public show on Loudentify, live now and this week.' };

export default async function WhatsOn({ searchParams }) {
  const mode = ['solo', 'versus'].includes(searchParams?.mode) ? searchParams.mode : 'all';
  const { rows, error } = await publicSchedule({ days: 7, limit: 80 });
  const filtered = rows.filter((s) => mode === 'all' || (mode === 'versus' ? s.performance_mode === 'versus' : s.performance_mode !== 'versus'));
  const live = filtered.filter((s) => s.derived_state === 'live');
  const upcoming = filtered.filter((s) => s.derived_state !== 'live');
  const days = new Map();
  for (const s of upcoming) { const k = dayBucket(s.slated_at); if (!days.has(k)) days.set(k, []); days.get(k).push(s); }
  const chips = [['all', 'All shows'], ['solo', 'Solo'], ['versus', 'Versus']];
  return (
    <SiteShell cta={{ href: '/signup?trigger=whats-on', label: 'Sign up free' }}>
      <section className="w-section" style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h1 className="w-h1" style={{ fontSize: 52 }}>What&rsquo;s on</h1>
          <p className="w-lead">Every public show on Loudentify. Times shown in your own time zone.</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }} role="group" aria-label="Filter">
          {chips.map(([k, l]) => <a key={k} href={k === 'all' ? '/whats-on' : `/whats-on?mode=${k}`} className="w-chip" aria-current={mode === k ? 'true' : undefined}>{l}</a>)}
        </div>
      </section>

      {error && <div className="w-error" role="alert" data-testid="whats-on-error"><strong>We could not load the schedule.</strong><span>Try again in a moment. If it keeps happening, <a href="/contact" className="w-link">tell us</a>.</span></div>}

      {!error && (
        <section className="w-section" style={{ paddingTop: 0, display: 'flex', flexDirection: 'column', gap: 20 }} data-testid="live-now">
          <h2 className="w-h2"><span className="w-live-dot" aria-hidden="true" />Live now</h2>
          {live.length ? <div className="w-grid w-grid-4">{live.map((s) => <LiveCard key={s.id} show={s} />)}</div>
            : <div className="w-empty" data-testid="live-now-empty"><strong style={{ fontSize: 20 }}>Nobody is live at this minute.</strong><span>The next shows are below. Set a reminder and we will tell you when they start.</span></div>}
        </section>
      )}

      {!error && [...days.entries()].map(([day, list]) => (
        <section key={day} className="w-section" style={{ paddingTop: 0, display: 'flex', flexDirection: 'column', gap: 16 }} data-testid="day-section">
          <h2 className="w-h2">{day}</h2>
          <div className="w-schedule">{list.map((s) => <ScheduleRow key={s.id} show={s} />)}</div>
        </section>
      ))}

      {!error && upcoming.length === 0 && (
        <section className="w-section" style={{ paddingTop: 0 }}><div className="w-empty" data-testid="upcoming-empty"><strong style={{ fontSize: 20 }}>{mode === 'all' ? 'Nothing booked for the next seven days yet.' : `No ${mode === 'versus' ? 'Versus' : 'solo'} shows booked this week.`}</strong><span>Artists book at least 30 minutes ahead, so check back, or <a href="/artists" className="w-link">book one yourself</a>.</span></div></section>
      )}
    </SiteShell>
  );
}
