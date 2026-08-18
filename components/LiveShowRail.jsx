'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { getAdjacentLiveShows, switchToLiveShow } from '../lib/liveShowDiscovery';

// Skeleton-only demo fixture -- lets the rail's visual styling be
// reviewed (?demoRail=1) without a real discovery backend existing yet.
// Deliberately NOT routed through getAdjacentLiveShows -- that stub
// must stay a clean "always empty" contract for the real future
// implementation to replace, unpolluted by this round's test fixture.
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
// This round: skeleton only. getAdjacentLiveShows always resolves to
// an empty list (no API route, no live query), so the rail renders
// nothing by default -- confirmed via ?demoRail=1, which swaps in
// DEMO_SHOWS above purely for visual review.
export default function LiveShowRail() {
  const searchParams = useSearchParams();
  const demoMode = searchParams.get('demoRail') === '1';
  const [shows, setShows] = useState([]);

  useEffect(() => {
    if (demoMode) {
      setShows(DEMO_SHOWS);
      return undefined;
    }
    let cancelled = false;
    getAdjacentLiveShows().then((list) => {
      if (!cancelled) setShows(list);
    });
    return () => {
      cancelled = true;
    };
  }, [demoMode]);

  // Hides cleanly when there's nothing to show -- true unconditionally
  // this round outside of ?demoRail=1.
  if (shows.length === 0) return null;

  return (
    <div className="desktop-side-column desktop-side-column--right live-show-rail">
      <div className="live-show-rail-header">LIVE NOW</div>
      {shows.map((show) => (
        <button
          key={show.id}
          type="button"
          className="live-show-rail-card"
          onClick={() => switchToLiveShow(show.id)}
        >
          <div className="live-show-rail-poster" style={{ background: show.posterColor }}>
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
