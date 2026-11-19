'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { fetchLiveShows, fetchUpcomingShows } from '../lib/discoveryFeed';
import { fetchFollowedArtistIds } from '../lib/follows';
import { syncFanShowNotifications } from '../lib/scheduling';
import styles from '../styles/AccountDashboard.module.css';

function ShowRow({ show, live }) {
  return (
    <Link href={show.href} className={styles.fanShowRow}>
      <span className={live ? styles.liveDot : styles.upcomingDot} aria-hidden="true" />
      <span className={styles.fanShowCopy}>
        <strong>{show.title}</strong>
        <small>{show.subtitle}</small>
      </span>
      <span className={live ? styles.liveTag : styles.upcomingTag}>{live ? 'WATCH LIVE' : 'VIEW SHOW'}</span>
    </Link>
  );
}

export default function FanWorkspace({ userId }) {
  const [state, setState] = useState({ loading: true, live: [], upcoming: [], follows: 0 });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [{ ids }, live, upcoming] = await Promise.all([
        fetchFollowedArtistIds(userId),
        fetchLiveShows(),
        fetchUpcomingShows({ limit: 12 }),
      ]);
      if (cancelled) return;
      const fromFollowed = (show) => ids.has(show.row?.artist_id);
      const followedLive = live.filter(fromFollowed);
      const followedUpcoming = upcoming.filter(fromFollowed).slice(0, 4);
      setState({
        loading: false,
        live: followedLive,
        upcoming: followedUpcoming,
        follows: ids.size,
      });
      syncFanShowNotifications(userId, { live: followedLive, upcoming: followedUpcoming }).catch(() => {});
    })();
    return () => { cancelled = true; };
  }, [userId]);

  return (
    <section className={styles.fanWorkspace} aria-labelledby="fan-front-row">
      <div className={styles.fanWorkspaceHeader}>
        <div>
          <span className={styles.eyebrow}>YOUR MUSIC</span>
          <h2 id="fan-front-row">Your front row.</h2>
        </div>
        <Link href="/discover">Discover artists →</Link>
      </div>

      {state.loading ? (
        <p className={styles.fanStatus} role="status">Checking who is playing…</p>
      ) : state.live.length > 0 || state.upcoming.length > 0 ? (
        <div className={styles.fanShowList}>
          {state.live.map((show) => <ShowRow key={show.id} show={show} live />)}
          {state.upcoming.map((show) => <ShowRow key={show.id} show={show} />)}
        </div>
      ) : (
        <div className={styles.fanEmpty}>
          <strong>{state.follows ? 'Nothing scheduled from your artists yet.' : 'Your front row is waiting.'}</strong>
          <p>{state.follows ? 'When an artist you follow schedules or starts a show, it appears here.' : 'Follow artists you love and their live and upcoming shows will appear here automatically.'}</p>
          <Link href="/discover">{state.follows ? 'Explore more artists' : 'Find artists to follow'} →</Link>
        </div>
      )}
    </section>
  );
}
