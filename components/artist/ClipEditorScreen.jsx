'use client';
// components/artist/ClipEditorScreen.jsx — New clip (ClipEditor.dc.html).
// Trim up to 90 seconds from a recording, frame for 9:16, add a title; the
// handle and the Loudentify mark go on every clip. Saving creates the
// clips row; the export file is produced by the egress service (Phase 3
// stub: the row carries the range and the recording path).
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from '../../lib/useSession';
import { getSupabase } from '../../lib/supabaseClient';
import { formatDuration } from '../../lib/insights';
import { track } from '../../lib/telemetry';
import { Skeleton, ErrorState, Empty } from '../viewer/States';
import { Close, Share } from '../viewer/Icons';

const MAX = 90000;
export default function ClipEditorScreen({ recordingId = null }) {
  const router = useRouter();
  const { session, profile, loading } = useSession();
  const [recordings, setRecordings] = useState(null);
  const [rec, setRec] = useState(null);
  const [start, setStart] = useState(0); const [end, setEnd] = useState(45000); const [title, setTitle] = useState(''); const [busy, setBusy] = useState(false); const [saved, setSaved] = useState(null);
  useEffect(() => { if (!session) return; getSupabase().from('recordings').select('id, title, duration_ms, recorded_at, show_id').eq('artist_id', session.user.id).order('recorded_at', { ascending: false }).limit(20).then(({ data }) => { setRecordings(data || []); const pick = (data || []).find((r) => r.id === recordingId) || data?.[0] || null; setRec(pick); if (pick?.duration_ms) setEnd(Math.min(45000, pick.duration_ms)); }); }, [session, recordingId]);
  async function save() {
    setBusy(true);
    const { data, error } = await getSupabase().from('clips').insert({ recording_id: rec.id, show_id: rec.show_id, artist_id: session.user.id, title: title.trim(), start_ms: start, end_ms: end, visibility: 'public' }).select('id').single();
    setBusy(false);
    if (error) { setSaved({ error: error.message }); return; }
    track('clip.shared', { length_ms: end - start }); setSaved({ id: data.id });
  }
  if (loading || recordings === null) return <div className="v-screen" role="status" aria-label="Loading"><Skeleton w={120} h={30} /><Skeleton h={300} /></div>;
  if (profile?.role !== 'artist') return <div className="v-screen"><ErrorState title="Clips are for artists" retry={false} backHref="/profile" backLabel="Your profile" /></div>;
  if (!recordings.length) return <div className="v-screen"><Empty title="No recordings yet" body="Clips are cut from a past show. Perform one first." action="Schedule a show" actionHref="/artist/schedule" /></div>;
  const len = end - start;
  const dur = rec?.duration_ms || MAX * 4;
  return (
    <div className="v-screen" data-testid="clip-editor">
      <div className="v-row" style={{ justifyContent: 'space-between' }}><a href="/profile" aria-label="Close" className="v-icon-btn v-btn-ghost-light"><Close /></a><h1 className="v-h1" style={{ fontSize: 28 }}>New clip</h1><button className="v-btn v-btn-ghost-light" disabled={!saved?.id} onClick={() => { const url = `${location.origin}/clip/${saved.id}`; if (navigator.share) navigator.share({ url }).catch(() => {}); else navigator.clipboard?.writeText(url); }}><Share />Share</button></div>
      <label className="v-field">From<select value={rec?.id || ''} onChange={(e) => { const r = recordings.find((x) => x.id === e.target.value); setRec(r); setStart(0); setEnd(Math.min(45000, r?.duration_ms || 45000)); }}>{recordings.map((r) => <option key={r.id} value={r.id}>{r.title} · {new Date(r.recorded_at).toLocaleDateString('en-GB')}</option>)}</select></label>
      <div style={{ position: 'relative', width: '100%', maxWidth: 270, aspectRatio: '9/16', margin: '0 auto', background: 'var(--silk-card)', borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(253,255,252,0.7)' }} aria-label="Clip preview">
        <span className="v-kicker">Clip preview 9:16</span>
        <span style={{ position: 'absolute', left: 10, bottom: 10, fontSize: 13, fontWeight: 700, color: 'var(--porcelain)' }}>LOUDENTIFY · @{profile.username || profile.display_name}</span>
      </div>
      <div className="v-row" style={{ justifyContent: 'space-between' }}><span style={{ fontWeight: 700 }}>{formatDuration(len)} selected</span><span className="v-muted">90 seconds max</span></div>
      <div aria-label="Trim" className="v-col" style={{ gap: 6 }}>
        <label className="v-field">Trim start ({formatDuration(start)})<input type="range" min={0} max={Math.max(0, dur - 1000)} step={500} value={start} onChange={(e) => { const s = Number(e.target.value); setStart(s); setEnd((en) => Math.min(Math.max(en, s + 1000), s + MAX, dur)); }} aria-label="Trim start" /></label>
        <label className="v-field">Trim end ({formatDuration(end)})<input type="range" min={1000} max={dur} step={500} value={end} onChange={(e) => { const en = Number(e.target.value); setEnd(Math.min(en, start + MAX)); if (en <= start) setStart(Math.max(0, en - 1000)); }} aria-label="Trim end" /></label>
      </div>
      <label className="v-field">Title<input value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} placeholder="Say what this moment is" /></label>
      <span className="v-muted" style={{ fontSize: 14 }}>Your handle and the Loudentify mark are added to every clip.</span>
      {saved?.error && <ErrorState title="Could not save the clip" body={saved.error} retry={false} backHref={null} />}
      {saved?.id ? <div className="v-card-light" style={{ padding: 14 }}><strong>Clip saved.</strong> <span className="v-muted">Share it, or <a className="v-link" href="/profile">see it on your profile</a>.</span></div>
        : <button className="v-btn v-btn-lg v-btn-teal" disabled={busy || !title.trim() || len <= 0 || len > MAX} onClick={save} data-testid="save-clip">Save clip</button>}
    </div>
  );
}
