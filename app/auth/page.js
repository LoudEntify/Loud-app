import { Suspense } from "react";
import Link from "next/link";
import Auth from "../../components/Auth";
import styles from "../../styles/auth-page.module.css";

export const metadata = {
  title: "Sign In | Loudentify",
  description: "Sign in or create your Loudentify account.",
};

export default function AuthPage() {
  return (
    <main className={styles.page}>
      {/* Background */}
      <div className={styles.background} aria-hidden="true">
        <div className={styles.overlay} />
        <div className={styles.glow} />
      </div>

      {/* Header */}
      <header className={styles.header}>
        <Link href="/" className={styles.logo}>
          <span className={styles.logoMark}>L</span>
          <span>LOUDENTIFY</span>
        </Link>

        <Link href="/" className={styles.back}>
          ← Back to discover
        </Link>
      </header>

      {/* Main content */}
      <div className={styles.layout}>
        <section className={styles.story}>
          <div className={styles.liveLabel}>
            <span className={styles.liveDot} />
            YOUR MUSIC STARTS HERE
          </div>

          <h1>
            STEP INTO
            <br />
            THE <span>SHOW.</span>
          </h1>

          <p>
            Discover performances picked for your taste,
            follow the artists you love and experience live
            music from every angle.
          </p>

          <div className={styles.stats}>
            <div>
              <strong>LIVE</strong>
              <span>Performances</span>
            </div>

            <div>
              <strong>360°</strong>
              <span>Experience</span>
            </div>

            <div>
              <strong>YOU</strong>
              <span>In control</span>
            </div>
          </div>
        </section>

        <section className={styles.authArea}>
          <div className={styles.authCard}>
            <div className={styles.mobileLogo}>
              <span className={styles.logoMark}>L</span>
              <span>LOUDENTIFY</span>
            </div>

            <div className={styles.cardHeader}>
              <span className={styles.eyebrow}>
                WELCOME TO LOUDENTIFY
              </span>

              <h2>Your front row seat awaits.</h2>

              <p>
                Sign in to continue, or create your
                Loudentify account.
              </p>
            </div>

            <div className={styles.authComponent}>
              <Suspense
                fallback={
                  <div className={styles.loading}>
                    <span />
                    Loading...
                  </div>
                }
              >
                <Auth />
              </Suspense>
            </div>

            <div className={styles.secure}>
              <span>●</span>
              SECURE ACCOUNT ACCESS
            </div>
          </div>
        </section>
      </div>

      <footer className={styles.footer}>
        <span>© 2026 LOUDENTIFY</span>
        <span>LIVE MUSIC, REIMAGINED.</span>
      </footer>
    </main>
  );
}