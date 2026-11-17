'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getSession, ensureProfile } from '../lib/supabaseAuth';
import ArtistWorkspace from './ArtistWorkspace';
import RequireAuth from './RequireAuth';
import PageShell from './PageShell';
import styles from '../styles/AccountDashboard.module.css';

function DashboardContent({ accountRole }) {
  const router = useRouter();
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError('');
    (async () => {
      try {
        const session = await getSession();
        if (!session?.user) return;
        const result = await ensureProfile(session.user);
        if (cancelled) return;
        if (result.error || !['artist', 'viewer'].includes(result.profile?.role)) {
          setError('We couldn’t load your account profile. Please try again or contact build@loudentify.app.');
          return;
        }
        const role = result.profile.role === 'artist' ? 'artist' : 'fan';
        if (role !== accountRole) {
          router.replace(`/dashboard/${role}`);
          return;
        }
        setProfile(result.profile);
      } catch {
        if (!cancelled) setError('We couldn’t reach your account. Check your connection and try again.');
      }
    })();
    return () => { cancelled = true; };
  }, [accountRole, router, attempt]);

  if (error) return <div className={styles.container}><p role="alert">{error}</p><button className={styles.retry} onClick={() => setAttempt(value => value + 1)}>Try again</button></div>;
  if (!profile) return <div className={styles.container} role="status">Loading your dashboard…</div>;

  const artist = accountRole === 'artist';
  const actions = artist ? [
    { title: 'Your artist profile', description: 'Update your display name, genres and artist bio.', href: '/settings', label: 'Edit your profile', number: '01' },
    { title: 'Your recorded shows', description: 'Find your recordings and revisit past performances.', href: '/shows', label: 'View recordings', number: '02' },
    { title: 'Get stage ready', description: 'Check your camera and microphone before your next performance.', href: '/kit-check', label: 'Run kit check', number: '03' },
  ] : [
    { title: 'Find your next favourite', description: 'Explore artists and discover performances worth being there for.', href: '/discover', label: 'Discover music', number: '01' },
    { title: 'Your fan profile', description: 'Make this space yours and manage your music preferences.', href: '/profile', label: 'View your profile', number: '02' },
    { title: 'Stay in the loop', description: 'Catch up with your latest Loudentify notifications.', href: '/notifications', label: 'View notifications', number: '03' },
  ];

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <span className={styles.eyebrow}>{artist ? 'ARTIST' : 'FAN'} DASHBOARD</span>
        <h1>Welcome back, <span>{profile.display_name || profile.username || (artist ? 'artist' : 'music lover')}.</span></h1>
        <p>{artist ? 'Your music. Your stage. Everything you need for your next performance.' : 'Your front row starts here. Find the music and artists you love.'}</p>
        <Link href={artist ? (profile.bio?.trim() && profile.genres?.length ? '/kit-check' : '/settings') : '/discover'} className={styles.primary}>{artist ? (profile.bio?.trim() && profile.genres?.length ? 'Check your camera and sound' : 'Finish your artist profile') : 'Explore performances'} <span aria-hidden="true">↗</span></Link>
      </header>
      {artist && <ArtistWorkspace profile={profile} />}
      <section className={styles.cards} aria-label={artist ? 'Artist tools' : 'Your fan space'}>
        {actions.map(action => <Link key={action.href} href={action.href} className={styles.card}><span className={styles.number}>{action.number}</span><h2>{action.title}</h2><p>{action.description}</p><strong>{action.label} <span aria-hidden="true">→</span></strong></Link>)}
      </section>
      <footer className={styles.footer}><span>Your account, your way.</span><Link href="/settings">Account settings →</Link></footer>
    </div>
  );
}

export default function AccountDashboard({ accountRole }) {
  const signInPath = accountRole ? `/auth/${accountRole}` : '/auth';
  return <RequireAuth signInPath={signInPath}><PageShell active="dashboard"><DashboardContent accountRole={accountRole} /></PageShell></RequireAuth>;
}
