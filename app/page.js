import { Suspense } from 'react';
import HomeDoors from '../components/HomeDoors';

export const metadata = {
  title: 'Loudentify',
  description: 'Live music, live directed.',
};

// The front door. Two ways in — see components/HomeDoors.jsx for why the
// viewer door is not a login.
//
// This replaced an auth-first landing that showed a login form to
// everybody, including an audience that will never hold an account.
// /auth still renders that form and is where the artist door sends you,
// so nothing was removed — it stopped being the first thing the audience
// meets.
export default function HomePage() {
  return (
    <Suspense fallback={null}>
      <HomeDoors />
    </Suspense>
  );
}
