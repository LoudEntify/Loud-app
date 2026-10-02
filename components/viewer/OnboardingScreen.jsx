'use client';
// components/viewer/OnboardingScreen.jsx — viewer onboarding
// (ViewerOnboarding.dc.html, NotificationPrompt). Pick three or more
// genres, follow a few suggested artists including new ones. Skippable,
// resumable, never blocks watching.
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { GENRES } from '../../lib/genres';
import { getSupabase } from '../../lib/supabaseClient';
import { useSession, refreshProfile } from '../../lib/useSession';
import { suggestedArtists, followArtist } from '../../lib/follows';
import { track } from '../../lib/telemetry';
import { Skeleton } from './States';
import { Check, Person } from './Icons';

export default function OnboardingScreen({ next = '/discover' }) {
  const router = useRouter();
  const { session, profile, loading } = useSession();
  const [step, setStep] = useState(1);
  const [genres, setGenres] = useState([]);
  const [artists, setArtists] = useState(null);
  const [followed, setFollowed] = useState(new Set());
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (profile?.genres?.length) setGenres(profile.genres); }, [profile]);
  useEffect(() => { if (!loading && !session) router.replace(`/signup?next=${encodeURIComponent('/onboarding')}`); }, [loading, session, router]);
  useEffect(() => { if (step === 2 && session) suggestedArtists({ userId: session.user.id, genres, limit: 8 }).then((a) => setArtists(a || [])); }, [step, session, genres]);
  async function saveGenres() {
    setBusy(true);
    await getSupabase().from('profiles').update({ genres, onboarding: { ...(profile?.onboarding || {}), genres_at: new Date().toISOString() } }).eq('id', session.user.id);
    await refreshProfile(); setBusy(false); setStep(2);
  }
  async function finish() {
    setBusy(true);
    await getSupabase().from('profiles').update({ onboarding: { ...(profile?.onboarding || {}), completed_at: new Date().toISOString() } }).eq('id', session.user.id);
    await refreshProfile(); track('onboarding.completed', { genres: genres.length, follows: followed.size });
    router.replace(next);
  }
  const toggle = (g) => setGenres((list) => list.includes(g) ? list.filter((x) => x !== g) : [...list, g]);
  const palette = ['linear-gradient(135deg, rgba(46,196,182,.45), rgba(255,255,255,.8))', 'linear-gradient(135deg, rgba(255,159,28,.4), rgba(255,255,255,.8))', 'linear-gradient(135deg, rgba(231,29,54,.26), rgba(255,255,255,.8))'];
  return (
    <div className="v-screen" style={{ paddingBottom: 36 }} data-testid="onboarding">
      <div className="v-row" style={{ justifyContent: 'space-between' }}><img src="/logo/loudentify-on-light.png" alt="Loudentify" style={{ height: 24 }} /><button className="v-link" onClick={finish}>Skip</button></div>
      <div role="progressbar" aria-label={`Step ${step} of 2`} aria-valuemin={1} aria-valuemax={2} aria-valuenow={step} style={{ height: 6, borderRadius: 3, background: 'rgba(1,22,39,0.07)', overflow: 'hidden' }}><div style={{ width: `${step * 50}%`, height: '100%', background: 'var(--silk-teal)' }} /></div>
      {step === 1 ? (
        <>
          <div className="v-col" style={{ gap: 4 }}><h1 style={{ fontSize: 34, lineHeight: 1.05 }}>What do you love to hear?</h1><p className="v-muted" style={{ fontSize: 18 }}>Pick three or more. You can change this later.</p></div>
          <div role="group" aria-label="Genres" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
            {GENRES.map((g, i) => <button key={g} className="v-genre-tile" aria-pressed={genres.includes(g)} onClick={() => toggle(g)} style={genres.includes(g) ? { background: palette[i % 3] } : undefined}>{g}{genres.includes(g) && <span style={{ position: 'absolute', top: 8, right: 8, width: 22, height: 22, borderRadius: 11, background: 'var(--ink)', color: 'var(--porcelain)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Check size={14} /></span>}</button>)}
          </div>
          <div style={{ flex: 1 }} />
          <button className="v-btn v-btn-lg v-btn-teal" disabled={genres.length < 3 || busy} onClick={saveGenres} data-testid="genres-continue">{genres.length < 3 ? `Pick ${3 - genres.length} more` : `Continue with ${genres.length} picked`}</button>
        </>
      ) : (
        <>
          <div className="v-col" style={{ gap: 4 }}><h1 style={{ fontSize: 34, lineHeight: 1.05 }}>Follow a few artists</h1><p className="v-muted" style={{ fontSize: 18 }}>Including some who are new. You'll hear when they go live.</p></div>
          {artists === null ? <Skeleton h={64} /> : artists.length ? artists.map((a) => (
            <div key={a.id} className="v-card-light v-list-row">
              <span className="v-avatar" style={{ width: 44, height: 44 }}>{a.avatar_url ? <img src={a.avatar_url} alt="" /> : <Person />}</span>
              <span className="v-col" style={{ flex: 1, gap: 0 }}><span style={{ fontSize: 17, fontWeight: 700 }}>{a.display_name}</span><span className="v-muted" style={{ fontSize: 14 }}>{(a.genres || []).slice(0, 2).join(', ') || 'New artist'}</span></span>
              <button className={`v-btn ${followed.has(a.id) ? 'v-btn-ghost-light' : 'v-btn-teal'}`} style={{ height: 40 }} onClick={async () => { if (followed.has(a.id)) return; await followArtist(session.user.id, a.id); setFollowed((s) => new Set([...s, a.id])); track('follow', { onboarding: true }); }}>{followed.has(a.id) ? 'Following' : 'Follow'}</button>
            </div>
          )) : <p className="v-muted">No artists to suggest yet. Discover will fill up as artists join.</p>}
          {followed.size > 0 && <div className="v-card-light" style={{ padding: 16 }}><strong>Want to hear when they go live?</strong><p className="v-muted" style={{ fontSize: 15, marginTop: 4 }}>On the phone app we ask for notifications here. On the web, reminders show in your Inbox.</p></div>}
          <div style={{ flex: 1 }} />
          <button className="v-btn v-btn-lg v-btn-teal" disabled={busy} onClick={finish} data-testid="onboarding-finish">Start watching</button>
        </>
      )}
    </div>
  );
}
