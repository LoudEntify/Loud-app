'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft } from '@phosphor-icons/react';
import ImagePlaceholder from './ImagePlaceholder';
import EmptyState from './EmptyState';
import { getSupabase } from '../lib/supabaseClient';

const INK = '#011627';
const PORCELAIN = '#fdfffc';

// Real recordings only. The mock VOD grid that used to live here
// (invented titles, invented view counts, every card linking to the same
// fake video) is gone.
//
// This is a BROWSE surface, so it reads recordings the artist has marked
// public -- the same rows the recordings RLS policy already exposes to
// everyone. Private recordings stay in the artist's own dashboard
// library and never appear here.
//
// View counts are deliberately absent rather than zeroed: we do not
// count views yet, and a column of "0 views" under every show reads as
// failure rather than as "not measured".
export default function RecordedShows() {
  const [recordings, setRecordings] = useState(null); // null = loading

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await getSupabase()
          .from('recordings')
          .select('id, title, recorded_at, show_id')
          .eq('visibility', 'public')
          .order('recorded_at', { ascending: false })
          .limit(60);
        if (cancelled) return;
        setRecordings(error ? [] : (data || []));
      } catch {
        if (!cancelled) setRecordings([]);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div style={{ minHeight: '100vh', width: '100%', boxSizing: 'border-box', background: PORCELAIN, color: INK, padding: '32px 40px 60px' }}>
      <div style={{ maxWidth: 1080, margin: '0 auto' }}>

        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <Link href="/discover" style={{ width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 999, background: 'rgba(1,22,39,0.06)', textDecoration: 'none' }}>
            <ArrowLeft size={15} color={INK} />
          </Link>
          <div style={{ fontSize: 21, fontWeight: 700, color: INK }}>Recorded Shows</div>
        </div>

        {recordings === null && (
          <div style={{ fontSize: 12, color: 'rgba(1,22,39,0.4)', marginTop: 22 }}>Loading…</div>
        )}

        {recordings !== null && recordings.length === 0 && (
          <div style={{ marginTop: 22 }}>
            <EmptyState
              title="No public recordings yet"
              body="When an artist makes a recording public, it shows up here."
              action="FIND ARTISTS"
              actionHref="/discover"
            />
          </div>
        )}

        {recordings !== null && recordings.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14, marginTop: 22 }}>
            {recordings.map((show) => (
              <Link
                key={show.id}
                href={`/vod?recording=${show.id}`}
                style={{ textDecoration: 'none', display: 'block', border: '1px solid rgba(1,22,39,0.1)', clipPath: 'polygon(14px 0,100% 0,100% 100%,0 100%,0 14px)', overflow: 'hidden', color: 'inherit' }}
              >
                <div style={{ position: 'relative', height: 150 }}>
                  <ImagePlaceholder label="VOD" />
                </div>
                <div style={{ padding: '12px 14px' }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: INK, lineHeight: 1.3 }}>{show.title}</div>
                  <div style={{ fontSize: 9.5, color: 'rgba(1,22,39,0.5)', marginTop: 6 }}>
                    {new Date(show.recorded_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}

      </div>
    </div>
  );
}
