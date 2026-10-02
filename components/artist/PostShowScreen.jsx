'use client';
// components/artist/PostShowScreen.jsx — Show ended (PostShow.dc.html):
// summary, recording ready with Public / Unlisted / Private, Make a clip, Share.
import { useEffect, useState } from 'react';
import { useSession } from '../../lib/useSession';
import { getSupabase } from '../../lib/supabaseClient';
import { api } from '../../lib/viewerApi';
import { formatDuration } from '../../lib/insights';
import { Skeleton, ErrorState } from '../viewer/States';
import { Close, Share, Play } from '../viewer/Icons';

export default function PostShowScreen({ showId }) {
  const { session, accessToken, loading } = useSession();
  const [show, setShow] = useState(null); const [ins, setIns] = useState(null); const [rec, setRec] = useState(null); const [err, setErr] = useState(null);
  useEffect(() => {
    if (!session) return;
    const sb = getSupabase();
    (async () => {
      const [{ data: s }, { data: i }, { data: r }] = await Promise.all([
        sb.from('shows').select('*').eq('id', showId).maybeSingle(),
        sb.from('show_insights').select('*').eq('show_id', showId).maybeSingle(),
        sb.from('recordings').select('*').eq('show_id', showId).order('created_at', { ascending: false }).limit(1),
      ]);
      if (!s) { setErr('notfound'); return; }
      setShow(s); setIns(i || null); setRec(r?.[0] || null);
    })();
  }, [session, showId]);
  async function setVisibility(v) { if (!rec) return; await getSupabase().from('recordings').update({ visibility: v }).eq('id', rec.id); setRec({ ...rec, visibility: v }); }
  if (err === 'notfound') return <div className="v-screen"><ErrorState title="We couldn't find that show" retry={false} backHref="/profile" backLabel="Your profile" /></div>;
  if (loading || !show) return <div className="v-screen" role="status" aria-label="Loading"><Skeleton w={160} h={30} /><Skeleton h={120} /></div>;
  const stat = (label, value) => <div className="v-card-light v-col" style={{ padding: 14, gap: 2 }}><span className="v-muted" style={{ fontSize: 13, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase' }}>{label}</span><span style={{ fontSize: 28, fontWeight: 700 }}>{value}</span></div>;
  return (
    <div className="v-screen" data-testid="post-show">
      <div className="v-row" style={{ justifyContent: 'flex-end' }}><a href="/profile" aria-label="Close" className="v-icon-btn v-btn-ghost-light"><Close /></a></div>
      <h1 className="v-h1" style={{ fontSize: 34 }}>Show ended</h1>
      <p className="v-muted" style={{ fontSize: 18 }}>Thank you for performing. Here is how it went.</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
        {stat('Peak viewers', ins?.peak_viewers ?? '—')}{stat('Watch time', ins ? formatDuration(ins.watch_time_ms) : '—')}{stat('Votes cast', ins?.votes_cast ?? '—')}{stat('Tokens received', ins?.tokens_received ?? '—')}
      </div>
      <div className="v-card-light v-col" style={{ padding: 14, gap: 4 }}><span style={{ fontWeight: 700 }}>Nothing was cut off.</span><span className="v-muted" style={{ fontSize: 14 }}>Viewer-hours borrowed, if any, show in Allowance and packs. {ins?.delay_seconds != null ? `Measured delay to viewers: ${ins.delay_seconds} s.` : ''}</span></div>
      <div className="v-card-light v-col" style={{ padding: 14, gap: 8 }} data-testid="recording-card">
        {rec ? (
          <>
            <span className="v-row" style={{ gap: 8 }}><Play /><span className="v-col" style={{ gap: 0 }}><span style={{ fontWeight: 700 }}>Recording ready</span><span className="v-muted" style={{ fontSize: 14 }}>{show.title} · {formatDuration(rec.duration_ms)}{rec.training_copy_path ? ' · training copy kept' : ' · no training copy (your choice)'}</span></span></span>
            <div className="v-row" style={{ gap: 6 }}>{['public', 'unlisted', 'private'].map((v) => <button key={v} className="v-chip v-chip-light" aria-pressed={rec.visibility === v} onClick={() => setVisibility(v)} data-testid={`vis-${v}`}>{v[0].toUpperCase() + v.slice(1)}</button>)}</div>
          </>
        ) : <span className="v-muted">The recording is still being finalised.</span>}
      </div>
      <a className="v-btn v-btn-lg v-btn-teal" href={rec ? `/artist/clips/new?recording=${rec.id}` : '#'} aria-disabled={!rec}><Play />Make a clip</a>
      <button className="v-btn v-btn-lg v-btn-ghost-light" onClick={() => { const url = `${location.origin}/show/${showId}`; if (navigator.share) navigator.share({ url }).catch(() => {}); else navigator.clipboard?.writeText(url); }}><Share />Share your show</button>
      <a className="v-link" style={{ alignSelf: 'center' }} href="/artist/insights">See insights</a>
    </div>
  );
}
