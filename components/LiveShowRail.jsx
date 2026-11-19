'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { getAdjacentLiveShows, switchToLiveShow } from '../lib/liveShowDiscovery';

// Optional visual fixture retained for design review with ?demoRail=1.
const DEMO_SHOWS = [
  { id: 'demo-1', artistName: 'Nova Ridge', showTitle: 'Rooftop Session', posterColor: '#2ec4b6' },
  { id: 'demo-2', artistName: 'Kai Solene', showTitle: 'Late Night Acoustic', posterColor: '#e71d36' },
  { id: 'demo-3', artistName: 'The Drift', showTitle: 'Warehouse Set', posterColor: '#ff9f1c' },
];

// Live show discovery rail -- "channel surfing" between other
// currently-live shows, desktop surface. This feature has TWO planned
// surfaces sharing one data source and one switch action
// (lib/liveShowDiscovery.js):
//   - Desktop (this component): a visible card rail docked in the
//     right-hand blur-fill gutter, reusing .desktop-side-column's
//     existing positioning (the same column BroadcastStage's
//     VideoDeckPanel occupies on the artist path -- viewer never has
//     that column's content competing for the space).
//   - Mobile (NOT built this round): no rail at all -- a swipe-left/
//     right gesture anywhere on the viewing screen flips directly to
//     the previous/next live show, TikTok-style. When that lands, it
//     should call the SAME getAdjacentLiveShows()/switchToLiveShow()
//     this component calls, not a parallel implementation -- that's
//     why the data source and switch action live in lib/, not inline
//     here, and why this component does nothing more than list-render
//     + call the stub on click.
// The rail refreshes live lifecycle rows in place. Room switching uses
// Next navigation so unmounting the existing LiveKitRoom performs the
// normal leave before the target stage mounts.
export default function LiveShowRail({ currentShowId, discoveredShows = null }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const demoMode = searchParams.get('demoRail') === '1';
  const [shows, setShows] = useState([]);

  useEffect(() => {
    if (demoMode) {
      setShows(DEMO_SHOWS);
      return undefined;
    }
    if (Array.isArray(discoveredShows)) {
      setShows(discoveredShows);
      return undefined;
    }
    let cancelled = false;
    const load = () => getAdjacentLiveShows(currentShowId).then((list) => {
      if (!cancelled) setShows(list);
    });
    load();
    const refresh = setInterval(load, 15000);
    return () => {
      cancelled = true;
      clearInterval(refresh);
    };
  }, [currentShowId, demoMode, discoveredShows]);

  // Hides cleanly when this is the only active show.
  if (shows.length === 0) return null;

  return (
    <div className="desktop-side-column desktop-side-column--right live-show-rail">
      <div className="live-show-rail-header">LIVE NOW</div>
      {shows.map((show) => (
        <button
          key={show.id}
          type="button"
          className="live-show-rail-card"
          onClick={() => switchToLiveShow(show.id, (href) => router.push(href))}
          aria-label={`Watch ${show.showTitle} by ${show.artistName}`}
        >
          <div className="live-show-rail-poster" style={{ backgroundColor: show.posterColor, ...(show.avatarUrl ? { backgroundImage: `url(${JSON.stringify(show.avatarUrl)})`, backgroundPosition: 'center', backgroundSize: 'cover' } : {}) }}>
            <span className="live-show-rail-badge">LIVE</span>
          </div>
          <div className="live-show-rail-info">
            <span className="live-show-rail-artist">{show.artistName}</span>
            <span className="live-show-rail-title">{show.showTitle}</span>
          </div>
        </button>
      ))}
    </div>
  );
}
