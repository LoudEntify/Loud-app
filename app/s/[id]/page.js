// /s/:id — the page artists share (design/WebShowPage.dc.html, PRD 173).
// Server-rendered with Open Graph so a pasted link unfurls; the show
// screen itself is /show/:id. Five states: loading (streamed), the show
// (upcoming / live / ended), not found, and a database error.
import SiteShell from '../../../components/site/SiteShell';
import Countdown from '../../../components/site/Countdown';
import ShareBox from '../../../components/site/ShareBox';
import LocalTime from '../../../components/site/LocalTime';
import { publicShow, whoLabel } from '../../../lib/site/publicShows';
import { Calendar, Clock, Music } from '../../../components/site/SiteIcons';

export const dynamic = 'force-dynamic';
const base = () => process.env.NEXT_PUBLIC_SITE_URL || 'https://loudentify.app';

export async function generateMetadata({ params }) {
  const { show } = await publicShow(params.id);
  if (!show) return { title: 'Show · Loudentify', robots: { index: false } };
  const who = whoLabel(show);
  const title = `${show.title || 'Live show'} · ${who} · Loudentify`;
  const description = show.description || `${who} live on Loudentify. Watch free in your browser.`;
  const url = `${base()}/s/${show.id}`;
  return {
    title, description, alternates: { canonical: url },
    openGraph: { title, description, url, siteName: 'Loudentify', type: 'video.other', images: [{ url: show.cover_url || `${base()}/logo/loudentify-on-dark.png`, width: 1200, height: 630 }] },
    twitter: { card: 'summary_large_image', title, description },
    robots: show.visibility === 'unlisted' ? { index: false } : undefined,
  };
}

export default async function SharePage({ params }) {
  const { show, more, error } = await publicShow(params.id);
  if (error) return <SiteShell cta={null}><div className="w-section"><div className="w-error" role="alert" data-testid="share-error"><strong>We could not load this show.</strong><span>Try again in a moment.</span></div></div></SiteShell>;
  if (!show) return <SiteShell cta={null}><div className="w-section"><div className="w-empty" data-testid="share-missing"><strong style={{ fontSize: 22 }}>We could not find that show.</strong><span>The link may be old, or the artist may have taken it down. <a href="/whats-on" className="w-link">See what&rsquo;s on</a>.</span></div></div></SiteShell>;
  const who = whoLabel(show); const url = `${base()}/s/${show.id}`;
  const a = show.artist;
  const badge = show.derived_state === 'live' ? ['LIVE', 'w-badge-live'] : show.derived_state === 'ended' ? ['ENDED', 'w-badge-soon'] : show.derived_state === 'cancelled' ? ['CANCELLED', 'w-badge-soon'] : ['STARTS SOON', 'w-badge-live'];
  return (
    <SiteShell cta={{ href: `/signup?trigger=share&next=/show/${show.id}`, label: 'Sign up free' }}>
      <div className="w-cols" style={{ paddingTop: 16 }} data-testid="share-page" data-state={show.derived_state}>
        <div className="w-main">
          <div className="w-cover">{show.cover_url ? <img src={show.cover_url} alt="" /> : null}<span className={`w-badge ${badge[1]}`}>{badge[0]}</span></div>
          <h1 className="w-h1" style={{ fontSize: 48 }}>{show.title || 'Live show'}</h1>
          <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', fontSize: 18 }}>
            <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}><Calendar size={20} /><LocalTime iso={show.slated_at} mode="full" /></span>
            {show.duration_minutes && <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}><Clock size={20} />{show.duration_minutes} min</span>}
            {show.genre && <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}><Music size={20} />{show.genre}</span>}
            {show.performance_mode === 'versus' && <span className="w-badge w-badge-versus" style={{ alignSelf: 'center' }}>VERSUS</span>}
          </div>
          {show.description && <p className="w-lead">{show.description}</p>}
          <div className="w-card" style={{ flexDirection: 'row', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }} data-testid="artist-card">
            <span className="w-avatar">{a?.avatar_url ? <img src={a.avatar_url} alt="" /> : null}</span>
            <div style={{ flex: 1, minWidth: 200, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <strong style={{ fontSize: 22 }}>{who}</strong>
              <span style={{ opacity: .75 }}>{[a?.genres?.[0] || show.genre, a?.city].filter(Boolean).join(' · ')}</span>
              {a?.bio && <span style={{ fontSize: 17 }}>{a.bio}</span>}
              {a?.username && <a href={`/u/${a.username}`} className="w-pill w-pill-outline" style={{ alignSelf: 'flex-start', marginTop: 6 }}>View profile</a>}
            </div>
          </div>
        </div>
        <aside className="w-aside w-aside-400">
          <Countdown showId={show.id} slatedAt={show.slated_at} state={show.derived_state} />
          <ShareBox url={url} showId={show.id} title={show.title || who} />
          {more?.length > 0 && (
            <div className="w-card"><h2 className="w-h3" style={{ fontSize: 22 }}>More from {a?.display_name || who}</h2>
              {more.map((m) => <a key={m.id} href={`/s/${m.id}`} style={{ display: 'flex', gap: 12, alignItems: 'center' }}><span className="w-rthumb" style={{ width: 76, height: 56, borderRadius: 10, background: 'var(--silk-card)', flexShrink: 0, overflow: 'hidden' }}>{m.cover_url ? <img src={m.cover_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null}</span><span style={{ display: 'flex', flexDirection: 'column' }}><strong>{m.title || 'Live show'}</strong><span style={{ opacity: .72, fontSize: 15 }}>{m.actual_ended_at || m.state === 'ended' ? 'Recording' : 'Upcoming'} · <LocalTime iso={m.slated_at} mode="day" /></span></span></a>)}
            </div>
          )}
        </aside>
      </div>
    </SiteShell>
  );
}
