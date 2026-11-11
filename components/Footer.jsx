import Link from "next/link";
import Logo from "./Logo";
import styles from "../styles/Footer.module.css";

export default function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className={styles.footer}>
      <div className={styles.glow} aria-hidden="true" />

      <div className={styles.inner}>
        {/* TOP */}
        <div className={styles.top}>
          <div className={styles.brand}>
            <Link
              href="/"
              className={styles.logoLink}
              aria-label="Loudentify home"
            >
              <Logo />
            </Link>

            <p className={styles.brandStatement}>
              Live music,
              <br />
              <span>reimagined.</span>
            </p>

            <p className={styles.brandDescription}>
              Multi-camera live performances, automatically
              directed and built for the next generation of
              artists and fans.
            </p>
          </div>

          {/* NAVIGATION */}
          <div className={styles.navigation}>
            <div className={styles.linkGroup}>
              <span className={styles.groupLabel}>
                EXPLORE
              </span>

              <Link href="/#discover">
                Discover
              </Link>

              <Link href="/#experience">
                The Experience
              </Link>

              <Link href="/#artists">
                For Artists
              </Link>
            </div>

            <div className={styles.linkGroup}>
              <span className={styles.groupLabel}>
                LOUDENTIFY
              </span>

              <Link href="/early-access">
                Early Access
              </Link>

              <Link href="/auth">
                Artist Sign In
              </Link>

              <Link href="/privacy">
                Privacy
              </Link>
            </div>
          </div>

          {/* CTA */}
          <div className={styles.cta}>
            <span className={styles.ctaEyebrow}>
              <span className={styles.liveDot} />
              JANUARY 2027
            </span>

            <h2>
              Your front row
              <br />
              starts here.
            </h2>

            <p>
              Join the first Loudentify artists and fans
              ahead of launch.
            </p>

            <Link
              href="/early-access"
              className={styles.joinButton}
            >
              <span>Join Early Access</span>
              <span className={styles.arrow}>
                →
              </span>
            </Link>
          </div>
        </div>

        {/* LARGE WORDMARK */}
        <div
          className={styles.wordmark}
          aria-hidden="true"
        >
          LOUDENTIFY
        </div>

        {/* BOTTOM */}
        <div className={styles.bottom}>
          <div className={styles.copyright}>
            © {year} LOUDENTIFY
          </div>

          <div className={styles.status}>
            <span className={styles.statusDot} />
            PRE-LAUNCH · UNITED KINGDOM
          </div>

          <div className={styles.legal}>
            <Link href="/privacy">
              Privacy
            </Link>

            <a href="mailto:build@loudentify.app">
              Contact
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}