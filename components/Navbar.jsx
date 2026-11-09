import Link from "next/link";
import Logo from "./Logo";
import styles from "./Navbar.module.css";

export default function Navbar() {
  return (
    <header className={styles.navbar}>
      <div className={styles.navInner}>
        <Link href="/" className={styles.logoLink}>
          <Logo />
        </Link>

        <nav className={styles.navLinks} aria-label="Main navigation">
          <Link href="/#discover">Discover</Link>
          <Link href="/#experience">The Experience</Link>
          <Link href="/#artists">For Artists</Link>
        </nav>

        <div className={styles.actions}>
          <Link href="/auth" className={styles.signIn}>
            Sign In
          </Link>

          <Link
            href="/early-access"
            className={styles.joinButton}
          >
            Join Early Access
          </Link>
        </div>
      </div>
    </header>
  );
}