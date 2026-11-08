
import { Suspense } from "react";
import Link from "next/link";
import Auth from "../../components/Auth";
import styles from "./auth-page.module.css";

export const metadata = {
  title: "Sign In | Loudentify",
  description:
    "Sign in or create your Loudentify account. Your music. Your stage. Your experience.",
};

export default function AuthPage() {
  return (
    <main className={styles.page}>
      <section className={styles.visualPanel}>
        <div className={styles.visualOverlay} />

        <Link href="/" className={styles.brand}>
          <span className={styles.brandIcon}>L</span>
          <span>LOUDENTIFY</span>
        </Link>

        <div className={styles.visualContent}>
          <div className={styles.eyebrow}>
            <span className={styles.pulse} />
            THE FUTURE OF LIVE MUSIC
          </div>

          <h1>
            YOUR MUSIC.
            <br />
            YOUR STAGE.
            <br />
            <span>YOUR WORLD.</span>
          </h1>

          <p>
            Discover unforgettable performances, connect
            with artists and experience live music from
            every angle.
          </p>

          <div className={styles.featureTags}>
            <span>LIVE EXPERIENCES</span>
            <span>MULTI-CAMERA</span>
            <span>ARTIST-LED</span>
          </div>
        </div>

        <div className={styles.visualFooter}>
          <span>LIVE MUSIC, REIMAGINED.</span>
          <span>© 2026 LOUDENTIFY</span>
        </div>
      </section>

      <section className={styles.formPanel}>
        <div className={styles.mobileBrand}>
          <Link href="/">
            <span className={styles.brandIcon}>L</span>
            <span>LOUDENTIFY</span>
          </Link>
        </div>

        <div className={styles.formContainer}>
          <div className={styles.formIntro}>
            <div className={styles.welcomeLabel}>
              YOUR FRONT ROW SEAT AWAITS
            </div>

            <h2>Welcome to Loudentify.</h2>

            <p>
              Sign in or create an account to continue
              your Loudentify experience.
            </p>
          </div>

          <div className={styles.authWrapper}>
            <Suspense
              fallback={
                <div className={styles.loading}>
                  Loading your account...
                </div>
              }
            >
              <Auth />
            </Suspense>
          </div>

          <div className={styles.formFooter}>
            <Link href="/">← Back to Discover</Link>
            <span>SECURE ACCOUNT ACCESS</span>
          </div>
        </div>
      </section>
    </main>
  );
}
