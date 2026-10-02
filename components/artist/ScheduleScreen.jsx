'use client';
// components/artist/ScheduleScreen.jsx — Schedule a show (Schedule.dc.html).
// Solo or Versus; date and time (earliest 30 minutes from now); length;
// title, genre, cover; place; optional Studio library attachments. Booking
// creates the broadcast at once (PRD 141) and the reminders still in the future.
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from '../../lib/useSession';
import { getSupabase } from '../../lib/supabaseClient';
import { api } from '../../lib/viewerApi';
import { validateBooking, earliestStart, LENGTH_OPTIONS } from '../../lib/schedule';
import { GENRES } from '../../lib/genres';
import { track } from '../../lib/telemetry';
import { ErrorState, Skeleton } from '../viewer/States';
import { Back, Warn, Clock } from '../viewer/Icons';

const pad = (n) => String(n).padStart(2, '0');
const localDate = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const localTime = (ms) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

export default function ScheduleScreen() {
  const router = useRouter();
  const { session, profile, loading, accessToken } = useSession();
  const first = earliestStart();
  const [form, setForm] = useState({ mode: 'solo', date: localDate(first), time: localTime(first), minutes: 45, title: '', genre: '', inviteeUsername: '', description: '', placeId: '' });
  const [places, setPlaces] = useState(null);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  useEffect(() => { if (!loading && !session) router.replace('/signup?trigger=perform'); }, [loading, session, router]);
  useEffect(() => { if (session) getSupabase().from('places').select('id, name, mic_label').eq('artist_id', session.user.id).then(({ data }) => { setPlaces(data || []); if (data?.[0]) setForm((f) => ({ ...f, placeId: data[0].id, genre: f.genre || profile?.genres?.[0] || '' })); }); }, [session, profile]);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const startAt = form.date && form.time ? new Date(`${form.date}T${form.time}:00`).toISOString() : '';
  async function book(e) {
    e.preventDefault();
    const v = validateBooking({ ...form, startAt });
    if (!v.ok) { setErrors(v.errors); return; }
    setErrors({}); setBusy(true);
    const r = await api('/api/artist/shows', { method: 'POST', accessToken, body: { ...form, startAt } });
    setBusy(false);
    if (!r.ok) { setErrors(r.data?.errors || { form: r.data?.error || 'Could not book the show.' }); return; }
    track('show.scheduled', { mode: form.mode, minutes: form.minutes });
    setResult(r.data);
  }
  if (loading || places === null) return <div className="v-screen" role="status" aria-label="Loading"><Skeleton w={200} h={30} /><Skeleton h={44} /><Skeleton h={120} /></div>;
  if (profile?.role !== 'artist') return <div className="v-screen"><ErrorState title="Scheduling is for artists" body="Become an artist from your profile first." retry={false} backHref="/profile" backLabel="Your profile" /></div>;
  if (result) {
    const failed = (result.broadcasts || []).filter((b) => b.state === 'failed');
    return (
      <div className="v-screen" data-testid="booked">
        <h1 className="v-h1" style={{ fontSize: 30 }}>Booked</h1>
        <div className="v-card-light" style={{ padding: 16 }} className2="">
          <p style={{ fontSize: 18, fontWeight: 700 }}>{result.show.title}</p>
          <p className="v-muted">{new Date(result.show.slated_at).toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · {result.show.duration_minutes} min · {result.show.performance_mode === 'versus' ? 'Versus' : 'Solo'}</p>
          {failed.length ? <div className="v-error" role="alert" style={{ marginTop: 10 }}><span style={{ color: 'var(--red)' }}><Warn /></span><span style={{ fontSize: 15 }}>The YouTube broadcast could not be created yet ({failed[0].last_error}). The show is booked; connect your channel in onboarding and it will be created when you go live.</span></div> : <p className="v-muted" style={{ marginTop: 6 }}>Your YouTube broadcast is created and waiting. Reminders set: {result.remindersDue.map((m) => m >= 60 ? `${m / 60}h` : `${m}m`).join(', ') || 'none still ahead'}.</p>}
          {result.inviteToken && <p style={{ marginTop: 6 }}>Invite sent. The show confirms when they accept.</p>}
        </div>
        <div className="v-card-light v-col" style={{ padding: 16, gap: 6 }}><span className="v-kicker" style={{ color: 'var(--ink)' }}>Share your show</span><span className="v-muted" style={{ fontSize: 15 }}>{typeof window !== 'undefined' ? `${window.location.origin}/show/${result.show.id}` : ''}</span><button className="v-btn v-btn-ghost-light" onClick={() => navigator.clipboard?.writeText(`${window.location.origin}/show/${result.show.id}`)}>Copy link</button></div>
        <a className="v-btn v-btn-lg v-btn-teal" href={`/artist/kit-check?show=${result.show.id}`} data-testid="go-kit-check">Run Kit Check</a>
        <a className="v-btn v-btn-ghost-light" href="/profile">Back to profile</a>
      </div>
    );
  }
  return (
    <form className="v-screen" onSubmit={book} data-testid="schedule-screen" noValidate>
      <div className="v-row" style={{ gap: 12 }}><a href="/artist/create" aria-label="Back" className="v-icon-btn v-btn-ghost-light"><Back /></a><h1 className="v-h1" style={{ fontSize: 30 }}>Schedule a show</h1></div>
      <section className="v-col" style={{ gap: 8 }}><h2 className="v-h2" style={{ fontSize: 18 }}>Show type</h2><div className="v-row" style={{ gap: 8 }}>{[['solo', 'Solo'], ['versus', 'Versus']].map(([k, l]) => <button type="button" key={k} className="v-chip v-chip-light" aria-pressed={form.mode === k} onClick={() => setForm((f) => ({ ...f, mode: k }))}>{l}</button>)}</div>
        {form.mode === 'versus' && <label className="v-field">Invite an artist<input placeholder="@their_username" value={form.inviteeUsername} onChange={set('inviteeUsername')} />{errors.invitee && <span className="v-err">{errors.invitee}</span>}</label>}
      </section>
      <section className="v-col" style={{ gap: 8 }}><h2 className="v-h2" style={{ fontSize: 18 }}>When</h2>
        <div className="v-row" style={{ gap: 10 }}><label className="v-field" style={{ flex: 1 }}>Date<input type="date" value={form.date} onChange={set('date')} min={localDate(Date.now())} /></label><label className="v-field" style={{ flex: 1 }}>Start time<input type="time" value={form.time} onChange={set('time')} /></label></div>
        <span className="v-row v-muted" style={{ fontSize: 14, gap: 6 }}><Clock size={16} />The earliest start is 30 minutes from now.</span>
        {errors.startAt && <span className="v-err" style={{ color: 'var(--red)' }}>{errors.startAt}</span>}
      </section>
      <section className="v-col" style={{ gap: 8 }}><h2 className="v-h2" style={{ fontSize: 18 }}>Length</h2><div className="v-row" style={{ gap: 8, flexWrap: 'wrap' }}>{LENGTH_OPTIONS.map((m) => <button type="button" key={m} className="v-chip v-chip-light" aria-pressed={Number(form.minutes) === m} onClick={() => setForm((f) => ({ ...f, minutes: m }))}>{m >= 60 ? `${m / 60} ${m === 60 ? 'hour' : 'hr'}${m % 60 ? ` ${m % 60}` : ''}` : `${m} min`}</button>)}</div>{errors.minutes && <span className="v-err" style={{ color: 'var(--red)' }}>{errors.minutes}</span>}</section>
      <section className="v-col" style={{ gap: 8 }}><h2 className="v-h2" style={{ fontSize: 18 }}>Details</h2>
        <label className="v-field">Show title<input placeholder="Give your show a name" value={form.title} maxLength={80} onChange={set('title')} />{errors.title && <span className="v-err">{errors.title}</span>}</label>
        <label className="v-field">Genre<select value={form.genre} onChange={set('genre')}><option value="">Choose</option>{GENRES.map((g) => <option key={g}>{g}</option>)}</select></label>
        <label className="v-field">A line for the show page (optional)<input placeholder="What fans can expect" value={form.description} maxLength={200} onChange={set('description')} /></label>
      </section>
      <section className="v-col" style={{ gap: 8 }}><h2 className="v-h2" style={{ fontSize: 18 }}>Place</h2>
        {places.length ? <select className="v-field" value={form.placeId} onChange={set('placeId')} style={{ height: 48, borderRadius: 12, border: 'none', background: 'rgba(1,22,39,0.07)', padding: '0 14px', fontSize: 17 }}>{places.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.mic_label || 'mic not set'}</option>)}</select> : <span className="v-muted" style={{ fontSize: 15 }}>No saved place yet. <a className="v-link" href="/artist/onboarding">Set up your stage</a> to save your mic and cameras.</span>}
      </section>
      <section className="v-col" style={{ gap: 6 }}><h2 className="v-h2" style={{ fontSize: 18 }}>From your Studio library (optional)</h2><span className="v-muted" style={{ fontSize: 15 }}>Backing tracks, cue sheets and B-roll are attached from the pilot console for now (<a className="v-link" href="/dashboard">open it</a>).</span></section>
      <span className="v-muted" style={{ fontSize: 14 }}>Anyone can join. If your viewer-hours run out mid-show, the show carries on.</span>
      {errors.form && <ErrorState title="Could not book the show" body={errors.form} retry={false} backHref={null} />}
      <button type="submit" className="v-btn v-btn-lg v-btn-teal" disabled={busy} data-testid="book-show">{busy ? 'Booking' : 'Book show'}</button>
    </form>
  );
}
