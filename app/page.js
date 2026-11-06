import { Suspense } from 'react';
import Waitlist from '../components/Waitlist';

export const metadata = {
  title: 'Loudentify — Join the waitlist',
  description:
    'Loudentify turns the phones you own into a produced, automatically-directed multi-camera live show. Join the waitlist for the January 2027 launch.',
};

// PRE-LAUNCH FRONT DOOR.
//
// Until launch the root is the waitlist: artists and fans sign up here,
// and a live count of artists already on the list is shown. The previous
// front door (components/HomeDoors.jsx) and the artist login (/auth) are
// NOT removed — the waitlist links to /auth for anyone who already holds
// an operator account, and direct show links (/live/...) still render
// their own entry form. Swapping this import back to HomeDoors restores
// the old landing in one line when the public product goes live.
export default function HomePage() {
  return (
    <Suspense fallback={null}>
      <Waitlist />
    </Suspense>
  );
}
