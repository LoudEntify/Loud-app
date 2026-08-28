import { Suspense } from 'react';
import Auth from '../components/Auth';

export const metadata = {
  title: 'Loudentify',
  description: 'Live music platform — log in or create an account',
};

// Auth-first landing. The live show moved to /live; this is now the
// front door for both roles, and anyone already signed in is bounced
// straight to their home surface by Auth itself rather than being shown
// a login form they don't need.
export default function HomePage() {
  return (
    <main>
      <Suspense fallback={null}>
        <Auth />
      </Suspense>
    </main>
  );
}
