'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { MagnifyingGlass } from '@phosphor-icons/react';
import AvatarRing from './AvatarRing';
import ImagePlaceholder from './ImagePlaceholder';
import EmptyState from './EmptyState';
import {
  fetchLiveShows,
  fetchArtistsPage,
  fetchGenreFacets,
  shouldUseGrid,
} from '../lib/discoveryFeed';

const INK = '#011627';
const PORCELAIN = '#fdfffc';
const TEAL = '#2ec4b6';
const RED = '#e71d36';
const ORANGE = '#ff9f1c';

// Discovery. LIST is the default layout, for both live shows and artists.
//
// The reasoning, since it inverts the obvious choice: a short list reads
// as a LINE-UP -- four names stacked look deliberate. Four cards in a
// three-column grid read as a grid that failed to fill, which makes a
// young platform look abandoned. So: list until there is genuinely
// enough to warrant a wall, then flip (lib/discoveryFeed.js).
//
// Infinite scroll rather than pagination -- page numbers imply a
// catalogue you navigate, this is a feed you browse. It is also what the
// mobile swipe surface will need, and both consume the same paged source
// rather than each implementing their own.
export default function DiscoverFeed() {
  const [activeGenre, setActiveGenre] = useState('ALL');
  const [query, setQuery] = useState('');
  const [liveShows, setLiveShows] = useState(null);
  const [artists, setArtists] = useState([]);
  const [nextPage, setNextPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [genreChips, setGenreChips] = useState(['ALL']);
  const [viewportWidth, setViewportWidth] = useState(
    typeof window === 'undefined' ? 1200 : window.innerWidth
  );
  const sentinelRef = useRef(null);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    fetchLiveShows().then(setLiveShows);
    fetchGenreFacets().then((g) => setGenreChips(['ALL', ...g]));
  }, []);

  // Reset AND refetch whenever filters change -- without the reset the
  // new results would append underneath the old ones.
  useEffect(() => {
    let cancelled = false;
    setArtists([]);
    setNextPage(0);
    setLoading(true);
    fetchArtistsPage({ page: 0, query, genre: activeGenre }).then((res) => {
      if (cancelled) return;
      setArtists(res.items);
      setNextPage(res.nextPage);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [query, activeGenre]);

  const loadMore = useCallback(async () => {
    if (loading || nextPage === null) return;
    setLoading(true);
    const res = await fetchArtistsPage({ page: nextPage, query, genre: activeGenre });
    setArtists((prev) => [...prev, ...res.items]);
    setNextPage(res.nextPage);
    setLoading(false);
  }, [loading, nextPage, query, activeGenre]);

  // IntersectionObserver, not a scroll listener: it fires only when the
  // sentinel nears the viewport and costs nothing while reading.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || nextPage === null) return undefined;
    const io = new IntersectionObserver(
      (entries) => { if (entries[0]?.isIntersecting) loadMore(); },
      { rootMargin: '400px' } // fetch before they reach the bottom
    );
    io.observe(el);
    return () => io.disconnect();
  }, [loadMore, nextPage]);

  const useGrid = shouldUseGrid(artists.length, viewportWidth);

  return (
    <div style={{ minHeight: '100vh', width: '100%', boxSizing: 'border-box', background: PORCELAIN, color: INK, padding: '32px 40px 60px' }}>
      <div style={{ maxWidth: 1160, margin: '0 auto' }}>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.01em' }}>Discover</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: 340, maxWidth: '100%', border: '1px solid rgba(1,22,39,0.15)', clipPath: 'polygon(10px 0,100% 0,100% 100%,0 100%,0 10px)', padding: '11px 14px', boxSizing: 'border-box' }}>
            <MagnifyingGlass size={15} color="rgba(1,22,39,0.5)" style={{ flexShrink: 0 }} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search artists..."
              style={{ flex: 1, border: 'none', background: 'transparent', outline: 'none', fontSize: 13.5, color: INK, fontFamily: 'inherit' }}
            />
          </div>
        </div>

        {/* Live now -- always a list. "Who is on right now" is a bounded
            set by nature, and a line-up is what it should look like. */}
        <div style={{ marginTop: 28 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: RED, boxShadow: `0 0 8px ${RED}`, animation: 'glowPulse 1.4s ease-in-out infinite' }} />
            <span style={{ fontSize: 11, letterSpacing: '0.12em' }}>LIVE NOW</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
            {(liveShows || []).map((item) => (
              <Link
                key={item.id}
                href={item.href}
                style={{ display: 'flex', alignItems: 'center', gap: 14, textDecoration: 'none', color: 'inherit', border: '1px solid rgba(1,22,39,0.1)', clipPath: 'polygon(10px 0,100% 0,100% 100%,0 100%,0 10px)', padding: '10px 12px' }}
              >
                <div style={{ width: 74, height: 44, flexShrink: 0, position: 'relative', overflow: 'hidden' }}>
                  <ImagePlaceholder label="LIVE" />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</div>
                  <div style={{ fontSize: 9.5, color: 'rgba(1,22,39,0.5)', marginTop: 3 }}>{item.subtitle}</div>
                </div>
                <span style={{ fontSize: 9, letterSpacing: '0.1em', color: RED, border: '1px solid rgba(231,29,54,0.4)', borderRadius: 999, padding: '3px 9px', flexShrink: 0 }}>LIVE</span>
              </Link>
            ))}
          </div>

          {liveShows !== null && liveShows.length === 0 && (
            <div style={{ marginTop: 14 }}>
              <EmptyState compact title="Nobody is live right now" body="Scheduled shows appear here the moment they start." />
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 32, gap: 16, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {genreChips.map((label) => {
              const active = label === activeGenre;
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => setActiveGenre(label)}
                  style={{
                    fontSize: 10.5,
                    letterSpacing: '0.08em',
                    padding: '9px 16px',
                    background: active ? 'rgba(46,196,182,0.12)' : 'transparent',
                    color: active ? TEAL : 'rgba(1,22,39,0.6)',
                    border: active ? '1px solid rgba(46,196,182,0.6)' : '1px solid rgba(1,22,39,0.15)',
                    cursor: 'pointer',
                  }}
                >
                  {String(label).toUpperCase()}
                </button>
              );
            })}
          </div>
          <Link
            href="/competitions"
            style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none', background: 'rgba(255,159,28,0.12)', borderRadius: 999, padding: '11px 18px', flexShrink: 0 }}
          >
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: ORANGE }}>OPEN COMPETITIONS</span>
          </Link>
        </div>

        <div
          style={useGrid
            ? { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12, marginTop: 22 }
            : { display: 'flex', flexDirection: 'column', gap: 8, marginTop: 22 }}
        >
          {artists.map((item) => (
            <Link
              key={item.id}
              href={item.href}
              style={{
                textDecoration: 'none',
                color: 'inherit',
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                border: '1px solid rgba(1,22,39,0.1)',
                clipPath: 'polygon(12px 0,100% 0,100% 100%,0 100%,0 12px)',
                padding: useGrid ? '14px 12px' : '10px 14px',
                flexDirection: useGrid ? 'column' : 'row',
                textAlign: useGrid ? 'center' : 'left',
              }}
            >
              <AvatarRing name={item.title} size={useGrid ? 72 : 52} />
              <div style={{ flex: 1, minWidth: 0, width: '100%' }}>
                <div style={{ fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</div>
                {item.subtitle && (
                  <div style={{ fontSize: 10, color: 'rgba(1,22,39,0.5)', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.subtitle}</div>
                )}
              </div>
            </Link>
          ))}
        </div>

        {!loading && artists.length === 0 && (
          <div style={{ marginTop: 16 }}>
            <EmptyState
              compact
              title={query ? `No artists match “${query}”` : 'No artists yet'}
              body={query ? 'Try a different search.' : 'Artist accounts appear here as they sign up.'}
            />
          </div>
        )}

        {/* Sentinel is rendered only while more remains, so the observer
            detaches itself naturally at the end of the feed. */}
        {nextPage !== null && (
          <div ref={sentinelRef} style={{ height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 16 }}>
            <span style={{ fontSize: 10.5, color: 'rgba(1,22,39,0.35)', letterSpacing: '0.08em' }}>
              {loading ? 'LOADING…' : ''}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
