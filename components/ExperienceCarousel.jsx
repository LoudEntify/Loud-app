'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import styles from '../styles/ExperienceCarousel.module.css';

const photos = {
  stage: 'photo-1459749411175-04bf5292ceea',
  mic: 'photo-1516280440614-37939bbacd81',
  sound: 'photo-1511196044526-5cb3bcb7071b',
  night: 'photo-1501386761578-eac5c94b800a',
  afro: 'photo-1501386761578-eac5c94b800a',
  soul: 'photo-1516280440614-37939bbacd81',
  hiphop: 'photo-1459749411175-04bf5292ceea',
  jazz: 'photo-1511196044526-5cb3bcb7071b',
  gospel: 'photo-1516280440614-37939bbacd81',
};
const descriptions = {
  stage: 'Big sound. Shared energy. The feeling of being right there.',
  mic: 'Intimate performances. Every voice, every detail, closer.',
  sound: 'Step inside the creative space. Hear the music come alive.',
  night: 'Low lights, late nights, and a sound that stays with you.',
};

export default function ExperienceCarousel({ collection, index = 0 }) {
  const track = useRef(null);
  const id = useId();
  const [position, setPosition] = useState({ start: 0, end: 0, prev: false, next: false });
  const genres = index !== 0;

  useEffect(() => {
    const element = track.current;
    if (!element) return;
    const update = () => {
      const viewport = element.getBoundingClientRect();
      const visible = Array.from(element.children).map((card, i) => {
        const rect = card.getBoundingClientRect();
        const overlap = Math.min(rect.right, viewport.right) - Math.max(rect.left, viewport.left);
        return overlap >= rect.width / 2 ? i : -1;
      }).filter(i => i >= 0);
      setPosition({
        start: visible[0] ?? 0,
        end: visible.at(-1) ?? 0,
        prev: element.scrollLeft > 3,
        next: element.scrollLeft + element.clientWidth < element.scrollWidth - 3,
      });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    element.addEventListener('scroll', update, { passive: true });
    return () => { observer.disconnect(); element.removeEventListener('scroll', update); };
  }, [collection.items.length]);

  function move(direction) {
    const element = track.current;
    const cards = Array.from(element?.children || []);
    if (!element || !cards.length) return;
    const origin = cards[0].offsetLeft;
    const points = cards.map(card => card.offsetLeft - origin);
    const current = element.scrollLeft;
    const target = direction > 0
      ? points.find(point => point > current + 4) ?? element.scrollWidth
      : [...points].reverse().find(point => point < current - 4) ?? 0;
    element.scrollTo({ left: target, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  }

  return (
    <section className={`${styles.section} ${genres ? styles.genres : ''}`} aria-labelledby={`${id}-title`} aria-roledescription="carousel">
      <header className={styles.header}>
        <div><span className={styles.eyebrow}>{genres ? '02 / FIND YOUR FREQUENCY' : '01 / MORE THAN A STREAM'}</span><h2 id={`${id}-title`}>{collection.title}</h2><p>{collection.subtitle}</p></div>
        <div className={styles.controls}>
          <button type="button" onClick={() => move(-1)} disabled={!position.prev} aria-label={`Previous ${genres ? 'genres' : 'experiences'}`} aria-controls={`${id}-track`}>←</button>
          <button type="button" onClick={() => move(1)} disabled={!position.next} aria-label={`Next ${genres ? 'genres' : 'experiences'}`} aria-controls={`${id}-track`}>→</button>
        </div>
      </header>
      <div className={styles.track} ref={track} id={`${id}-track`} tabIndex={0} aria-label={`${collection.title}: scroll to browse`} onKeyDown={event => {
        if (event.target !== event.currentTarget) return;
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); move(event.key === 'ArrowRight' ? 1 : -1); }
      }}>
        {collection.items.map((item, i) => <Link key={item.title} className={styles.card} href="/early-access" aria-label={`${item.title} — get early access`}>
          <div className={styles.image} style={{ backgroundImage: `linear-gradient(180deg, #06101b15 25%, #06101bd9 100%), url("https://images.unsplash.com/${photos[item.art]}?auto=format&fit=crop&w=900&q=85")` }}>
            <span className={styles.tag}>{item.tag || 'EXPLORE THE SOUND'}</span><span className={styles.number}>0{i + 1}</span>
            <div className={styles.imageCaption}><span>{item.category}</span><h3>{item.title}</h3></div>
          </div>
          <div className={styles.cardBody}>{!genres && <p>{descriptions[item.art]}</p>}<span className={styles.cardCta}>Get early access <span aria-hidden="true">↗</span></span></div>
        </Link>)}
      </div>
      <footer className={styles.footer}>
        <span className={styles.range} aria-live="polite" aria-atomic="true">{String(position.start + 1).padStart(2, '0')}{position.end !== position.start ? `–${String(position.end + 1).padStart(2, '0')}` : ''} <span>/ {String(collection.items.length).padStart(2, '0')}</span></span>
        <div className={styles.progress} aria-hidden="true"><span style={{ width: `${(position.end - position.start + 1) / collection.items.length * 100}%`, left: `${position.start / collection.items.length * 100}%` }} /></div>
        <Link href="/early-access">Join the first wave <span aria-hidden="true">↗</span></Link>
      </footer>
    </section>
  );
}
