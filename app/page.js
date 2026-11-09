
import Link from "next/link";
import Logo from "../components/Logo";
import styles from "../styles/streaming-home.module.css";
import PerformanceHero from "../components/PerformanceHero";
import AutoScrollRow from "../components/AutoScrollRow";

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

function Navbar() {
  return (
    <header className={styles.navbar}>
      <div className={styles.navInner}>
        <Link href="/" className={styles.logo} aria-label="Loudentify homepage">
          <Logo surface="dark" height={36} />
        </Link>

        <nav className={styles.navLinks} aria-label="Main navigation">
          <a href="#discover">Discover</a>
          <a href="#experience">The Experience</a>
          <a href="#artists">For Artists</a>
        </nav>

        <div className={styles.navActions}>
          <Link href="/auth" className={styles.signIn}>Sign In</Link>
          <Link href="/early-access" className={styles.joinButton}>
            Join Early Access
          </Link>
        </div>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className={styles.hero}>
      <div className={styles.heroArtwork} aria-hidden="true">
        <div className={styles.heroLightLeft} />
        <div className={styles.heroLightRight} />
        <div className={styles.heroBeam} />
        <div className={styles.heroPerson}>
          <div className={styles.personHead} />
          <div className={styles.personBody} />
          <div className={styles.personArm} />
          <div className={styles.personMic} />
        </div>
        <div className={styles.heroCrowd} />
      </div>

      <div className={styles.heroContent}>
        <div className={styles.heroBadge}>
          <span className={styles.pulse} />
          THE FUTURE OF LIVE MUSIC
        </div>

        <div className={styles.heroMeta}>
          LOUDENTIFY ORIGINAL EXPERIENCE
        </div>

        <h1>
          THE STAGE
          <br />
          IS <span>EVERYWHERE.</span>
        </h1>

        <p className={styles.heroDescription}>
          Real artists. Real performances. Real connection.
          Experience live music in a whole new way — from
          intimate sessions to unforgettable multi-camera shows.
        </p>

        <div className={styles.heroButtons}>
          <Link href="/early-access" className={styles.primaryButton}>
            <PlayIcon />
            Get Early Access
          </Link>

          <a href="#experience" className={styles.secondaryButton}>
            Explore Loudentify
          </a>
        </div>

        <div className={styles.heroFootnote}>
          <span className={styles.dot} />
          YOUR FRONT ROW SEAT IS COMING
        </div>
      </div>

      <div className={styles.heroBottom}>
        <span>LIVE MUSIC, REIMAGINED</span>
        <span>SCROLL TO EXPLORE ↓</span>
      </div>
    </section>
  );
}

function Artwork({ item }) {
  return (
    <div className={`${styles.artwork} ${styles[item.theme]}`}>
      <div className={styles.artGlow} />
      <div className={styles.artCircle} />
      <div className={styles.artLines} />

      <div className={styles.artSymbol} aria-hidden="true">
        {item.art === "mic" && "♫"}
        {item.art === "stage" && "✦"}
        {item.art === "sound" && "◉"}
        {item.art === "night" && "☾"}
        {item.art === "afro" && "♪"}
        {item.art === "soul" && "♡"}
        {item.art === "hiphop" && "✳"}
        {item.art === "jazz" && "♬"}
        {item.art === "gospel" && "✧"}
      </div>

      <div className={styles.artTitle}>{item.title}</div>
    </div>
  );
}

function ContentCard({ item }) {
  return (
    <Link href="/early-access" className={styles.contentCard}>
      <div className={styles.poster}>
        <Artwork item={item} />

        {item.tag && (
          <span className={styles.posterTag}>{item.tag}</span>
        )}

        <div className={styles.posterPlay}>
          <PlayIcon size={19} />
        </div>
      </div>

      <div className={styles.cardInfo}>
        <h3>{item.title}</h3>
        <p>{item.category}</p>
      </div>
    </Link>
  );
}


function ContentRow({ collection, index = 0 }) {
  return (
    <section className={styles.contentSection}>
      <div className={styles.sectionTop}>
        <div>
          <h2>{collection.title}</h2>
          <p>{collection.subtitle}</p>
        </div>

        <Link
          href="/early-access"
          className={styles.viewAll}
        >
          Get access <ArrowIcon />
        </Link>
      </div>

      <AutoScrollRow
        className={styles.horizontalScroll}
        speed={index % 2 === 0 ? 25 : 18}
        direction="left"
      >
        {collection.items.map((item) => (
          <ContentCard
            key={item.title}
            item={item}
          />
        ))}
      </AutoScrollRow>
    </section>
  );
}


function Experience() {
  return (
    <section id="experience" className={styles.experience}>
      <div className={styles.experienceVisual}>
        <div className={styles.playerTop}>
          <span><span className={styles.pulse} /> LIVE STUDIO PREVIEW</span>
          <span>CAM 01</span>
        </div>

        <div className={styles.playerStage}>
          <div className={styles.playerGlow} />
          <div className={styles.playerCircle}>♫</div>
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
        <div className={styles.artistRecord}>L</div>
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

function Footer() {
  return (
    <footer className={styles.footer}>
      <div>
        <Logo surface="dark" height={36} />
        <p>Live music, reimagined.</p>
      </div>

      <div className={styles.footerLinks}>
        <a href="#discover">Discover</a>
        <a href="#experience">Experience</a>
        <Link href="/privacy">Privacy</Link>
        <Link href="/auth">Sign In</Link>
      </div>

      <div className={styles.copyright}>
        © 2026 Loudentify. All rights reserved.
      </div>
    </footer>
  );
}

export default function HomePage() {
  return (
    <main className={styles.page}>
      <Navbar />
      <PerformanceHero preferredGenres={["Afrobeats", "R&B"]} />

      <div id="discover" className={styles.discover}>
        {collections.map((collection, index) => (
            <ContentRow
              key={collection.title}
              collection={collection}
              index={index}
            />
          ))}
      </div>

      <Experience />
      <ArtistBanner />
      <BottomCTA />
      <Footer />
    </main>
  );
}
