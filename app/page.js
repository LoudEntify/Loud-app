
import Link from "next/link";
import styles from "../styles/streaming-home.module.css";
import PerformanceHero from "../components/PerformanceHero";
import ExperienceCarousel from "../components/ExperienceCarousel";
import Footer from "../components/Footer";
import Navbar from "../components/Navbar";
import MobileAppPreview from "../components/MobileAppPreview";

export const metadata = {
  title: "Loudentify | Live Music, Reimagined",
  description:
    "Discover a new way to experience live music. Multi-camera performances, artist-led shows and real-time fan experiences.",
};

const collections = [
  {
    title: "The Live Experience",
    subtitle: "A new way to be part of the show",
    items: [
      {
        title: "The Main Stage",
        category: "LIVE PERFORMANCE",
        tag: "COMING SOON",
        theme: "purple",
        art: "stage",
      },
      {
        title: "Up Close",
        category: "INTIMATE SESSIONS",
        tag: "EARLY ACCESS",
        theme: "orange",
        art: "mic",
      },
      {
        title: "The Sound Room",
        category: "STUDIO SESSIONS",
        tag: "COMING SOON",
        theme: "blue",
        art: "sound",
      },
      {
        title: "After Hours",
        category: "LATE NIGHT MUSIC",
        tag: "COMING SOON",
        theme: "red",
        art: "night",
      },
    ],
  },
  {
    title: "Find Your Sound",
    subtitle: "Every mood deserves a stage",
    items: [
      {
        title: "Afrobeats",
        category: "RHYTHM & ENERGY",
        theme: "orange",
        art: "afro",
      },
      {
        title: "R&B / Soul",
        category: "FEEL EVERY NOTE",
        theme: "purple",
        art: "soul",
      },
      {
        title: "Hip-Hop",
        category: "BEATS & BARS",
        theme: "red",
        art: "hiphop",
      },
      {
        title: "Jazz",
        category: "THE ART OF SOUND",
        theme: "blue",
        art: "jazz",
      },
      {
        title: "Gospel",
        category: "MUSIC THAT MOVES",
        theme: "green",
        art: "gospel",
      },
    ],
  },
];

function PlayIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M7 3.5a1 1 0 0 1 1.5-.86l12 8.5a1 1 0 0 1 0 1.72l-12 8.5A1 1 0 0 1 7 20.5z" />
    </svg>
  );
}

function ArrowIcon() {
  return <span aria-hidden="true">↗</span>;
}

function Experience() {
  return (
    <section id="experience" className={styles.experience}>
      <div className={styles.experienceVisual}>
        <div className={styles.playerTop}>
          <span><span className={styles.pulse} /> MULTI-CAMERA CONCEPT</span>
          <span>CAM 01</span>
        </div>

        <div className={styles.playerStage}>
          <div className={styles.playerGlow} />

          <div className={styles.playerCenter}>
            <span>THE LOUDENTIFY EXPERIENCE</span>
            <h3>Every angle.<br />Every moment.</h3>
          </div>
        </div>

        <div className={styles.playerCameras}>
          <div className={styles.selectedCamera}>CAM 01 <span>MAIN</span></div>
          <div>CAM 02 <span>SIDE</span></div>
          <div>CAM 03 <span>WIDE</span></div>
        </div>
      </div>

      <div className={styles.experienceText}>
        <div className={styles.overline}>BEYOND THE STREAM</div>
        <h2>
          NOT JUST LIVE.
          <br />
          <span>ALIVE.</span>
        </h2>

        <p>
          Loudentify brings the energy of a real performance
          into the digital world.
        </p>

        <div className={styles.experienceFeatures}>
          <div>
            <strong>01 / MULTI-CAMERA</strong>
            <span>Experience the performance from different angles.</span>
          </div>
          <div>
            <strong>02 / LIVE INTERACTION</strong>
            <span>React, comment and connect in real time.</span>
          </div>
          <div>
            <strong>03 / ARTIST-LED</strong>
            <span>Discover performances created by the artists themselves.</span>
          </div>
        </div>

        <Link href="/early-access" className={styles.textLink}>
          Be part of the experience <ArrowIcon />
        </Link>
      </div>
    </section>
  );
}

function ArtistBanner() {
  return (
    <section id="artists" className={styles.artistBanner}>
      <div className={styles.artistBannerGlow} />
      <div className={styles.artistContent}>
        <span className={styles.overline}>FOR THE CREATORS</span>
        <h2>
          YOUR MUSIC.
          <br />
          YOUR STAGE.
          <br />
          <span>YOUR RULES.</span>
        </h2>
        <p>
          Turn the phones you own into a live production setup.
          Create multi-camera performances, build your audience
          and put on a show worth remembering.
        </p>
        <Link href="/early-access" className={styles.primaryButton}>
          Join as an Artist <ArrowIcon />
        </Link>
      </div>
      <div className={styles.artistDecor} aria-hidden="true">
        <div className={styles.artistRecord}><span>THE ARTIST’S PERSPECTIVE</span><strong>Made by you.<br /><em>Felt by everyone.</em></strong><span>INDEPENDENT SOUND. SHARED ENERGY.</span></div>
      </div>
    </section>
  );
}

function BottomCTA() {
  return (
    <section className={styles.bottomCTA}>
      <span className={styles.overline}>YOUR FRONT ROW SEAT AWAITS</span>
      <h2>
        SOMETHING BIG
        <br />
        IS ABOUT TO <span>GO LIVE.</span>
      </h2>
      <p>
        Join the Loudentify waitlist and get ready for
        a new era of live music.
      </p>
      <Link href="/early-access" className={styles.primaryButton}>
        <PlayIcon /> Join the Waitlist
      </Link>
      <small>PREPARING FOR JANUARY 2027</small>
    </section>
  );
}

export default function HomePage() {
  return (
    <main className={styles.page}>
      <Navbar />
      <PerformanceHero preferredGenres={["Afrobeats", "R&B"]} />
      <div className={styles.manifesto} aria-label="The Loudentify experience"><span>INDEPENDENT ARTISTS</span><i aria-hidden="true">✦</i><span>EVERY ANGLE</span><i aria-hidden="true">✦</i><span>REAL CONNECTION</span><i aria-hidden="true">✦</i><span>ONE SHARED MOMENT</span></div>

      <div id="discover" className={styles.discover}>
        {collections.map((collection, index) => (
            <ExperienceCarousel
              key={collection.title}
              collection={collection}
              index={index}
            />
          ))}
      </div>

      <Experience />
      <ArtistBanner />
      <MobileAppPreview />
      <BottomCTA />
      <Footer />
    </main>
  );
}
