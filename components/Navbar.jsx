"use client";

import { useState } from "react";
import Link from "next/link";
import Logo from "./Logo";
import styles from "../styles/navbar.module.css";

export default function Navbar() {
  const [menuOpen, setMenuOpen] = useState(false);

  const closeMenu = () => setMenuOpen(false);

  return (
    <header className={styles.navbar}>
      <div className={styles.navInner}>
        {/* BRAND */}
        <Link
          href="/"
          className={styles.logoLink}
          aria-label="Loudentify home"
          onClick={closeMenu}
        >
          <Logo />
        </Link>

        {/* DESKTOP NAVIGATION */}
        <nav
          className={styles.navLinks}
          aria-label="Main navigation"
        >
          <Link href="/#discover">
            <span>Discover</span>
          </Link>

          <Link href="/#experience">
            <span>The Experience</span>
          </Link>

          <Link href="/#artists">
            <span>For Artists</span>
          </Link>
        </nav>

        {/* DESKTOP ACTIONS */}
        <div className={styles.actions}>
          <Link
            href="/auth"
            className={styles.signIn}
          >
            Sign In
          </Link>

          <Link
            href="/early-access"
            className={styles.joinButton}
          >
            <span className={styles.liveDot} />
            Join Early Access
            <span className={styles.arrow}>→</span>
          </Link>
        </div>

        {/* MOBILE MENU BUTTON */}
        <button
          type="button"
          className={`${styles.menuButton} ${
            menuOpen ? styles.menuButtonOpen : ""
          }`}
          aria-label={
            menuOpen
              ? "Close navigation menu"
              : "Open navigation menu"
          }
          aria-expanded={menuOpen}
          aria-controls="mobile-navigation"
          onClick={() =>
            setMenuOpen((current) => !current)
          }
        >
          <span />
          <span />
        </button>
      </div>

      {/* MOBILE NAVIGATION */}
      <div
        id="mobile-navigation"
        className={`${styles.mobileMenu} ${
          menuOpen ? styles.mobileMenuOpen : ""
        }`}
      >
        <nav
          className={styles.mobileNav}
          aria-label="Mobile navigation"
        >
          <Link
            href="/#discover"
            onClick={closeMenu}
          >
            <span className={styles.mobileNumber}>
              01
            </span>

            <span>Discover</span>

            <span className={styles.mobileArrow}>
              →
            </span>
          </Link>

          <Link
            href="/#experience"
            onClick={closeMenu}
          >
            <span className={styles.mobileNumber}>
              02
            </span>

            <span>The Experience</span>

            <span className={styles.mobileArrow}>
              →
            </span>
          </Link>

          <Link
            href="/#artists"
            onClick={closeMenu}
          >
            <span className={styles.mobileNumber}>
              03
            </span>

            <span>For Artists</span>

            <span className={styles.mobileArrow}>
              →
            </span>
          </Link>
        </nav>

        <div className={styles.mobileActions}>
          <Link
            href="/auth"
            className={styles.mobileSignIn}
            onClick={closeMenu}
          >
            Sign In
          </Link>

          <Link
            href="/early-access"
            className={styles.mobileJoin}
            onClick={closeMenu}
          >
            <span>
              <span className={styles.liveDot} />
              Join Early Access
            </span>

            <span>→</span>
          </Link>
        </div>

        <div className={styles.mobileFooter}>
          <span>LOUDENTIFY</span>
          <span>LIVE MUSIC, REIMAGINED.</span>
        </div>
      </div>
    </header>
  );
}