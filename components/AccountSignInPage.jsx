import { Suspense } from "react";
import Link from "next/link";
import Auth from "./Auth";
import styles from "../styles/auth-page.module.css";


export default function AccountSignInPage({ accountRole = null }) {
  const audience = accountRole === "artist" ? "Artist" : accountRole === "fan" ? "Fan" : "Account";
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

              <h2>{accountRole === "artist" ? "Your stage is waiting." : "Your front row seat awaits."}</h2>

              <p>
                {audience} sign in for existing accounts. Joining the waitlist does not create an account.
              </p>
            </div>

            <nav aria-label="Choose account sign in" style={{ display: 'flex', gap: 20, margin: '20px 0', fontSize: 13 }}>
              <Link href="/auth/fan" aria-current={accountRole === 'fan' ? 'page' : undefined}>Fan sign in</Link>
              <Link href="/auth/artist" aria-current={accountRole === 'artist' ? 'page' : undefined}>Artist sign in</Link>
            </nav>
            <div className={styles.authComponent}>
              <Suspense
                fallback={
                  <div className={styles.loading}>
                    <span />
                    Loading...
                  </div>
                }
              >
                <Auth accountRole={accountRole} />
              </Suspense>
            </div>

            <p style={{ fontSize: 12, lineHeight: 1.7 }}>Waiting for access? <Link href="/early-access">Join the waitlist</Link>. We’ll email you when you can get started.</p>
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