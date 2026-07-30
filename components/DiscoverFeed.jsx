'use client';

import { useState } from 'react';
import Link from 'next/link';
import { MagnifyingGlass } from '@phosphor-icons/react';
import ImagePlaceholder from './ImagePlaceholder';
import AvatarRing from './AvatarRing';

const INK = '#011627';
const PORCELAIN = '#fdfffc';
const TEAL = '#2ec4b6';
const ORANGE = '#ff9f1c';
const RED = '#e71d36';

// Mock data only -- no discovery/search backend exists yet for this pilot.
const LIVE_SHOWS = [
  { id: 'live-1', format: 'VERSUS', title: 'Neon Meridian vs Solstice Blue', viewers: '2,140' },
  { id: 'live-2', format: 'SOLO', title: 'Afterglow: Kilo Wave', viewers: '860' },
  { id: 'live-3', format: 'VERSUS', title: 'Rhea Cross vs Tempo Nine', viewers: '1,320' },
  { id: 'live-4', format: 'SOLO', title: 'Marlin Grace unplugged', viewers: '410' },
];

const GENRES = ['ALL', 'RAP', 'R&B', 'AFROBEATS', 'GOSPEL', 'POP'];

const ARTISTS = [
  { id: 'art-1', name: 'Neon Meridian', verified: true, stat: '8,420 signal', genre: 'POP' },
  { id: 'art-2', name: 'Kilo Wave', verified: false, stat: '3,110 signal', genre: 'RAP' },
  { id: 'art-3', name: 'Rhea Cross', verified: true, stat: '12,880 signal', genre: 'R&B' },
  { id: 'art-4', name: 'Tempo Nine', verified: false, stat: '1,940 signal', genre: 'AFROBEATS' },
  { id: 'art-5', name: 'Marlin Grace', verified: true, stat: '5,230 signal', genre: 'GOSPEL' },
  { id: 'art-6', name: 'Solstice Blue', verified: true, stat: '9,760 signal', genre: 'POP' },
];

export default function DiscoverFeed() {
  const [activeGenre, setActiveGenre] = useState('ALL');
  const [query, setQuery] = useState('');

  const filteredArtists = ARTISTS.filter((a) => {
    const matchesGenre = activeGenre === 'ALL' || a.genre === activeGenre;
    const matchesQuery = a.name.toLowerCase().includes(query.trim().toLowerCase());
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
            {LIVE_SHOWS.map((show) => (
              <Link
                key={show.id}
                href="/"
                style={{ textDecoration: 'none', display: 'block', position: 'relative', overflow: 'hidden', clipPath: 'polygon(14px 0,100% 0,100% 100%,0 100%,0 14px)', border: '1px solid rgba(1,22,39,0.1)', color: 'inherit' }}
              >
                <div style={{ position: 'relative', height: 130 }}>
                  <ImagePlaceholder label="VIDEO" />
                  <div style={{ position: 'absolute', top: 8, left: 8, display: 'flex', alignItems: 'center', gap: 4, background: 'rgba(253,255,252,0.6)', padding: '3px 7px' }}>
                    <div style={{ width: 5, height: 5, borderRadius: '50%', background: RED, boxShadow: `0 0 6px ${RED}` }} />
                    <span style={{ fontSize: 9, letterSpacing: '0.1em', color: RED }}>LIVE</span>
                  </div>
                  <div style={{ position: 'absolute', top: 8, right: 8, fontSize: 9, letterSpacing: '0.06em', color: INK, background: 'rgba(253,255,252,0.6)', padding: '3px 7px' }}>{show.format}</div>
                </div>
                <div style={{ padding: '10px 12px' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: INK, lineHeight: 1.25 }}>{show.title}</div>
                  <div style={{ fontSize: 9.5, color: 'rgba(1,22,39,0.5)', marginTop: 4 }}>{show.viewers} watching</div>
                </div>
              </Link>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 32, gap: 16, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {GENRES.map((label) => {
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
          {filteredArtists.map((artist) => (
            <Link
              key={artist.id}
              href="/artist"
              style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 14, border: '1px solid rgba(1,22,39,0.1)', clipPath: 'polygon(12px 0,100% 0,100% 100%,0 100%,0 12px)', padding: '12px 14px', color: 'inherit' }}
            >
              <AvatarRing name={artist.name} size={72} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 14.5, fontWeight: 600, color: INK }}>{artist.name}</span>
                  {artist.verified && (
                    <span style={{ fontSize: 8, letterSpacing: '0.06em', color: TEAL, background: 'rgba(46,196,182,0.12)', border: '1px solid rgba(46,196,182,0.5)', padding: '2px 5px' }}>V</span>
                  )}
                </div>
                <div style={{ fontSize: 10, color: 'rgba(1,22,39,0.5)', marginTop: 3 }}>{artist.stat} &middot; {artist.genre}</div>
              </div>
            </Link>
          ))}
          {filteredArtists.length === 0 && (
            <div style={{ fontSize: 13, color: 'rgba(1,22,39,0.4)', padding: '12px 2px' }}>No artists match &ldquo;{query}&rdquo;.</div>
          )}
        </div>

      </div>
    </div>
  );
}
