// Server-safe show cards for the website: the live strip card and the
// schedule row (design/WebHome, WebLiveUpcoming). Links go to the share
// page /s/[id]; a live card goes straight to the show screen.
import LocalTime from './LocalTime';
import RemindButton from './RemindButton';
import { whoLabel } from '../../lib/site/publicShows';

export function minutesUntil(iso, now = Date.now()) { return Math.max(0, Math.round((Date.parse(iso) - now) / 60000)); }

export function LiveCard({ show }) {
  const live = show.derived_state === 'live';
  const href = live ? `/show/${show.id}` : `/s/${show.id}`;
  return (
    <a href={href} className="w-showcard" data-testid="live-card" data-state={show.derived_state}>
      <div className="w-thumb">
        {show.cover_url ? <img src={show.cover_url} alt="" /> : null}
        <span className={`w-badge ${live ? 'w-badge-live' : 'w-badge-soon'}`}>{live ? 'LIVE' : 'SOON'}</span>
        {show.performance_mode === 'versus' && <span className="w-badge w-badge-versus w-badge-right">VERSUS</span>}
        {live && typeof show.viewers === 'number' && <span className="w-watching">{show.viewers} watching</span>}
      </div>
      <span className="w-title">{whoLabel(show)}</span>
      <span className="w-sub">{live ? `${show.title || 'Live show'}${show.genre ? ` · ${show.genre}` : ''}` : `Starts in ${minutesUntil(show.slated_at)} min`}</span>
    </a>
  );
}

export function ScheduleRow({ show }) {
  return (
    <div className="w-row" data-testid="schedule-row">
      <span className="w-time"><LocalTime iso={show.slated_at} /></span>
      <span className="w-rthumb" aria-hidden="true">{show.cover_url ? <img src={show.cover_url} alt="" /> : null}</span>
      <span className="w-rbody">
        <a href={`/s/${show.id}`} className="w-rtitle">{show.title || 'Live show'}</a>
        <span className="w-rmeta">{whoLabel(show)}{show.performance_mode === 'versus' ? ' · Versus' : ''}{show.genre ? ` · ${show.genre}` : ''}{show.duration_minutes ? ` · ${show.duration_minutes} min` : ''}</span>
      </span>
      {show.derived_state === 'live' ? <a href={`/show/${show.id}`} className="w-pill w-pill-teal">Watch now</a> : <RemindButton showId={show.id} />}
    </div>
  );
}
