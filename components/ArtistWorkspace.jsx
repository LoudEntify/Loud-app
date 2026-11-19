'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getSupabase } from '../lib/supabaseClient';
import InvitedShows from './InvitedShows';
import styles from '../styles/AccountDashboard.module.css';

export default function ArtistWorkspace({ profile, accessToken }) {
  const [shows, setShows] = useState(null);
  const [unavailable, setUnavailable] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setUnavailable(false);
    setShows(null);
    (async () => {
      try {
        const { data, error } = await getSupabase().from('shows').select('*')
          .eq('artist_id', profile.id).neq('state', 'ended')
          .order('slated_at', { ascending: true }).limit(5);
        if (!alive) return;
        if (error) { setUnavailable(true); return; }
        const now = Date.now();
        setShows((data || []).filter(show => {
          const start = new Date(show.slated_at).getTime();
          return Number.isFinite(start) && start + (show.duration_minutes || 60) * 60000 > now;
        }));
      } catch { if (alive) setUnavailable(true); }
    })();
    return () => { alive = false; };
  }, [profile.id, attempt]);

  const checks = [
    { title: 'Make your profile yours', detail: 'Your name, handle and account details.', complete: !!(profile.display_name && profile.username && profile.country), href: '/settings', action: 'Edit profile' },
    { title: 'Introduce your sound', detail: 'Add a short bio and the genres you perform.', complete: !!(profile.bio?.trim() && profile.genres?.length), href: '/settings', action: 'Add your sound' },
  ];
  const completed = checks.filter(check => check.complete).length;

  return <div className={styles.workspace}>
    <InvitedShows accessToken={accessToken} className={styles.invitedPanel} />
    <section className={styles.setupPanel} aria-labelledby="artist-setup-title">
      <div className={styles.panelHeader}><div><span className={styles.eyebrow}>YOUR FIRST STEPS</span><h2 id="artist-setup-title">Get ready for your stage.</h2></div><span className={styles.setupCount}>{completed}/{checks.length}</span></div>
      <progress className={styles.setupProgress} value={completed} max={checks.length} aria-label="Artist profile setup" />
      {checks.map(check => <div className={styles.setupStep} key={check.title}><span className={`${styles.stepIcon} ${check.complete ? styles.stepComplete : ''}`} aria-label={check.complete ? 'Complete' : 'To do'}>{check.complete ? '✓' : '○'}</span><div><h3>{check.title}</h3><p>{check.detail}</p></div><Link href={check.href}>{check.complete ? 'Edit' : check.action} <span aria-hidden="true">↗</span></Link></div>)}
      <div className={styles.kitStep}><span aria-hidden="true">♫</span><div><h3>Camera. Sound. Ready.</h3><p>Check your equipment and practise before a performance.</p></div><Link href="/kit-check">Open kit check ↗</Link></div>
    </section>
    <section className={styles.showPanel} aria-labelledby="artist-shows-title">
      <span className={styles.eyebrow}>ON YOUR CALENDAR</span><h2 id="artist-shows-title">Your next performance.</h2>
      {unavailable ? <><p role="status">Your scheduled shows aren’t available right now. You can still finish your profile and check your equipment.</p><button className={styles.retry} type="button" onClick={() => setAttempt(value => value + 1)}>Try again</button></> : !shows ? <p role="status">Loading your performances…</p> : shows.length === 0 ? <><span className={styles.calendarIcon} aria-hidden="true">▦</span><h3>Your stage is ready when you are.</h3><p>No upcoming performances yet. Choose a date, format and duration to put your next show on the calendar.</p><Link href="/schedule" className={styles.subtleLink}>Schedule a performance →</Link></> : <><ul className={styles.showList}>{shows.map(show => <li key={show.id}><span>{new Date(show.slated_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span><h3>{show.title || 'Your upcoming performance'}</h3><p>{show.performance_mode === 'versus' ? 'Versus performance' : 'Solo performance'} · {show.duration_minutes || 60} minutes</p><Link href="/kit-check">Prepare your equipment →</Link></li>)}</ul><Link href="/schedule" className={styles.subtleLink}>Manage your schedule →</Link></>}
    </section>
  </div>;
}
