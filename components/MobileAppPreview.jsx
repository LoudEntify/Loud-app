'use client';

import { useState } from 'react';
import Link from 'next/link';
import Logo from './Logo';
import styles from '../styles/MobileAppPreview.module.css';

function Icon({ type }) {
  const paths = {
    home: 'm3 10 9-7 9 7v10H3V10Zm6 10v-7h6v7',
    search: 'M20 20l-5-5M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z',
    heart: 'M20 5c-3-3-7-1-8 1-1-2-5-4-8-1-4 4 1 9 8 15 7-6 12-11 8-15Z',
    person: 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21v-2a8 8 0 0 1 16 0v2',
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[type]} /></svg>;
}

export default function MobileAppPreview() {
  const [paused, setPaused] = useState(false);
  return (
    <section className={`${styles.section} ${paused ? styles.paused : ''}`} aria-labelledby="mobile-app-title">
      <div className={styles.copy}>
        <span className={styles.eyebrow}>THE NEXT STAGE · MOBILE</span>
        <h2 id="mobile-app-title">Your front row.<br /><span>To go.</span></h2>
        <p>The energy of the stage, wherever you are. A first look at the Loudentify mobile experience we’re building.</p>
        <ul className={styles.features}>
          <li><span>01</span> Discover your next favourite artist</li>
          <li><span>02</span> Get closer with multiple camera angles</li>
          <li><span>03</span> React together. Feel every moment.</li>
        </ul>
        <Link href="/early-access" className={styles.cta}>Get early access <span aria-hidden="true">↗</span></Link>
        <small>Mobile app concept · Coming soon</small>
      </div>

      <div className={styles.stage}>
        <div className={styles.orbit} aria-hidden="true" />
        <div className={styles.phone} role="img" aria-label="Loudentify mobile app concept showing a Soul Sessions performance, camera angles, audience reactions, and music discovery navigation.">
          <div className={styles.screen} aria-hidden="true">
            <div className={styles.status}><span>9:41</span><i /><span>▥ ▰</span></div>
            <div className={styles.appHeader}><Logo height={24} /><span className={styles.avatar}>J</span></div>
            <div className={styles.greeting}><small>YOUR SOUND. YOUR PEOPLE.</small><strong>Find your front row.</strong></div>
            <div className={styles.tabs}><span className={styles.selected}>For you</span><span>Afrobeats</span><span>R&B</span><span>Jazz</span></div>
            <div className={styles.performance}>
              <div className={styles.previewLabel}><i /> SHOWCASE PREVIEW</div>
              <div className={styles.reactions}><span>♡</span><span>♫</span><span>♡</span></div>
              <div className={styles.performanceInfo}><small>THE SOUND ROOM</small><h3>Soul Sessions</h3><p>Loudentify Showcase</p><div className={styles.nowPlaying}><span className={styles.equalizer}>{Array.from({ length: 12 }, (_, i) => <i key={i} style={{ '--i': i }} />)}</span><span>FEEL EVERY NOTE</span></div></div>
            </div>
            <div className={styles.cameraLabel}><strong>Every angle. Closer.</strong><span>MULTI-CAM</span></div>
            <div className={styles.cameras}><div><span>01 · MAIN STAGE</span></div><div><span>02 · UP CLOSE</span></div><div><span>03 · THE ROOM</span></div></div>
            <div className={styles.appNav}>{[['home', 'Home'], ['search', 'Discover'], ['heart', 'Saved'], ['person', 'You']].map(([type, label]) => <div key={type}><Icon type={type} /><span>{label}</span></div>)}</div>
            <div className={styles.homeBar} />
          </div>
        </div>
        <div className={styles.floatingNote} aria-hidden="true"><span className={styles.noteIcon}>♫</span><div><strong>One stage. Every angle.</strong><span>A little closer to the music.</span></div></div>
        <div className={styles.reactionNote} aria-hidden="true"><span>♡</span> MADE TO FEEL LIVE</div>
        <button className={styles.motionControl} type="button" onClick={() => setPaused(value => !value)} aria-pressed={paused}>{paused ? '▶ Play animation' : 'Ⅱ Pause animation'}</button>
      </div>
    </section>
  );
}
