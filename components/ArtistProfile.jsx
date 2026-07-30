'use client';

import { useState } from 'react';
import Link from 'next/link';
import { EnvelopeSimple, Play } from '@phosphor-icons/react';
import ImagePlaceholder from './ImagePlaceholder';
import AvatarRing from './AvatarRing';

const INK = '#011627';
const PORCELAIN = '#fdfffc';
const TEAL = '#2ec4b6';
const ORANGE = '#ff9f1c';
const RED = '#e71d36';

// Mock data only -- single hardcoded artist (Neon Meridian), no artist
// directory/routing exists yet. Every "view artist" link in the app points
// here for now.
const ENGAGEMENT_HEIGHTS = [40, 55, 30, 70, 45, 90, 60, 35, 80, 50, 65, 95, 42, 58, 72, 38, 88, 48, 62, 30, 75, 55, 40, 68, 52, 85, 44, 60];
const ENGAGEMENT_BARS = ENGAGEMENT_HEIGHTS.map((h, i) => {
  const lit = i < 20;
  return {
    height: h,
    color: lit ? (i % 3 === 0 ? TEAL : i % 3 === 1 ? 'linear-gradient(180deg,#2ec4b6,#ff9f1c)' : ORANGE) : 'rgba(1,22,39,0.1)',
    glow: lit ? '0 0 6px rgba(46,196,182,0.4)' : 'none',
  };
});

const EXTERNAL_LINKS = ['SPOTIFY', 'INSTAGRAM', 'YOUTUBE', 'X'];
const GENRES = ['SYNTHWAVE', 'CLUB', 'ELECTRO-POP', 'LIVE REMIX'];
const CLIPS = [
  { id: 'clip-1', duration: '0:42' },
  { id: 'clip-2', duration: '1:05' },
  { id: 'clip-3', duration: '0:38' },
  { id: 'clip-4', duration: '2:14' },
  { id: 'clip-5', duration: '0:51' },
  { id: 'clip-6', duration: '1:12' },
];
const SHOWS = [
  { month: 'AUG', day: '02', title: 'Neon Meridian vs Kilo Wave', time: '9:00 PM ET' },
  { month: 'AUG', day: '09', title: 'Solo Session: Afterglow', time: '8:00 PM ET' },
  { month: 'AUG', day: '16', title: 'Neon Meridian vs Solstice Blue', time: '9:30 PM ET' },
];

const TABS = [
  { key: 'clips', label: 'CLIPS' },
  { key: 'about', label: 'ABOUT' },
  { key: 'shows', label: 'SHOWS' },
];

export default function ArtistProfile() {
  const [activeTab, setActiveTab] = useState('clips');
  const [following, setFollowing] = useState(false);

  const tabIndex = TABS.findIndex((t) => t.key === activeTab);

  return (
    <div style={{ minHeight: '100vh', width: '100%', boxSizing: 'border-box', background: PORCELAIN, color: INK, padding: '40px 48px 80px' }}>
      <div style={{ display: 'flex', gap: 48, maxWidth: 1160, margin: '0 auto', alignItems: 'flex-start', flexWrap: 'wrap' }}>

        {/* LEFT COLUMN */}
        <div style={{ width: 360, flexShrink: 0, position: 'sticky', top: 40 }}>
          <div style={{ position: 'relative', height: 190, clipPath: 'polygon(0 0,100% 0,100% 100%,24px 100%,0 calc(100% - 24px))' }}>
            <ImagePlaceholder label="Cover photo" />
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(253,255,252,0) 40%, rgba(253,255,252,0.95) 100%)', pointerEvents: 'none' }} />
          </div>
          <div style={{ position: 'relative', padding: '0 4px' }}>
            <div style={{ position: 'absolute', top: -52, left: 6 }}>
              <AvatarRing name="Neon Meridian" size={106} />
            </div>
          </div>

          <div style={{ padding: '64px 4px 0' }}>
            <div style={{ fontSize: 25, fontWeight: 700, color: INK, letterSpacing: '-0.01em', lineHeight: 1.1 }}>Neon Meridian</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, color: TEAL }}>@neonmeridian</span>
              <span style={{ fontSize: 9, letterSpacing: '0.08em', color: TEAL, background: 'rgba(46,196,182,0.12)', border: '1px solid rgba(46,196,182,0.5)', boxShadow: '0 0 10px rgba(46,196,182,0.35)', padding: '3px 8px' }}>VERIFIED</span>
            </div>

            <div style={{ marginTop: 22 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 9.5, letterSpacing: '0.1em', color: 'rgba(1,22,39,0.55)' }}>SIGNAL</span>
                <span style={{ fontSize: 14, fontWeight: 600, color: INK }}>8,420</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 30, marginTop: 8 }}>
                {ENGAGEMENT_BARS.map((bar, i) => (
                  <div key={i} style={{ flex: 1, height: `${bar.height}%`, background: bar.color, boxShadow: bar.glow }} />
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
              <div style={{ flex: 1, border: '1px solid rgba(1,22,39,0.12)', clipPath: 'polygon(8px 0,100% 0,100% 100%,0 100%,0 8px)', padding: '9px 10px' }}>
                <div style={{ fontSize: 8.5, letterSpacing: '0.06em', color: 'rgba(1,22,39,0.5)' }}>FOLLOWERS</div>
                <div style={{ fontSize: 15, fontWeight: 600, color: INK, marginTop: 2 }}>84.2K</div>
              </div>
              <div style={{ flex: 1, border: '1px solid rgba(1,22,39,0.12)', clipPath: 'polygon(0 0,100% 0,100% 100%,calc(100% - 8px) 100%,0 100%)', padding: '9px 10px' }}>
                <div style={{ fontSize: 8.5, letterSpacing: '0.06em', color: 'rgba(1,22,39,0.5)' }}>SHOWS</div>
                <div style={{ fontSize: 15, fontWeight: 600, color: INK, marginTop: 2 }}>126</div>
              </div>
              <div style={{ flex: 1, border: '1px solid rgba(1,22,39,0.12)', clipPath: 'polygon(0 0,100% 0,100% calc(100% - 8px),calc(100% - 8px) 100%,0 100%)', padding: '9px 10px' }}>
                <div style={{ fontSize: 8.5, letterSpacing: '0.06em', color: 'rgba(1,22,39,0.5)' }}>TOKENS</div>
                <div style={{ fontSize: 15, fontWeight: 600, color: INK, marginTop: 2 }}>312K</div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button
                type="button"
                onClick={() => setFollowing((f) => !f)}
                style={{
                  flex: 1,
                  textAlign: 'center',
                  padding: '12px 0',
                  fontSize: 11,
                  letterSpacing: '0.1em',
                  fontWeight: 700,
                  background: following ? 'rgba(46,196,182,0.12)' : INK,
                  color: following ? TEAL : PORCELAIN,
                  border: following ? '1px solid rgba(46,196,182,0.6)' : '1px solid transparent',
                  boxShadow: following ? '0 0 14px rgba(46,196,182,0.3)' : 'none',
                }}
              >
                {following ? 'FOLLOWING' : 'FOLLOW'}
              </button>
              <Link href="/messages" style={{ width: 46, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 999, background: 'rgba(1,22,39,0.06)', textDecoration: 'none' }}>
                <EnvelopeSimple size={16} color={INK} />
              </Link>
              <div style={{ width: 46, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 999, background: 'rgba(255,159,28,0.12)', boxShadow: '0 0 14px rgba(255,159,28,0.3)', cursor: 'pointer' }}>
                <div style={{ width: 15, height: 15, background: ORANGE, clipPath: 'polygon(50% 0,100% 25%,100% 75%,50% 100%,0 75%,0 25%)' }} />
              </div>
            </div>

            <div style={{ display: 'flex', gap: 6, marginTop: 14, flexWrap: 'wrap' }}>
              {EXTERNAL_LINKS.map((label) => (
                <span key={label} style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.06em', color: 'rgba(1,22,39,0.7)', background: 'rgba(1,22,39,0.06)', borderRadius: 999, padding: '7px 12px' }}>{label}</span>
              ))}
            </div>

            <div style={{ marginTop: 20, position: 'relative', padding: 14, background: 'linear-gradient(135deg, rgba(231,29,54,0.14), rgba(255,159,28,0.08))', border: '1px solid rgba(231,29,54,0.4)', boxShadow: '0 0 24px rgba(231,29,54,0.2)', clipPath: 'polygon(16px 0,100% 0,100% calc(100% - 16px),calc(100% - 16px) 100%,0 100%,0 16px)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: RED, boxShadow: `0 0 8px ${RED}`, animation: 'glowPulse 1.4s ease-in-out infinite' }} />
                <span style={{ fontSize: 9.5, letterSpacing: '0.1em', color: RED }}>LIVE &middot; VERSUS</span>
              </div>
              <div style={{ fontSize: 13, fontWeight: 600, color: INK, marginTop: 8 }}>vs Solstice Blue</div>
              <Link href="/" style={{ marginTop: 10, display: 'block', textAlign: 'center', padding: '10px 0', textDecoration: 'none', fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: INK, background: 'linear-gradient(90deg,#2ec4b6,#ff9f1c)', borderRadius: 999 }}>JOIN SHOW</Link>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN */}
        <div style={{ flex: 1, minWidth: 280, maxWidth: 700, paddingTop: 6 }}>
          <div style={{ position: 'relative' }}>
            <div style={{ display: 'flex', gap: 32 }}>
              {TABS.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveTab(tab.key)}
                  style={{ background: 'none', paddingBottom: 12, fontSize: 12, letterSpacing: '0.1em', color: tab.key === activeTab ? INK : 'rgba(1,22,39,0.4)' }}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <div style={{ height: 1, background: 'rgba(1,22,39,0.1)' }} />
            <div style={{ position: 'absolute', bottom: -1, left: 0, width: 88, height: 2, background: TEAL, boxShadow: '0 0 10px rgba(46,196,182,0.7)', transform: `translateX(${tabIndex * 120}px)`, transition: 'transform 0.25s ease' }} />
          </div>

          {activeTab === 'clips' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginTop: 22 }}>
              {CLIPS.map((clip) => (
                <div key={clip.id} style={{ position: 'relative', height: 150, clipPath: 'polygon(12px 0,100% 0,100% 100%,0 100%,0 12px)', overflow: 'hidden', cursor: 'pointer' }}>
                  <ImagePlaceholder label="Clip" />
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                    <Play size={20} weight="fill" color="rgba(253,255,252,0.85)" />
                  </div>
                  <div style={{ position: 'absolute', bottom: 6, right: 6, fontSize: 9, color: PORCELAIN, background: 'rgba(1,22,39,0.7)', padding: '2px 6px' }}>{clip.duration}</div>
                </div>
              ))}
            </div>
          )}

          {activeTab === 'about' && (
            <div style={{ padding: '22px 0', maxWidth: 600 }}>
              <p style={{ fontSize: 14.5, lineHeight: 1.65, color: 'rgba(1,22,39,0.8)', margin: 0 }}>
                Producer and vocalist working at the edge of synthwave and club music. Known for high-voltage versus sets and unpredictable live remixing — every show is built and torn down in real time with the crowd.
              </p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
                {GENRES.map((genre) => (
                  <span key={genre} style={{ fontSize: 10.5, letterSpacing: '0.06em', color: 'rgba(1,22,39,0.7)', border: '1px solid rgba(1,22,39,0.15)', clipPath: 'polygon(6px 0,100% 0,100% 100%,calc(100% - 6px) 100%,0 100%,0 6px)', padding: '7px 11px' }}>{genre}</span>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'shows' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '22px 0', maxWidth: 600 }}>
              {SHOWS.map((show) => (
                <div key={show.title} style={{ display: 'flex', alignItems: 'center', gap: 14, border: '1px solid rgba(1,22,39,0.1)', clipPath: 'polygon(10px 0,100% 0,100% 100%,0 100%,0 10px)', padding: '12px 14px' }}>
                  <div style={{ textAlign: 'center', flexShrink: 0 }}>
                    <div style={{ fontSize: 9, letterSpacing: '0.1em', color: 'rgba(1,22,39,0.5)' }}>{show.month}</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: INK }}>{show.day}</div>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: INK }}>{show.title}</div>
                    <div style={{ fontSize: 10, color: 'rgba(1,22,39,0.5)', marginTop: 2 }}>{show.time}</div>
                  </div>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: TEAL, background: 'rgba(46,196,182,0.12)', padding: '6px 12px', borderRadius: 999, cursor: 'pointer' }}>REMIND</div>
                </div>
              ))}
              <Link href="/shows" style={{ textDecoration: 'none', textAlign: 'center', marginTop: 6, padding: '12px 0', background: 'rgba(1,22,39,0.06)', borderRadius: 999 }}>
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: 'rgba(1,22,39,0.7)' }}>VIEW RECORDED SHOWS</span>
              </Link>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
