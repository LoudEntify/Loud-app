
import Link from "next/link";
import { Suspense } from "react";
import Logo from "./Logo";
import Waitlist from "./Waitlist";
import styles from "./LandingHome.module.css";

const features = [
  {
    number: "01",
    title: "Set your stage",
    description:
      "Use the phones you already own as multiple camera angles for your live performance.",
    icon: "◈",
  },
  {
    number: "02",
    title: "Direct the moment",
    description:
      "Bring camera feeds, backing tracks, and production cues together in one creative workflow.",
    icon: "◎",
  },
  {
    number: "03",
    title: "Bring fans closer",
    description:
      "Perform live with audience reactions, comments, and interactive experiences.",
    icon: "✳",
  },
];

function StagePreview() {
  return (
    <div
      className={styles.stage}
      aria-label="Illustration of a multi-camera live performance"
    >
      <div className={styles.stageHeader}>
        <div className={styles.stageStatus}>
          <span className={styles.liveDot} />
          LIVE STAGE
        </div>
        <span>CAM 01 / MAIN</span>
      </div>

      <div className={styles.stageScreen}>
        <div className={styles.spotlight} />

        <div className={styles.performer}>
          <div className={styles.performerHead} />
          <div className={styles.performerBody} />
          <div className={styles.microphone} />
        </div>

        <div className={styles.stageOverlay}>
          <span className={styles.onAir}>● ON AIR</span>
          <h3>The performance is yours.</h3>
          <p>Multiple angles. One unforgettable show.</p>
        </div>

        <div className={styles.stageCounter}>
          <span className={styles.liveDot} />
          LIVE
        </div>
      </div>

      <div className={styles.cameraGrid}>
        <div className={styles.activeCamera}>
          <strong>01</strong>
          <span>MAIN STAGE</span>
        </div>
        <div>
          <strong>02</strong>
          <span>SIDE ANGLE</span>
        </div>
        <div>
          <strong>03</strong>
          <span>CROWD</span>
        </div>
      </div>

      <div className={styles.stageFooter}>
        <span>LOUDENTIFY LIVE STUDIO</span>
        <span>PREVIEW EXPERIENCE</span>
      </div>
    </div>
  );
}

function Header() {
  return (
    <header className={styles.header}>
      <Link
        href="/"
        className={styles.brand}
        aria-label="Loudentify home"
      >
        <Logo />
      </Link>

      <nav className={styles.nav} aria-label="Main navigation">
        <a href="#how-it-works">How it works</a>
        <a href="#for-everyone">Artists & Fans</a>
        <Link href="/auth">Sign in</Link>
      </nav>

      <a className={styles.navButton} href="#early-access">
        Get early access
        <span aria-hidden="true">↗</span>
      </a>
    </header>
  );
}

function Hero() {
  return (
    <section className={styles.hero}>
      <div className={styles.heroGlow} />

      <div className={styles.heroContent}>
        <div className={styles.eyebrow}>
          <span className={styles.liveDot} />
          THE NEXT ERA OF LIVE PERFORMANCE
        </div>

        <h1>
          Your stage.
          <br />
          Your audience.
          <br />
          <span>Your show.</span>
        </h1>

        <p className={styles.heroDescription}>
          Turn the phones you already own into a multi-camera
          live performance. Create the show. Own the moment.
          Bring your fans closer.
        </p>

        <div className={styles.heroActions}>
          <a className={styles.primaryButton} href="#early-access">
            Join the waitlist
            <span aria-hidden="true">↗</span>
          </a>

          <a className={styles.outlineButton} href="#how-it-works">
            Explore the experience
            <span aria-hidden="true">↓</span>
          </a>
        </div>

        <div className={styles.heroNote}>
          BUILT FOR THE ARTISTS WHO MAKE THE MOMENT
        </div>
      </div>

      <StagePreview />
    </section>
  );
}

function FeatureSection() {
  return (
    <section id="how-it-works" className={styles.section}>
      <div className={styles.sectionLabel}>
        01 / THE EXPERIENCE
      </div>

      <div className={styles.sectionHeading}>
        <h2>
          More than going live.
          <br />
          <span>Putting on a show.</span>
        </h2>

        <p>
          A new kind of performance experience, built around
          the creative tools and devices artists already have.
        </p>
      </div>

      <div className={styles.featureGrid}>
        {features.map((feature) => (
          <article className={styles.featureCard} key={feature.number}>
            <div className={styles.featureTop}>
              <span>{feature.number} /</span>
              <span className={styles.featureIcon}>
                {feature.icon}
              </span>
            </div>

            <h3>{feature.title}</h3>
            <p>{feature.description}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function AudienceSection() {
  return (
    <section id="for-everyone" className={styles.audienceSection}>
      <div className={styles.audienceInner}>
        <div className={styles.sectionLabel}>
          02 / TWO SIDES OF THE STAGE
        </div>

        <h2>
          Made for the people
          <br />
          who make music <span>matter.</span>
        </h2>

        <div className={styles.audienceGrid}>
          <article className={styles.artistCard}>
            <div className={styles.cardCategory}>FOR ARTISTS</div>

            <div className={styles.cardContent}>
              <h3>Take control of your live show.</h3>
              <p>
                Set up your cameras, manage your performance,
                and connect with your audience — without a
                traditional production crew.
              </p>

              <a href="#early-access">
                Join as an artist <span>↗</span>
              </a>
            </div>
          </article>

          <article className={styles.fanCard}>
            <div className={styles.cardCategory}>FOR FANS</div>

            <div className={styles.cardContent}>
              <h3>Don&apos;t just watch. Be there.</h3>
              <p>
                Experience performances live, react in the
                moment, and take part in the show wherever
                you are.
              </p>

              <a href="#early-access">
                Join as a fan <span>↗</span>
              </a>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}

function EarlyAccess() {
  return (
    <section id="early-access" className={styles.signupSection}>
      <div className={styles.signupIntro}>
        <div className={styles.sectionLabel}>
          03 / GET IN EARLY
        </div>

        <h2>
          The stage is <span>almost set.</span>
        </h2>

        <p>
          We&apos;re preparing for our January 2027 launch.
          Join the early-access list and be among the first
          to experience Loudentify.
        </p>
      </div>

      <div className={styles.waitlistContainer}>
        <Suspense fallback={<p>Loading registration...</p>}>
          <Waitlist />
        </Suspense>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className={styles.footer}>
      <span>LOUDENTIFY © 2026</span>
      <span>LIVE IS JUST THE BEGINNING.</span>

      <div className={styles.footerLinks}>
        <Link href="/privacy">Privacy</Link>
        <Link href="/auth">Artist sign in</Link>
      </div>
    </footer>
  );
}

export default function LandingHome() {
  return (
    <main className={styles.page}>
      <Header />

      <Hero />

      <div className={styles.ticker}>
        <span>LIVE MUSIC</span>
        <b>✳</b>
        <span>MULTI-CAMERA</span>
        <b>✳</b>
        <span>REAL-TIME CONNECTION</span>
        <b>✳</b>
        <span>ARTIST-FIRST</span>
      </div>

      <FeatureSection />
      <AudienceSection />
      <EarlyAccess />
      <Footer />
    </main>
  );
}
