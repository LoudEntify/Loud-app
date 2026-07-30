'use client';

import Link from 'next/link';
import { ArrowLeft } from '@phosphor-icons/react';
import ImagePlaceholder from './ImagePlaceholder';

const INK = '#011627';
const PORCELAIN = '#fdfffc';

// Mock data only -- every card links to the same single mock VOD, since
// there's no per-video routing/storage yet, matching the /artist and
// /vod single-instance pattern used elsewhere in this pilot.
const SHOWS = [
  { id: 'vod-1', title: 'Neon Meridian vs Kilo Wave', date: 'Jul 12', format: 'VERSUS', views: '18.2K', duration: '48:10' },
  { id: 'vod-2', title: 'Afterglow — full set', date: 'Jul 3', format: 'SOLO', views: '9,410', duration: '61:22' },
  { id: 'vod-3', title: 'Neon Meridian vs Solstice Blue', date: 'Jun 21', format: 'VERSUS', views: '24.6K', duration: '52:03' },
  { id: 'vod-4', title: 'Late Night Acoustic', date: 'Jun 9', format: 'SOLO', views: '4,120', duration: '33:45' },
  { id: 'vod-5', title: 'Neon Meridian vs Tempo Nine', date: 'May 30', format: 'VERSUS', views: '15.8K', duration: '44:57' },
  { id: 'vod-6', title: 'Sunrise Session', date: 'May 18', format: 'SOLO', views: '2,980', duration: '28:14' },
];

export default function RecordedShows() {
  return (
    <div style={{ minHeight: '100vh', width: '100%', boxSizing: 'border-box', background: PORCELAIN, color: INK, padding: '32px 40px 60px' }}>
      <div style={{ maxWidth: 1080, margin: '0 auto' }}>

        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <Link href="/artist" style={{ width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 999, background: 'rgba(1,22,39,0.06)', textDecoration: 'none' }}>
            <ArrowLeft size={15} color={INK} />
          </Link>
          <div style={{ fontSize: 21, fontWeight: 700, color: INK }}>Recorded Shows</div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginTop: 22 }}>
          {SHOWS.map((show) => (
            <Link
              key={show.id}
              href="/vod"
              style={{ textDecoration: 'none', display: 'block', border: '1px solid rgba(1,22,39,0.1)', clipPath: 'polygon(14px 0,100% 0,100% 100%,0 100%,0 14px)', overflow: 'hidden', color: 'inherit' }}
            >
              <div style={{ position: 'relative', height: 150 }}>
                <ImagePlaceholder label="VOD" />
                <div style={{ position: 'absolute', bottom: 6, right: 6, fontSize: 9, color: INK, background: 'rgba(253,255,252,0.7)', padding: '2px 6px' }}>{show.duration}</div>
              </div>
              <div style={{ padding: '12px 14px' }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: INK, lineHeight: 1.3 }}>{show.title}</div>
                <div style={{ fontSize: 9.5, color: 'rgba(1,22,39,0.5)', marginTop: 6 }}>{show.date} &middot; {show.format}</div>
                <div style={{ fontSize: 9.5, color: 'rgba(1,22,39,0.4)', marginTop: 3 }}>{show.views} views</div>
              </div>
            </Link>
          ))}
        </div>

      </div>
    </div>
  );
}
