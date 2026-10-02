'use client';
// components/artist/InsightsScreen.jsx — Insights (Insights.dc.html): peak
// viewers, watch time, average stay, new followers, votes, tokens, and
// viewers across the show.
import { useEffect, useState } from 'react';
import { useSession } from '../../lib/useSession';
import { api } from '../../lib/viewerApi';
import { formatDuration } from '../../lib/insights';
import { Skeleton, ErrorState, Empty } from '../viewer/States';
import { Back } from '../viewer/Icons';

export default function InsightsScreen() {
  const { accessToken, loading, profile } = useSession();
  const [data, setData] = useState(null); const [err, setErr] = useState(null); const [pick, setPick] = useState(0);
  useEffect(() => { if (accessToken) api('/api/artist/insights', { accessToken }).then((r) => (r.ok ? setData(r.data) : setErr(r.data?.error || 'Could not load insights'))); }, [accessToken]);
  if (loading || (!data && !err)) return <div className="v-screen" role="status" aria-label="Loading"><Skeleton w={140} h={30} /><Skeleton h={48} /><Skeleton h={200} /></div>;
  if (err) return <div className="v-screen"><ErrorState title="We couldn't load insights" body={err} onRetry={() => window.location.reload()} backHref="/profile" backLabel="Your profile" /></div>;
  const shows = data.shows || []; const s = shows[pick];
  const stat = (label, value) => <div className="v-card-light v-col" style={{ padding: 14, gap: 2 }}><span className="v-muted" style={{ fontSize: 13, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase' }}>{label}</span><span style={{ fontSize: 26, fontWeight: 700 }}>{value}</span></div>;
  return (
    <div className="v-screen" data-testid="insights">
      <div className="v-row" style={{ gap: 12 }}><a href="/profile" aria-label="Back" className="v-icon-btn v-btn-ghost-light"><Back /></a><h1 className="v-h1" style={{ fontSize: 30 }}>Insights</h1></div>
      {!shows.length ? <Empty title="No shows yet" body="Insights appear after your first show ends." action="Schedule a show" actionHref="/artist/schedule" /> : (
        <>
          <select className="v-field" value={pick} onChange={(e) => setPick(Number(e.target.value))} style={{ height: 48, borderRadius: 12, border: 'none', background: 'rgba(255,255,255,0.72)', padding: '0 14px', fontSize: 17 }}>{shows.map((x, i) => <option key={x.show_id} value={i}>{x.title || 'Show'} · {new Date(x.slated_at).toLocaleDateString('en-GB')}</option>)}</select>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
            {stat('Peak viewers', s.peak_viewers)}{stat('Watch time', formatDuration(s.watch_time_ms))}{stat('Average stay', formatDuration(s.average_stay_ms))}{stat('New followers', s.followers_gained)}{stat('Votes cast', s.votes_cast)}{stat('Tokens received', s.tokens_received)}
          </div>
          <section className="v-col" style={{ gap: 8 }}>
            <h2 className="v-h2" style={{ fontSize: 20 }}>Viewers across the show</h2>
            <Series series={s.viewers_series || []} />
            {s.delay_seconds != null && <span className="v-muted" style={{ fontSize: 14 }}>Measured delay to viewers: {s.delay_seconds} s.</span>}
          </section>
        </>
      )}
    </div>
  );
}

function Series({ series }) {
  if (!series.length) return <div className="v-card-light v-muted" style={{ padding: 16 }}>No viewer data was recorded for this show.</div>;
  const w = 320, h = 120, max = Math.max(1, ...series.map((p) => p.viewers)), last = Math.max(1, series[series.length - 1].t);
  const pts = series.map((p) => `${(p.t / last) * (w - 20) + 10},${h - 10 - (p.viewers / max) * (h - 20)}`).join(' ');
  return <svg viewBox={`0 0 ${w} ${h}`} width="100%" role="img" aria-label={`Viewers per minute, peak ${max}`} style={{ background: 'rgba(255,255,255,0.72)', borderRadius: 16 }}><polyline fill="none" stroke="#2ec4b6" strokeWidth="3" points={pts} /><text x="10" y="14" fontSize="11" fill="#011627">{max}</text><text x="10" y={h - 2} fontSize="11" fill="#011627">0</text></svg>;
}
