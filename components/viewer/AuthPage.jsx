'use client';
// components/viewer/AuthPage.jsx — /signup and /login as full pages (the
// same sheets as on the show screen, over the silk background).
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import SignUpSheet, { LoginSheet } from './SignUpSheet';

export default function AuthPage({ mode: initial, trigger = 'direct', next = '' }) {
  const [mode, setMode] = useState(initial);
  const router = useRouter();
  const after = ({ role } = {}) => {
    if (mode === 'signup') router.replace(role === 'artist' ? `/artist/onboarding?next=${encodeURIComponent(next || '/profile')}` : `/onboarding?next=${encodeURIComponent(next || '/discover')}`);
    else router.replace(next || '/discover');
  };
  return (
    <div className="v-dark" style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <div className="v-row" style={{ padding: '56px 16px 0', gap: 10 }}><img src="/logo/loudentify-on-dark.png" alt="Loudentify" style={{ height: 26 }} /></div>
      <div style={{ flex: 1 }} />
      <div style={{ width: '100%', maxWidth: 560, margin: '24px auto 0' }}>
        {mode === 'signup' ? <SignUpSheet trigger={trigger} onDone={after} onLogin={() => setMode('login')} /> : <LoginSheet onDone={after} onSignUp={() => setMode('signup')} />}
      </div>
    </div>
  );
}
