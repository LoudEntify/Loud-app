import { Suspense } from 'react';
import Onboarding from '../../components/Onboarding';
import PageShell from '../../components/PageShell';
import RequireAuth from '../../components/RequireAuth';

export const metadata = {
  title: 'Welcome · Loudentify',
  description: 'Set up your Loudentify account',
};

// Inside PageShell on purpose. Onboarding is not a walled garden you are
// trapped in until you finish — the sidebar is right there, and every
// destination in it works. That is the point being made structurally:
// this is a helpful route, not a gate.
export default function WelcomePage() {
  return (
    <PageShell active="profile">
      <Suspense fallback={null}>
        <RequireAuth>
          <Onboarding />
        </RequireAuth>
      </Suspense>
    </PageShell>
  );
}
