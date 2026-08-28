import { Suspense } from 'react';
import LiveDemo from '../../components/LiveDemo';
import RequireAuth from '../../components/RequireAuth';

export const metadata = {
  title: 'Live · Loudentify',
  description: 'Watch and perform live on Loudentify',
};

// The live show used to live at `/`. The root is the auth landing now,
// so the show moved here -- and the gate lives on THIS route rather than
// on the root, so a shared show link prompts a login and then lands the
// viewer on the show itself instead of on a generic home page.
export default function LivePage() {
  return (
    <main>
      <Suspense fallback={null}>
        <RequireAuth>
          <LiveDemo />
        </RequireAuth>
      </Suspense>
    </main>
  );
}
