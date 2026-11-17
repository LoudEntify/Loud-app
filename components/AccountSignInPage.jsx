import { Suspense } from 'react';
import Link from 'next/link';
import Auth from './Auth';
import Logo from './Logo';
import PasswordRecovery from './PasswordRecovery';
import styles from '../styles/auth-page.module.css';

export default function AccountSignInPage({ accountRole = null, mode = 'login' }) {
  const signup = mode === 'signup';
  const recovery = mode === 'forgot' || mode === 'reset';
  const artist = accountRole === 'artist';
  return (
    <main className={styles.page}>
      <section className={styles.story} aria-labelledby="auth-story-title">
        <div className={styles.backdrop} aria-hidden="true" />
        <header className={styles.header}><Link href="/" aria-label="Loudentify home"><Logo height={32} /></Link><Link href="/" className={styles.back}>Back to discover ↗</Link></header>
        <div className={styles.storyContent}>
          <span className={styles.eyebrow}><i aria-hidden="true" />{signup ? 'YOUR NEXT CHAPTER STARTS HERE' : 'THE MUSIC NEVER FEELS FAR AWAY'}</span>
          <h1 id="auth-story-title">{artist ? <>Your music.<br />Your stage.<br /><em>Your moment.</em></> : signup ? <>Find your sound.<br />Find <em>your people.</em></> : <>Back to<br />what moves<br /><em>you.</em></>}</h1>
          <p>{artist ? 'Bring your sound to life. Create performances, connect with your audience and make every angle count.' : 'The energy of a room. The connection of a crowd. Get closer to the artists and moments that stay with you.'}</p>
        </div>
        <div className={styles.storyFooter}><span>INDEPENDENT SOUND. SHARED ENERGY.</span><span>LOUDENTIFY · EST. 2026</span></div>
      </section>

      <section className={styles.authArea} aria-labelledby="auth-form-title">
        <div className={`${styles.authCard} ${recovery ? styles.recoveryCard : ''}`}>
          {recovery && <span className={styles.recoveryIcon} aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="10" width="14" height="11" rx="3" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 15v2" /></svg></span>}
          <div className={styles.cardHeader}>
            <span className={styles.eyebrow}>{recovery ? 'GET BACK TO THE MUSIC' : signup ? 'BECOME PART OF THE SHOW' : 'WELCOME BACK'}</span>
            <h2 id="auth-form-title">{mode === 'forgot' ? <>Forgot your <em>password?</em></> : mode === 'reset' ? <>A fresh <em>start.</em></> : signup ? <>Make it <em>yours.</em></> : <>Step <em>inside.</em></>}</h2>
            <p>{mode === 'forgot' ? 'Enter your account email and we’ll send a link to reset your password.' : mode === 'reset' ? 'Choose a new password to get back to your account.' : signup ? 'One account. A world of live music. Choose how you want to be part of it.' : 'Sign in to your account. Your next great music moment is waiting.'}</p>
          </div>
          {!signup && !recovery && <nav className={styles.audienceNav} aria-label="Choose sign-in page"><Link href="/auth/fan" aria-current={accountRole === 'fan' ? 'page' : undefined}>Fan sign in</Link><Link href="/auth/artist" aria-current={artist ? 'page' : undefined}>Artist sign in</Link></nav>}
          <Suspense fallback={<div className={styles.loading} role="status">Getting your front row ready…</div>}>{recovery ? <PasswordRecovery reset={mode === 'reset'} /> : <Auth key={`${mode}-${accountRole}`} accountRole={accountRole} initialMode={mode} />}</Suspense>
          {!recovery && <div className={styles.waitlistNote}><span>HERE FOR EARLY ACCESS?</span><p><Link href="/early-access">Join the waitlist ↗</Link> for launch updates. A waitlist entry is separate from your account.</p></div>}
          <footer className={styles.footer}><span>SECURE ACCOUNT ACCESS</span><Link href="/privacy">Privacy</Link><a href="mailto:build@loudentify.app">Need help?</a></footer>
        </div>
      </section>
    </main>
  );
}
