'use client';
// components/artist/ArtistOnboardingScreen.jsx — six steps to your first
// show (ArtistOnboarding.dc.html + the YouTube connection PRD 111 adds;
// ArtistAgreement.dc.html). Stop any time and pick it up from your profile.
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession, refreshProfile } from '../../lib/useSession';
import { getSupabase } from '../../lib/supabaseClient';
import { api } from '../../lib/viewerApi';
import { GENRES } from '../../lib/genres';
import { track } from '../../lib/telemetry';
import { Skeleton, ErrorState } from '../viewer/States';
import { Check, Chevron, Back, Warn } from '../viewer/Icons';

const STEPS = [
  { key: 'identity', title: 'Photo, bio and genres', hint: 'How fans will find you' },
  { key: 'agreement', title: 'Artist agreement', hint: 'Plain terms, plus the training-data choice' },
  { key: 'youtube', title: 'Connect your YouTube channel', hint: 'Your shows go out on your own channel' },
  { key: 'mic', title: 'Pick your mic', hint: 'Choose it once, saved to your first place' },
  { key: 'camera', title: 'Pair a camera', hint: 'Your phone, or a second phone as a camera' },
  { key: 'book', title: 'Book your first show', hint: 'At least 30 minutes from now' },
];

export default function ArtistOnboardingScreen({ next = '/profile', youtubeResult = null }) {
  const router = useRouter();
  const { session, profile, loading, accessToken } = useSession();
  const [open, setOpen] = useState(null);
  const [yt, setYt] = useState(null);
  const [places, setPlaces] = useState(null);
  const [consent, setConsent] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const sb = getSupabase();
  const load = useCallback(async () => {
    if (!session) return;
    const [{ data: p }, { data: c }, st] = await Promise.all([
      sb.from('places').select('*').eq('artist_id', session.user.id).order('created_at'),
      sb.from('consent_records').select('consent_type, granted, recorded_at').eq('user_id', session.user.id).order('recorded_at', { ascending: false }),
      api('/api/artist/youtube/status', { accessToken }),
    ]);
    setPlaces(p || []); setConsent(c || []); setYt(st.ok ? st.data : { connection: null, mode: 'mock' });
  }, [session, accessToken, sb]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (!loading && !session) router.replace('/signup?trigger=perform'); }, [loading, session, router]);
  useEffect(() => { if (!loading && profile && profile.role !== 'artist') router.replace('/profile'); }, [loading, profile, router]);

  const done = {
    identity: Boolean(profile?.bio && profile?.genres?.length),
    agreement: Boolean(consent?.some((c) => c.consent_type === 'terms' && c.granted)) && Boolean(profile?.onboarding?.agreement_at),
    youtube: Boolean(yt?.connection?.connected && yt?.connection?.live_enabled),
    mic: Boolean(places?.some((p) => p.mic_label)),
    camera: Boolean(profile?.onboarding?.camera_at),
    book: false,
  };
  const count = Object.values(done).filter(Boolean).length;
  const progress = { ...(profile?.onboarding || {}) };
  async function mark(key) { await sb.from('profiles').update({ onboarding: { ...progress, [key]: new Date().toISOString() } }).eq('id', session.user.id); await refreshProfile(); }

  if (loading || !profile || places === null) return <div className="v-screen" role="status" aria-label="Loading"><Skeleton w={160} h={30} /><Skeleton h={6} /><Skeleton h={64} /><Skeleton h={64} /></div>;
  const openStep = open;
  return (
    <div className="v-screen" style={{ paddingBottom: 36 }} data-testid="artist-onboarding">
      <div className="v-row" style={{ justifyContent: 'space-between' }}><img src="/logo/loudentify-on-light.png" alt="Loudentify" style={{ height: 24 }} /><a className="v-link" href={next}>Later</a></div>
      <div className="v-col" style={{ gap: 4 }}><h1 style={{ fontSize: 34, lineHeight: 1.05 }}>Welcome, {profile.display_name}</h1><p className="v-muted" style={{ fontSize: 18 }}>Six steps to your first show. Stop any time and pick it up from your profile.</p></div>
      <div role="progressbar" aria-label={`${count} of 6 done`} aria-valuemin={0} aria-valuemax={6} aria-valuenow={count} style={{ height: 6, borderRadius: 3, background: 'rgba(1,22,39,0.07)', overflow: 'hidden' }}><div style={{ width: `${(count / 6) * 100}%`, height: '100%', background: 'var(--silk-teal)' }} /></div>
      <span className="v-kicker v-muted">{count} of 6</span>
      {youtubeResult === 'error' && <ErrorState title="YouTube did not connect" body="Google sent us back without a channel. Try again, or carry on and connect later from Settings." retry={false} backHref={null} />}
      {err && <ErrorState title="That didn't save" body={err} onRetry={() => setErr(null)} backHref={null} />}
      <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {STEPS.map((s, i) => (
          <li key={s.key} className="v-card-light" style={{ padding: 0 }}>
            <button className="v-list-row" style={{ width: '100%', textAlign: 'left', minHeight: 64 }} onClick={() => setOpen(openStep === s.key ? null : s.key)} aria-expanded={openStep === s.key} data-testid={`step-${s.key}`}>
              <span className="v-icon-btn" style={{ width: 36, height: 36, background: done[s.key] ? 'var(--silk-teal)' : 'rgba(1,22,39,0.07)', color: 'var(--ink)', fontWeight: 700 }} role="img" aria-label={done[s.key] ? 'Done' : `Step ${i + 1}`}>{done[s.key] ? <Check size={18} /> : i + 1}</span>
              <span className="v-col" style={{ flex: 1, gap: 2 }}><span style={{ fontSize: 18, fontWeight: 700 }}>{s.title}</span><span className="v-muted" style={{ fontSize: 14 }}>{done[s.key] ? (s.key === 'agreement' ? 'Accepted' : s.key === 'youtube' ? `Connected: ${yt?.connection?.channel_title || 'your channel'}` : 'Done') : s.hint}</span></span>
              <Chevron />
            </button>
            {openStep === s.key && (
              <div style={{ padding: '0 16px 16px' }}>
                {s.key === 'identity' && <IdentityStep profile={profile} onSaved={async () => { await refreshProfile(); setOpen('agreement'); }} />}
                {s.key === 'agreement' && <AgreementStep consent={consent} session={session} onDone={async (trainingOn) => { await sb.from('consent_records').insert({ user_id: session.user.id, consent_type: 'training_data', granted: trainingOn, source: 'artist_agreement', document_version: '2026-10-draft' }); await mark('agreement_at'); track('onboarding.agreement', { training: trainingOn }); await load(); setOpen('youtube'); }} />}
                {s.key === 'youtube' && <YouTubeStep yt={yt} accessToken={accessToken} busy={busy} onConnect={async () => { setBusy(true); const r = await api('/api/artist/youtube/connect', { method: 'POST', accessToken }); setBusy(false); if (!r.ok) { setErr(r.data?.error || 'Could not start the connection.'); return; } if (r.data.url) { window.location.href = r.data.url; return; } await load(); setOpen('mic'); }} onRecheck={async () => { await api('/api/artist/youtube/status', { method: 'POST', accessToken }); await load(); }} onDisconnect={async () => { await api('/api/artist/youtube/disconnect', { method: 'POST', accessToken }); await load(); }} />}
                {s.key === 'mic' && <MicStep places={places} onSaved={async () => { await load(); setOpen('camera'); }} userId={session.user.id} />}
                {s.key === 'camera' && <div className="v-col" style={{ gap: 10 }}><p style={{ fontSize: 16 }}>Your phone is your first camera. To add a second phone, open Settings, Devices and scan the code it shows.</p><div className="v-row" style={{ gap: 8, flexWrap: 'wrap' }}><a className="v-btn v-btn-ghost-light" href="/cam/pair">Pair a second phone</a><button className="v-btn v-btn-teal" onClick={async () => { await mark('camera_at'); setOpen('book'); }}>This phone is my camera</button></div></div>}
                {s.key === 'book' && <div className="v-col" style={{ gap: 10 }}><p style={{ fontSize: 16 }}>Shows are booked at least 30 minutes ahead. Your channel, mic and camera are ready; book the slot and run Kit Check before it starts.</p><a className="v-btn v-btn-lg v-btn-teal" href="/artist/schedule" data-testid="book-first-show">Book your first show</a></div>}
              </div>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

function IdentityStep({ profile, onSaved }) {
  const [bio, setBio] = useState(profile.bio || ''); const [genres, setGenres] = useState(profile.genres || []); const [busy, setBusy] = useState(false);
  const toggle = (g) => setGenres((l) => l.includes(g) ? l.filter((x) => x !== g) : l.length < 3 ? [...l, g] : l);
  return (
    <div className="v-col" style={{ gap: 10 }}>
      <label className="v-field">Bio<input value={bio} maxLength={240} onChange={(e) => setBio(e.target.value)} placeholder="Two lines about your music" /></label>
      <span className="v-kicker v-muted">Genres (one main, up to two more)</span>
      <div className="v-row" style={{ flexWrap: 'wrap', gap: 8 }}>{GENRES.map((g) => <button key={g} className="v-chip v-chip-light" aria-pressed={genres.includes(g)} onClick={() => toggle(g)}>{g}</button>)}</div>
      <button className="v-btn v-btn-teal" disabled={busy || !bio.trim() || !genres.length} onClick={async () => { setBusy(true); await getSupabase().from('profiles').update({ bio: bio.trim(), genres, genre: genres[0] }).eq('id', profile.id); setBusy(false); onSaved(); }}>Save</button>
    </div>
  );
}

function AgreementStep({ consent, onDone }) {
  const existing = consent?.find((c) => c.consent_type === 'training_data');
  const [training, setTraining] = useState(existing ? existing.granted : true);
  const rows = [
    ['Your music stays yours', 'You keep every right you came with. You give us permission to stream and record your shows, and to show clips of them on Loudentify.'],
    ['Only play what you may play', 'Your own songs, or covers you have the right to perform. If a rights holder complains, we may take a recording down. YouTube applies its own rules, including strikes; originals only in the public product.'],
    ['You keep 72.5%', 'Of the tokens fans send you. You cash out once your identity is checked.'],
    ['Conduct', 'Treat your audience decently. Shows that break the Community Guidelines can be stopped.'],
    ['Leaving', 'Close your account whenever you like. Your recordings come down, your YouTube connection is removed and the tokens deleted; we keep only what the law requires. What is already on your own YouTube channel is yours to remove there.'],
  ];
  return (
    <div className="v-col" style={{ gap: 12 }} data-testid="artist-agreement">
      <p className="v-muted" style={{ fontSize: 15 }}>The plain version is below. The full agreement is linked at the bottom, and it is the version that counts. <strong>DRAFT, pending legal review.</strong></p>
      {rows.map(([t, b]) => <div key={t} className="v-col" style={{ gap: 2 }}><span style={{ fontSize: 17, fontWeight: 700 }}>{t}</span><span style={{ fontSize: 15, lineHeight: 1.35 }}>{b}</span></div>)}
      <div style={{ padding: 12, borderRadius: 12, background: 'rgba(46,196,182,0.14)' }} className="v-col">
        <span style={{ fontSize: 17, fontWeight: 700 }}>Helping the director learn</span>
        <span style={{ fontSize: 15, lineHeight: 1.35 }}>We would like to use your show footage to improve how Loudentify chooses camera angles. This is separate and optional. Say no and nothing about your account changes.</span>
        <label className="v-row" style={{ justifyContent: 'space-between', marginTop: 8 }}><span style={{ fontWeight: 700 }}>Use my footage to improve the director</span><input type="checkbox" role="switch" aria-checked={training} checked={training} onChange={(e) => setTraining(e.target.checked)} style={{ width: 44, height: 24 }} /></label>
        <span className="v-muted" style={{ fontSize: 14 }}>You can change this any time in Settings. Turning it off later stops future use.</span>
      </div>
      <a className="v-link" href="/terms#artist-agreement">Read the full agreement</a>
      <button className="v-btn v-btn-lg v-btn-teal" onClick={() => onDone(training)} data-testid="agree-continue">Agree and continue</button>
    </div>
  );
}

function YouTubeStep({ yt, busy, onConnect, onRecheck, onDisconnect }) {
  const c = yt?.connection;
  return (
    <div className="v-col" style={{ gap: 10 }} data-testid="youtube-step">
      {!c?.connected ? (
        <>
          <p style={{ fontSize: 16, lineHeight: 1.35 }}>Your shows are streamed to your own YouTube channel, and viewers watch them inside Loudentify. We ask for the smallest permission that lets us create and end a broadcast. You can disconnect any time.</p>
          {yt?.mode === 'mock' && <div className="v-error" role="note" style={{ background: 'rgba(255,159,28,0.18)' }}><span style={{ color: 'var(--orange)' }}><Warn /></span><span style={{ fontSize: 14 }}><strong>Test mode.</strong> Google verification is not in place yet, so this connects a mock channel that behaves like a real one. See NEEDS_KOREY.</span></div>}
          <button className="v-btn v-btn-lg v-btn-ink" disabled={busy} onClick={onConnect} data-testid="connect-youtube">{busy ? 'Connecting' : 'Connect YouTube'}</button>
        </>
      ) : (
        <>
          <div className="v-row" style={{ gap: 10 }}><span className="v-icon-btn" style={{ background: c.live_enabled ? 'var(--silk-teal)' : 'rgba(255,159,28,0.3)' }}>{c.live_enabled ? <Check /> : <Warn />}</span><span className="v-col" style={{ gap: 2 }}><span style={{ fontWeight: 700 }}>{c.channel_title || c.channel_id}</span><span className="v-muted" style={{ fontSize: 14 }}>{c.live_enabled ? 'Live streaming is enabled on this channel.' : c.readiness_error || 'Checking whether live streaming is enabled.'}</span></span></div>
          <div className="v-row" style={{ gap: 8, flexWrap: 'wrap' }}><button className="v-btn v-btn-ghost-light" onClick={onRecheck}>Check again</button><button className="v-btn v-btn-ghost-light" onClick={onDisconnect}>Disconnect</button></div>
        </>
      )}
    </div>
  );
}

function MicStep({ places, userId, onSaved }) {
  const [devices, setDevices] = useState(null); const [mic, setMic] = useState(null); const [name, setName] = useState(places?.[0]?.name || 'Living room'); const [busy, setBusy] = useState(false);
  useEffect(() => {
    (async () => {
      try { const list = await navigator.mediaDevices.enumerateDevices(); const mics = list.filter((d) => d.kind === 'audioinput'); setDevices(mics); if (mics[0]) setMic(mics[0]); }
      catch { setDevices([]); }
    })();
  }, []);
  return (
    <div className="v-col" style={{ gap: 10 }}>
      <label className="v-field">Place<input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="Living room" /></label>
      <span className="v-kicker v-muted">Microphone</span>
      {devices === null ? <Skeleton h={44} /> : devices.length ? devices.map((d, i) => <button key={d.deviceId || i} className="v-btn v-btn-ghost-light" aria-pressed={mic?.deviceId === d.deviceId} style={{ justifyContent: 'flex-start', border: mic?.deviceId === d.deviceId ? '2px solid var(--ink)' : '2px solid transparent' }} onClick={() => setMic(d)}>{d.label || `Microphone ${i + 1}`}</button>) : <span className="v-muted">No microphone found yet. Kit Check will ask for microphone access.</span>}
      <button className="v-btn v-btn-teal" disabled={busy || !name.trim()} onClick={async () => { setBusy(true); const sb = getSupabase(); const existing = places?.[0]; const row = { artist_id: userId, name: name.trim(), mic_label: mic?.label || 'Phone microphone', mic_device_id: mic?.deviceId || null }; if (existing) await sb.from('places').update(row).eq('id', existing.id); else await sb.from('places').insert(row); setBusy(false); onSaved(); }}>Save my first place</button>
    </div>
  );
}
