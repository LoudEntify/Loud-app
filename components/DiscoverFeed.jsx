'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { MagnifyingGlass } from '@phosphor-icons/react';
import ImagePlaceholder from './ImagePlaceholder';
import AvatarRing from './AvatarRing';
import EmptyState from './EmptyState';
import { getSupabase } from '../lib/supabaseClient';

const INK = '#011627';
const PORCELAIN = '#fdfffc';
const TEAL = '#2ec4b6';
const ORANGE = '#ff9f1c';
const RED = '#e71d36';

// Real data only. Six invented artists with invented "signal" counts and
// four invented live shows used to live here.
//
// Artists come from `profiles` where role='artist' -- the public-artist
// read policy already exposes exactly those rows. Live shows come from
// `shows`; a row is live when its state is 'soundcheck' and slated_at
// has passed, which is the same derivation lib/showState.js uses (it is
// duplicated as a query filter here rather than imported because this is
// a database filter, not a client-side state machine).
//
// Genre filter chips are built from the genres actually present on real
// artist rows, so the filter can never offer a genre nobody performs.
// Follower/"signal" counts are absent, not zeroed -- nothing counts them
// yet, and a wall of "0 signal" reads as a dead platform rather than as
// an unmeasured one.

export default function DiscoverFeed() {
  const [activeGenre, setActiveGenre] = useState('ALL');
  const [query, setQuery] = useState('');
  const [artists, setArtists] = useState(null);
  const [liveShows, setLiveShows] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = getSupabase();
      try {
        const [{ data: artistRows }, { data: showRows }] = await Promise.all([
          supabase.from('profiles').select('id, display_name, username, genres, avatar_url').eq('role', 'artist').limit(120),
          // select('*') deliberately: title/performance_mode arrive with the
          // scheduling migration, and naming them before it runs would 400
          // the whole query. Read defensively below instead.
          supabase.from('shows').select('*').eq('state', 'soundcheck').limit(20),
        ]);
        if (cancelled) return;
        setArtists(artistRows || []);
        const now = Date.now();
        setLiveShows((showRows || []).filter((sh) => new Date(sh.slated_at).getTime() <= now));
      } catch {
        if (!cancelled) { setArtists([]); setLiveShows([]); }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const genreChips = ['ALL', ...Array.from(new Set((artists || []).flatMap((a) => a.genres || []))).sort()];

  const filteredArtists = (artists || []).filter((a) => {
    const name = a.display_name || a.username || '';
    const matchesGenre = activeGenre === 'ALL' || (a.genres || []).includes(activeGenre);
    const matchesQuery = name.toLowerCase().includes(query.trim().toLowerCase());
    return matchesGenre && matchesQuery;
  });

  return (
    <div style={{ minHeight: '100vh', width: '100%', boxSizing: 'border-box', background: PORCELAIN, color: INK, padding: '32px 40px 60px' }}>
      <div style={{ maxWidth: 1160, margin: '0 auto' }}>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 24, fontWeight: 700, color: INK, letterSpacing: '-0.01em' }}>Discover</div>
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

        <div style={{ marginTop: 28 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: RED, boxShadow: `0 0 8px ${RED}`, animation: 'glowPulse 1.4s ease-in-out infinite' }} />
            <span style={{ fontSize: 11, letterSpacing: '0.12em', color: INK }}>LIVE NOW</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginTop: 14 }}>
            {(liveShows || []).map((show) => (
              <Link
                key={show.id}
                href="/live"
                style={{ textDecoration: 'none', display: 'block', position: 'relative', overflow: 'hidden', clipPath: 'polygon(14px 0,100% 0,100% 100%,0 100%,0 14px)', border: '1px solid rgba(1,22,39,0.1)', color: 'inherit' }}
              >
                <div style={{ position: 'relative', height: 130 }}>
                  <ImagePlaceholder label="VIDEO" />
                  <div style={{ position: 'absolute', top: 8, left: 8, display: 'flex', alignItems: 'center', gap: 4, background: 'rgba(253,255,252,0.6)', padding: '3px 7px' }}>
                    <div style={{ width: 5, height: 5, borderRadius: '50%', background: RED, boxShadow: `0 0 6px ${RED}` }} />
                    <span style={{ fontSize: 9, letterSpacing: '0.1em', color: RED }}>LIVE</span>
                  </div>
                  <div style={{ position: 'absolute', top: 8, right: 8, fontSize: 9, letterSpacing: '0.06em', color: INK, background: 'rgba(253,255,252,0.6)', padding: '3px 7px' }}>
                    {show.performance_mode === 'versus' ? 'VERSUS' : 'SOLO'}
                  </div>
                </div>
                <div style={{ padding: '10px 12px' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: INK, lineHeight: 1.25 }}>{show.title || 'Live show'}</div>
                </div>
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
                    boxShadow: active ? '0 0 10px rgba(46,196,182,0.3)' : 'none',
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <Link
            href="/competitions"
            style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none', background: 'rgba(255,159,28,0.12)', boxShadow: '0 0 12px rgba(255,159,28,0.15)', borderRadius: 999, padding: '11px 18px', flexShrink: 0 }}
          >
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: ORANGE }}>OPEN COMPETITIONS</span>
            <div style={{ width: 6, height: 6, borderTop: `2px solid ${ORANGE}`, borderRight: `2px solid ${ORANGE}`, transform: 'rotate(45deg)' }} />
          </Link>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginTop: 22 }}>
          {filteredArtists.map((artist) => {
            const name = artist.display_name || artist.username || 'Artist';
            return (
              <Link
                key={artist.id}
                href={`/artist/${artist.id}`}
                style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 14, border: '1px solid rgba(1,22,39,0.1)', clipPath: 'polygon(12px 0,100% 0,100% 100%,0 100%,0 12px)', padding: '12px 14px', color: 'inherit' }}
              >
                <AvatarRing name={name} size={72} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 600, color: INK }}>{name}</div>
                  {artist.username && (
                    <div style={{ fontSize: 10, color: 'rgba(1,22,39,0.5)', marginTop: 3 }}>@{artist.username}</div>
                  )}
                  {(artist.genres || []).length > 0 && (
                    <div style={{ fontSize: 10, color: 'rgba(1,22,39,0.4)', marginTop: 2 }}>{(artist.genres || []).join(' · ')}</div>
                  )}
                </div>
              </Link>
            );
          })}
          {artists !== null && filteredArtists.length === 0 && (
            <div style={{ gridColumn: '1 / -1' }}>
              <EmptyState
                compact
                title={query ? `No artists match “${query}”` : 'No artists yet'}
                body={query ? 'Try a different search.' : 'Artist accounts appear here as they sign up.'}
              />
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
