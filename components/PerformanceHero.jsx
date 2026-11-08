
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import styles from "./PerformanceHero.module.css";

// DEMO DATA.
// Replace these entries with published shows from your backend.
// Do not display demo dates as real bookings or confirmed events.

const performances = [
  {
    id: "demo-1",
    title: "Afrobeats After Dark",
    artist: "Loudentify Showcase",
    genre: "Afrobeats",
    description:
      "Feel the rhythm, the energy and the connection of a live Afrobeats experience.",
    image:
      "https://images.unsplash.com/photo-1459749411175-04bf5292ceea?auto=format&fit=crop&w=2000&q=85",
    label: "SHOWCASE PREVIEW",
    date: "Coming soon",
  },
  {
    id: "demo-2",
    title: "Soul Sessions",
    artist: "Loudentify Showcase",
    genre: "R&B",
    description:
      "An intimate performance experience where every note tells a story.",
    image:
      "https://images.unsplash.com/photo-1516280440614-37939bbacd81?auto=format&fit=crop&w=2000&q=85",
    label: "SHOWCASE PREVIEW",
    date: "Coming soon",
  },
  {
    id: "demo-3",
    title: "The Hip-Hop Stage",
    artist: "Loudentify Showcase",
    genre: "Hip-Hop",
    description:
      "Raw energy, powerful performances and a front-row experience.",
    image:
      "https://images.unsplash.com/photo-1501386761578-eac5c94b800a?auto=format&fit=crop&w=2000&q=85",
    label: "SHOWCASE PREVIEW",
    date: "Coming soon",
  },
  {
    id: "demo-4",
    title: "The Jazz Room",
    artist: "Loudentify Showcase",
    genre: "Jazz",
    description:
      "Step into an atmospheric world of improvisation and live instrumentation.",
    image:
      "https://images.unsplash.com/photo-1511196044526-5cb3bcb7071b?auto=format&fit=crop&w=2000&q=85",
    label: "SHOWCASE PREVIEW",
    date: "Coming soon",
  },
];

const genres = [
  "For You",
  "Afrobeats",
  "R&B",
  "Hip-Hop",
  "Jazz",
];

export default function PerformanceHero({
  preferredGenres = [],
}) {
  const [selectedGenre, setSelectedGenre] = useState("For You");
  const [activeIndex, setActiveIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  const rankedPerformances = useMemo(() => {
    if (selectedGenre !== "For You") {
      return performances.filter(
        (performance) =>
          performance.genre === selectedGenre
      );
    }

    const preferences = preferredGenres.map((genre) =>
      genre.toLowerCase()
    );

    return [...performances].sort((a, b) => {
      const aScore = preferences.includes(
        a.genre.toLowerCase()
      ) ? 1 : 0;

      const bScore = preferences.includes(
        b.genre.toLowerCase()
      ) ? 1 : 0;

      return bScore - aScore;
    });
  }, [selectedGenre, preferredGenres]);

  const count = rankedPerformances.length;

  useEffect(() => {
    setActiveIndex(0);
  }, [selectedGenre, preferredGenres]);

  useEffect(() => {
    if (paused || count <= 1) return;

    const interval = setInterval(() => {
      setActiveIndex((current) => (current + 1) % count);
    }, 6500);

    return () => clearInterval(interval);
  }, [paused, count]);

  const next = () => {
    setActiveIndex((current) => (current + 1) % count);
  };

  const previous = () => {
    setActiveIndex(
      (current) => (current - 1 + count) % count
    );
  };

  const active =
    rankedPerformances[activeIndex] ||
    rankedPerformances[0];

  if (!active) return null;

  return (
    <section
      className={styles.hero}
      aria-label="Featured performance previews"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setPaused(false);
        }
      }}
    >
      {rankedPerformances.map((performance, index) => (
        <div
          key={performance.id}
          className={`${styles.slide} ${
            index === activeIndex ? styles.active : ""
          }`}
          style={{
            backgroundImage: `url("${performance.image}")`,
          }}
          aria-hidden={index !== activeIndex}
        />
      ))}

      <div className={styles.gradient} />

      <div className={styles.content}>
        <div className={styles.topLabel}>
          <span className={styles.dot} />
          CURATED FOR YOUR MUSIC TASTE
        </div>

        <div className={styles.genreTabs}>
          {genres.map((genre) => (
            <button
              key={genre}
              type="button"
              className={
                selectedGenre === genre
                  ? styles.selectedGenre
                  : ""
              }
              onClick={() => setSelectedGenre(genre)}
              aria-pressed={selectedGenre === genre}
            >
              {genre}
            </button>
          ))}
        </div>

        <div className={styles.heroCopy} key={active.id}>
          <div className={styles.meta}>
            <span className={styles.previewBadge}>
              {active.label}
            </span>
            <span>{active.genre}</span>
            <span>{active.date}</span>
          </div>

          <h1>{active.title}</h1>

          <p className={styles.artist}>
            {active.artist}
          </p>

          <p className={styles.description}>
            {active.description}
          </p>

          <div className={styles.actions}>
            <Link
              href="/early-access"
              className={styles.primaryButton}
            >
              <span aria-hidden="true">▶</span>
              Get Early Access
            </Link>

            <a
              href="#experience"
              className={styles.secondaryButton}
            >
              Discover Loudentify
            </a>
          </div>
        </div>
      </div>

      <div className={styles.controls}>
        <div className={styles.indicators}>
          {rankedPerformances.map((performance, index) => (
            <button
              type="button"
              key={performance.id}
              aria-label={`Show ${performance.title}`}
              aria-current={index === activeIndex ? "true" : undefined}
              className={
                index === activeIndex
                  ? styles.activeIndicator
                  : ""
              }
              onClick={() => setActiveIndex(index)}
            />
          ))}
        </div>

        <div className={styles.arrows}>
          <button
            type="button"
            onClick={previous}
            aria-label="Previous performance"
          >
            ←
          </button>

          <button
            type="button"
            onClick={next}
            aria-label="Next performance"
          >
            →
          </button>
        </div>
      </div>
    </section>
  );
}
